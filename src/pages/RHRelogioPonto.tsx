import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, CheckCircle2, Clock, Loader2, ScanFace, XCircle, ArrowLeft, LogOut, Delete, BadgeCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { loadFaceModels, detectFace, detectFaceStable, captureVideoFrame, euclideanDistance, maxDistanceForScore, scoreFromDistance } from "@/lib/facial-recognition";
import { loadEnrollmentsCache, saveEnrollmentsCache } from "@/lib/kiosk-cache";
import { enqueuePunch, getQueuedPunches, removeQueuedPunch, incrementPunchAttempt } from "@/lib/kiosk-offline-queue";
import { useNavigate } from "react-router-dom";

interface Enrollment {
  id: string;
  full_name: string;
  photo_url: string | null;
  descriptor: number[];
  facial_required?: boolean;
}

interface EnrollmentCache {
  items: Enrollment[];
  min_confidence?: number;
  savedAt: number;
}

const ENROLLMENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutos (offline-first)

interface Matched {
  employee: Enrollment;
  score: number;
  /** Distância euclidiana até o cadastro — mesma métrica do servidor. */
  distance: number;
  selfie: string;
  /** Descritor do rosto capturado, revalidado pelo servidor antes do ponto. */
  descriptor: number[];
}

/**
 * Colaborador encontrado pela matrícula digitada no quiosque.
 *
 * É deliberadamente menor que `Enrollment`: a busca por matrícula não devolve
 * descritor nenhum (ver rh-kiosk.js), então a comparação 1:1 acontece no
 * servidor, que tem o vetor cadastrado. Guardar `face_enrolled` é o que
 * permite avisar na hora quando o colaborador não tem biometria — em vez de
 * deixar a pessoa esperar a câmera descobrir isso.
 */
interface LookupEmployee {
  id: string;
  full_name: string;
  registration_number: string;
  photo_url: string | null;
  has_face: boolean;
  facial_required: boolean;
}

const PUNCH_LABELS: Record<string, string> = {
  entrada: "Entrada",
  saida_intervalo: "Saída Almoço",
  retorno_intervalo: "Volta Almoço",
  saida: "Saída",
};

/**
 * `"matricula"` é a tela de digitação dos últimos dígitos; `"lookup"` mostra o
 * resultado da busca para o colaborador confirmar que é ele antes de a câmera
 * abrir. `"verifying"` é a comparação 1:1 contra aquele único cadastro — mais
 * barata e mais tolerante que o 1:N, porque não há segundo colocado.
 */
type Phase =
  | "idle"
  | "matricula"
  | "lookup"
  | "loading"
  | "camera"
  | "detecting"
  | "verifying"
  | "matched"
  | "confirming"
  | "success"
  | "not_found"
  | "error";

/** Dígitos pedidos na matrícula. 5 é o tamanho do sufixo usado no RH. */
const MATRICULA_DIGITS = 5;

/**
 * Ranking por distância euclidiana, que é a métrica que o servidor usa para
 * liberar o ponto (backend/src/services/face-match.js).
 *
 * Cosseno não servia aqui: com vetores de 128 dimensões, similaridade 0.90 =
 * distância 0.447, que o servidor rejeita no limiar 75. O tablet rankeava por
 * uma régua e o backend julgava por outra.
 */
function findBestMatch(descriptor: number[], items: Enrollment[]) {
  return items
    .filter((emp) => emp.descriptor?.length && emp.descriptor.length === descriptor.length)
    .map((emp) => ({ emp, d: euclideanDistance(emp.descriptor, descriptor) }))
    .sort((x, y) => x.d - y.d);
}

/** Rejeita se a promessa não resolver a tempo, com mensagem legível. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * O quiosque compara 1:N (descobrir QUEM é), o que é mais tolerante que o app
 * do colaborador, que compara 1:1 (confirmar se é ELE). Por isso o limiar do
 * quiosque é um pouco mais rígido que a sensibilidade padrão do app (70),
 * mas não muito: 80 em cosseno (~0.80) rejeitaria gente legítima.
 */
const KIOSK_MATCH_THRESHOLD = 75;

/**
 * Similaridade acima da qual o segundo colocado é considerado ambíguo. Se dois
 * rostos estão praticamente igualmente próximos, não dá para saber qual é a
 * pessoa — escolher o maior seria adivinhar, e o caminho seguro é recusar.
 *
 * Com 12 funcionários, essa margem de 0.06 era a causa principal das buscas
 * infinitas: o rosto legítimo ficava a ~0.72 (limiar 75), mas o segundo colocado
 * muitas vezes estava a menos de 0.06 dele, e o ciclo rejeitava e tentava de novo
 * para sempre. 0.02 só recusa quando a escolha é genuinamente uma moeda
 * — dois gêmeos no mesmo turno, por exemplo.
 */
const AMBIGUITY_MARGIN = 0.02;
// Folga sobre o limiar de aceite para decidir quando vale pagar a confirmação
// cara (média de 5 quadros). Medidas de quadros únicos variam ~0.05.
const STABLE_CONFIRM_SLACK = 1.25;
// Tempo total de busca antes de desistir. Cada ciclo custa ~200ms na CPU do
// tablet (face-api.js sem WebGL), então 20 tentativas são
// ~4s — tempo de sobra para a pessoa se posicionar, sem a espera infinita que
// o colaborador viu quando os limites eram 45/30.
const MAX_ATTEMPTS_NO_FACE = 20;
const MAX_ATTEMPTS_FACE_FOUND = 12;
// Pequeno delay entre detecções para não sobrecarregar o CPU.
// rAF roda a cada frame (~16ms), mas a detecção leva mais que isso.
const RETRY_DELAY_MS = 50;

export default function RHRelogioPonto({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectLoopRef = useRef<number | null>(null);
  const landmarksCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Desenha os 68 pontos faciais sobre a câmera enquanto a busca acontece.
  const drawFaceLandmarks = useCallback((landmarks: number[][], box?: { x: number; y: number; width: number; height: number }) => {
    const canvas = landmarksCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !landmarks?.length) return;
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scaleX = rect.width / (video.videoWidth || rect.width);
    const scaleY = rect.height / (video.videoHeight || rect.height);
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // O vídeo é espelhado (scale-x-[-1]); o canvas precisa do mesmo flip.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.fillStyle = "#22d3ee";
    ctx.strokeStyle = "#0e7490";
    ctx.lineWidth = 1.5;
    const step = Math.max(1, Math.round(landmarks.length / 68));
    for (let i = 0; i < landmarks.length; i += step) {
      const p = landmarks[i];
      if (!p) continue;
      const x = p[0] * scaleX;
      const y = p[1] * scaleY;
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const [phase, setPhase] = useState<Phase>("idle");
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [minConfidence, setMinConfidence] = useState(KIOSK_MATCH_THRESHOLD);
  const [matched, setMatched] = useState<Matched | null>(null);
  const [nextPunch, setNextPunch] = useState<string>("entrada");
  const [clock, setClock] = useState(new Date());
  const [confirmation, setConfirmation] = useState<{ name: string; type: string; time: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [camWarning, setCamWarning] = useState<string | null>(null);
  const [landmarks, setLandmarks] = useState<number[][] | null>(null);
  /** Contador de ciclos de busca, exibido para diagnosticar "travado". */
  const [attemptCount, setAttemptCount] = useState(0);
  /** Diagnóstico exibido na tela de "não encontrado". */
  const [notFoundInfo, setNotFoundInfo] = useState<{ dbSize: number; bestDistance: number | null } | null>(null);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(() => {
    if (typeof window === "undefined") return "portrait";
    return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
  });
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [cameraRotation, setCameraRotation] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("kiosk_camera_rotation");
      const n = saved ? parseInt(saved) : 0;
      return [0, 90, 180, 270].includes(n) ? n : 0;
    } catch {
      return 0;
    }
  });
  const [showCameraAdjust, setShowCameraAdjust] = useState(false);
  // Estado da digitação da matrícula. `lookupResults` guarda a busca anterior
  // para poder voltar sem digitar de novo; `lookupError` segura a mensagem de
  // "nenhum colaborador" enquanto o colaborador corrige os dígitos.
  const [matricula, setMatricula] = useState("");
  const [lookupResults, setLookupResults] = useState<LookupEmployee[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<LookupEmployee | null>(null);
  const lookupSeqRef = useRef(0);
  const lookupTimerRef = useRef<number | null>(null);

  // Redesenha os pontos quando a câmera ou o rosto mudam
  useEffect(() => {
    drawFaceLandmarks(landmarks);
  }, [landmarks, drawFaceLandmarks]);

  // live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Em modo quiosque mantemos o mesmo MediaStream vivo durante toda a sessão:
  // parar as tracks faz alguns navegadores (Android/Chrome com "Permitir desta vez")
  // pedirem permissão de câmera novamente a cada batida.
  const keepAlive = kiosk;

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    if (detectLoopRef.current) {
      window.clearTimeout(detectLoopRef.current);
      detectLoopRef.current = null;
    }
    if (keepAlive && streamRef.current) {
      // apenas pausa o preview, mantém a permissão/stream ativos
      try { videoRef.current?.pause(); } catch {}
      return;
    }
    releaseStream();
  }, [keepAlive, releaseStream]);

  useEffect(() => () => releaseStream(), [releaseStream]);

  // Detecta orientação do tablet
  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      setOrientation(window.innerWidth > window.innerHeight ? "landscape" : "portrait");
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Monitora online/offline
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Aquece a câmera uma única vez no quiosque (pede permissão só na abertura da tela)
  useEffect(() => {
    if (!kiosk) return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;
        const isLandscape = orientation === "landscape";
        const videoConstraints: MediaTrackConstraints = {
          facingMode: "user",
          width: { ideal: isLandscape ? 1280 : 720 },
          height: { ideal: isLandscape ? 720 : 1280 },
        };
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCamWarning(null);
      } catch {
        // Fallback para constraints genéricos
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = stream;
          setCamWarning(null);
        } catch {
          setCamWarning(
            "Permita o acesso à câmera e escolha a opção de lembrar/permitir sempre neste site para não pedir a cada ponto."
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [kiosk, orientation]);

  // Avisa quando a permissão não está persistida (fica em "perguntar")
  useEffect(() => {
    const perms: any = (navigator as any).permissions;
    if (!perms?.query) return;
    perms.query({ name: "camera" as PermissionName }).then((st: any) => {
      const apply = () => {
        if (st.state === "denied") {
          setCamWarning("Câmera bloqueada neste navegador. Libere nas permissões do site e marque 'Permitir'.");
        } else if (st.state === "prompt") {
          setCamWarning("Ao permitir a câmera, escolha 'Permitir sempre neste site' para não pedir a cada batida.");
        } else {
          setCamWarning(null);
        }
      };
      apply();
      st.onchange = apply;
    }).catch(() => {});
  }, []);

  const loadEnrollments = useCallback(async () => {
    // Offline-first: consulta base local (IndexedDB) ANTES de ir à rede
    const cached = await loadEnrollmentsCache(ENROLLMENT_CACHE_TTL);
    if (cached) {
      setEnrollments(cached.items);
      const configured = Number(cached.min_confidence);
      const effective = Number.isFinite(configured)
        ? Math.max(KIOSK_MATCH_THRESHOLD, configured)
        : KIOSK_MATCH_THRESHOLD;
      setMinConfidence(effective);
      // Atualiza em segundo plano sem bloquear a detecção
      api<{ items: Enrollment[]; min_confidence?: number }>(`/api/rh/kiosk/enrollments`)
        .then((res) => {
          setEnrollments(res.items || []);
          const cfg = Number(res.min_confidence);
          const eff = Number.isFinite(cfg) ? Math.max(KIOSK_MATCH_THRESHOLD, cfg) : KIOSK_MATCH_THRESHOLD;
          setMinConfidence(eff);
          saveEnrollmentsCache({ items: res.items || [], min_confidence: res.min_confidence, savedAt: Date.now() });
        })
        .catch(() => {});
      return cached.items;
    }

    try {
      const res = await api<{ items: Enrollment[]; min_confidence?: number }>(`/api/rh/kiosk/enrollments`);
      setEnrollments(res.items || []);
      const configured = Number(res.min_confidence);
      const effective = Number.isFinite(configured)
        ? Math.max(KIOSK_MATCH_THRESHOLD, configured)
        : KIOSK_MATCH_THRESHOLD;
      setMinConfidence(effective);
      saveEnrollmentsCache({ items: res.items || [], min_confidence: res.min_confidence, savedAt: Date.now() });
      return res.items || [];
    } catch {
      // Fallback: tenta cache mesmo expirado ou vazio
      const stale = await loadEnrollmentsCache(Number.MAX_SAFE_INTEGER);
      if (stale?.items?.length) {
        setEnrollments(stale.items);
        const configured = Number(stale.min_confidence);
        const effective = Number.isFinite(configured) ? Math.max(KIOSK_MATCH_THRESHOLD, configured) : KIOSK_MATCH_THRESHOLD;
        setMinConfidence(effective);
        return stale.items;
      }
      throw new Error("Não foi possível carregar lista de colaboradores offline/online");
    }
  }, []);

  const runDetection = useCallback(async (items: Enrollment[], threshold: number) => {
    setLandmarks(null);
    if (!videoRef.current) return;
    setStatusMsg("Procurando rosto…");
    setAttemptCount(0);
    setNotFoundInfo(null);
    let attempts = 0;
    let bestDistance: number | null = null;

    // setTimeout com delay curto: rAF pode sobrecarregar o CPU em tablets.
    // 50ms é suficiente para não bloquear a UI mas rápido o bastante para
    // uma busca responsiva.
    const scheduleNext = () => {
      detectLoopRef.current = window.setTimeout(loop, RETRY_DELAY_MS) as unknown as number;
    };

    const loop = async () => {
      if (!videoRef.current) return;
      attempts++;
      // Mostra o número de ciclos: se ele para de subir, o loop travou; se não
      // aparece, o problema é antes daqui (modelo/câmera). Sem isto a tela fica
      // em silêncio e não há como distinguir as duas situações.
      setAttemptCount(attempts);
      try {
        // Etapa 1 (barata): um único quadro. Serve só para decidir se vale a
        // pena confirmar. Medir a média a cada ciclo custaria 5 detecções mesmo
        // quando o rosto ainda nem é o da pessoa esperada.
        const quick = await detectFace(videoRef.current);

        if (!quick) {
          setLandmarks(null);
          if (attempts >= MAX_ATTEMPTS_NO_FACE) {
            setPhase("not_found");
            stopCamera();
            return;
          }
          setStatusMsg("Posicione o rosto no centro…");
          scheduleNext();
          return;
        }

        setLandmarks(quick.landmarks);

        const quickRank = findBestMatch(quick.descriptor, items);
        const quickBest = quickRank[0];
        const maxDist = maxDistanceForScore(threshold);

        // Rastreia a melhor distância para diagnóstico
        if (quickBest && (bestDistance === null || quickBest.d < bestDistance)) {
          bestDistance = quickBest.d;
        }

        // Só confirma quando o quadro único já está perto o suficiente. A margem
        // dá espaço para a média de vários quadros corrigir a medição.
        if (!quickBest || quickBest.d > maxDist * STABLE_CONFIRM_SLACK) {
          if (attempts >= MAX_ATTEMPTS_FACE_FOUND) {
            setNotFoundInfo({ dbSize: items.length, bestDistance });
            setPhase("not_found");
            stopCamera();
            return;
          }
          setStatusMsg("Rosto detectado, aproxime mais…");
          scheduleNext();
          return;
        }

        // Etapa 2 (cara): média de 5 quadros. É aqui que a decisão final é
        // tomada, nunca com um único quadro.
        const result = await detectFaceStable(videoRef.current, 5);

        const candidates = result ? findBestMatch(result.descriptor, items) : [];
        const winner = candidates[0];
        const runnerUp = candidates[1]?.d ?? null;
        const accepted = winner && winner.d <= maxDist;
        const ambiguous = accepted && runnerUp !== null && runnerUp < winner.d + AMBIGUITY_MARGIN;

        if (result && accepted && !ambiguous) {
          const best: Matched = {
            employee: winner.emp,
            score: Math.round(scoreFromDistance(winner.d)),
            distance: winner.d,
            selfie: captureVideoFrame(videoRef.current),
            descriptor: result.descriptor,
          };
          setMatched(best);
          try {
            const np = await api<{ next: string }>(`/api/rh/kiosk/next-punch/${best.employee.id}`);
            setNextPunch(np.next || "entrada");
          } catch {
            setNextPunch("entrada");
          }
          setPhase("matched");
          stopCamera();
          return;
        }

        if (attempts >= MAX_ATTEMPTS_FACE_FOUND) {
          setPhase("not_found");
          stopCamera();
          return;
        }
        setStatusMsg(
          ambiguous
            ? "Rosto ambíguo — aproxime-se do rosto de referência."
            : "Rosto detectado, aproxime more…"
        );
        scheduleNext();
      } catch (e) {
        console.error(e);
        scheduleNext();
      }
    };

    scheduleNext();
  }, [stopCamera]);

  const startCapture = useCallback(async () => {
    setMatched(null);
    setConfirmation(null);
    setPhase("loading");
    setStatusMsg("Carregando reconhecimento facial…");
    try {
      // Os modelos vêm de um CDN externo. Se ele estiver lento ou bloqueado no
      // tablet, loadFaceModels() nunca resolve e a tela fica em silêncio para
      // sempre — sem isto não há como distinguir de "detecção lenta".
      await withTimeout(loadFaceModels(), 20000, "O download dos modelos de reconhecimento demorou demais. Verifique a internet do tablet.");
      // Sempre relê do servidor, mesmo com descritores já em cache. Ler só a
      // lista descartava a sensibilidade configurada, e o tablet acabava
      // validando com 75 enquanto o servidor exigia 85.
      const items = await loadEnrollments();
      if (!items.length) {
        toast({ title: "Nenhum colaborador com biometria cadastrada", variant: "destructive" });
        setPhase("idle");
        return;
      }
      setStatusMsg("Abrindo câmera…");
      // Reaproveita o stream já autorizado (quiosque) — evita novo pedido de permissão
      let stream = streamRef.current;
      // Diagnóstico: sem isto, um modelo que não carrega (CDN lento/bloqueado
      // no tablet) deixa a tela em silêncio e parece "detecção lenta".
      const alive = stream?.getVideoTracks().some((t) => t.readyState === "live");
      if (!stream || !alive) {
        stream = await navigator.mediaDevices.getUserMedia({
          // 640x480 — exatamente o que o cadastro usa. O cadastro acha o rosto
          // na hora com essa resolução; o quiosque pedia 720p e o object-cover
          // cortava o vídeo 16:9 num tablet em retrato, deixando o rosto menor
          // na imagem de trabalho e o descritor pior. downscale() já limita a
          // 640px de qualquer forma, então resolução maior só piorava o corte.
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        streamRef.current = stream;
      }
      setCamWarning(null);
      if (videoRef.current) {
        if (videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("detecting");
      runDetection(items, minConfidence);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao abrir câmera", description: err?.message || "Verifique permissões", variant: "destructive" });
      setPhase("error");
    }
  }, [enrollments, loadEnrollments, minConfidence, runDetection, toast]);

  const syncOfflineQueue = useCallback(async () => {
    try {
      const queue = await getQueuedPunches();
      if (!queue.length) return;
      for (const item of queue) {
        try {
          const r = await api<any>(`/api/rh/kiosk/punch`, {
            method: "POST",
            body: {
              punch_type: item.punch_type,
              latitude: item.latitude ?? null,
              longitude: item.longitude ?? null,
              accuracy_meters: item.accuracy_meters ?? null,
              selfie_url: item.selfie_url ?? null,
              employee_id: item.employee_id,
              face_descriptor: item.face_descriptor ?? null,
              client_distance: item.client_distance ?? null,
              client_score: item.client_score ?? null,
              offline_sync: true,
            },
          });
          await removeQueuedPunch(item.id);
          toast({
            title: "Ponto sincronizado",
            description: `${r.employee_name || ""} - ${PUNCH_LABELS[r.punch_type] || r.punch_type}`.trim(),
          });
        } catch {
          await incrementPunchAttempt(item.id);
          break; // tenta novamente depois
        }
      }
    } catch {}
  }, [toast]);

  useEffect(() => {
    syncOfflineQueue();
    const onOnline = () => syncOfflineQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncOfflineQueue]);

  const confirmPunch = useCallback(async () => {
    if (!matched) return;
    setPhase("confirming");
    try {
      // GPS opcional
      let coords: GeolocationCoordinates | null = null;
      try {
        coords = await new Promise((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition(
            (p) => resolve(p.coords),
            () => resolve(null),
            { timeout: 3000, maximumAge: 60000 }
          );
        });
      } catch {}

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await enqueuePunch({
          employee_id: matched.employee.id,
          punch_type: nextPunch,
          selfie_url: matched.selfie,
          face_descriptor: matched.descriptor,
          client_distance: matched.distance,
          client_score: matched.score,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          accuracy_meters: coords?.accuracy ?? null,
        });
        setConfirmation({
          name: matched.employee.full_name,
          type: PUNCH_LABELS[nextPunch] || nextPunch,
          time: new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
        });
        setPhase("success");
        toast({ title: "Ponto registrado offline", description: "Será enviado automaticamente quando a conexão voltar." });
        setTimeout(() => setPhase("idle"), 4000);
        return;
      }

      const r = await api<any>(`/api/rh/kiosk/punch`, {
        method: "POST",
        body: {
          punch_type: nextPunch,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          accuracy_meters: coords?.accuracy ?? null,
          selfie_url: matched.selfie,
          employee_id: matched.employee.id,
          face_descriptor: matched.descriptor,
          // Diagnóstico: o servidor recalcula a distância de qualquer forma e
          // registra no log. Enviar a do tablet permite comparar as duas na
          // mesma linha e ver se elas divergem. Não é usado na decisão.
          // O campo tem que se chamar client_distance — o servidor lê esse
          // nome (rh-kiosk.js); client_similarity era ignorado e o log ficava
          // sem o número do quiosque.
          client_distance: matched.distance,
          client_score: matched.score,
        },
      });
      setConfirmation({
        name: r.employee_name || matched.employee.full_name,
        type: PUNCH_LABELS[r.punch_type] || r.punch_type,
        time: new Date(r.punched_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
      });
      setPhase("success");
      setTimeout(() => setPhase("idle"), 5000);
    } catch (err: any) {
      // Tenta enfileirar se for erro de rede
      const isNetwork = !err?.response && (err?.message?.includes("Network") || err?.message?.includes("Failed") || err?.code === "ECONNABORTED");
      if (isNetwork && matched) {
        try {
          let coords: GeolocationCoordinates | null = null;
          try {
            coords = await new Promise((resolve) => {
              if (!navigator.geolocation) return resolve(null);
              navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { timeout: 2000 });
            });
          } catch {}
          await enqueuePunch({
            employee_id: matched.employee.id,
            punch_type: nextPunch,
            selfie_url: matched.selfie,
            face_descriptor: matched.descriptor,
            client_distance: matched.distance,
            client_score: matched.score,
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
            accuracy_meters: coords?.accuracy ?? null,
          });
          setConfirmation({
            name: matched.employee.full_name,
            type: PUNCH_LABELS[nextPunch] || nextPunch,
            time: new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
          });
          setPhase("success");
          toast({ title: "Ponto registrado offline", description: "Será enviado automaticamente quando a conexão voltar." });
          setTimeout(() => setPhase("idle"), 4000);
          return;
        } catch {}
      }
      // O servidor responde 403 com score/limiar/distância calculada. Mostrar
      // esses números é a diferença entre "o sistema se contradiz" e um
      // diagnóstico real — o quiosque não tem console para consultá-los.
      const face = err?.response;
      const isFaceRejection =
        face?.code === "FACE_NOT_RECOGNIZED" || face?.code === "FACE_DESCRIPTOR_INVALID";
      if (isFaceRejection) {
        // O servidor devolve score e distância. Os dois importam: o score é o
        // que aparece no log, e a distância é o que dá para comparar com o
        // client_distance acima — se os dois números divergem, a culpa é de
        // um dos dois lados da medição.
        const parts = [
          `score ${face.match_score}%`,
          `mínimo exigido ${face.threshold}%`,
        ];
        if (Number.isFinite(Number(face.distance))) parts.push(`distância ${Number(face.distance).toFixed(3)}`);
        if (Number.isFinite(Number(face.max_distance))) parts.push(`máx. ${Number(face.max_distance).toFixed(3)}`);
        if (Number.isFinite(Number(face.client_distance))) parts.push(`quiosque mediu ${Number(face.client_distance).toFixed(3)}`);
        if (Number.isFinite(Number(face.enrolled_len)) && Number.isFinite(Number(face.captured_len))) {
          parts.push(`vetores ${face.enrolled_len}d/${face.captured_len}d`);
        }
        toast({
          title: "Servidor não confirmou o rosto",
          description: `${face.error} (${parts.join(" · ")}) — o quiosque havia aprovado este mesmo rosto.`,
          variant: "destructive",
          duration: 12000,
        });
        setStatusMsg(
          `Divergência: quiosque aprovou, servidor não. ${parts.join(" · ")}.`
        );
      } else {
        toast({ title: "Erro ao registrar ponto", description: err?.message || "Tente novamente", variant: "destructive" });
      }
      setPhase("matched");
    }
  }, [matched, nextPunch, toast]);

  // ===== Matrícula → busca → confirmação 1:1 =====
  // No quiosque a digitação da matrícula substitui a busca 1:N: o colaborador
  // diz quem é, e a câmera confirma que é ele — mais rápido e sem ambiguidade.

  /** Busca colaboradores pelos últimos dígitos da matrícula. */
  const lookupByMatricula = useCallback(async (digits: string) => {
    const clean = digits.replace(/\D/g, "").slice(0, MATRICULA_DIGITS);
    if (clean.length < 3) {
      setLookupError("Informe ao menos 3 dígitos da matrícula.");
      setLookupResults([]);
      setPhase("matricula");
      return;
    }
    setLookupError(null);
    setLookupLoading(true);
    const seq = ++lookupSeqRef.current;
    try {
      const res = await api<{ items: LookupEmployee[] }>(`/api/rh/kiosk/lookup/${encodeURIComponent(clean)}`);
      if (lookupSeqRef.current !== seq) return;
      setLookupResults(res.items || []);
      setPhase("lookup");
    } catch (e) {
      console.error(e);
      if (lookupSeqRef.current !== seq) return;
      setLookupResults([]);
      setLookupError("Não foi possível buscar. Tente novamente.");
      setPhase("matricula");
    } finally {
      if (lookupSeqRef.current === seq) setLookupLoading(false);
    }
  }, []);

  /**
   * Abre a câmera e confirma 1:1 que o rosto é do colaborador escolhido.
   *
   * O descritor cadastrado NÃO vem na resposta do /lookup (o endpoint não
   * devolve vetor biométrico para o navegador). A comparação é feita no
   * servidor no momento do POST /punch — aqui basta capturar o descritor e
   * guardá-lo no `matched` para enviar junto.
   */
  const startVerify = useCallback(async (employee: LookupEmployee) => {
    setVerifyTarget(employee);
    setPhase("loading");
    setStatusMsg("Carregando reconhecimento facial…");
    try {
      await withTimeout(loadFaceModels(), 20000, "O download dos modelos demorou demais. Verifique a internet do tablet.");
      setStatusMsg("Abrindo câmera…");
      let stream = streamRef.current;
      const alive = stream?.getVideoTracks().some((t) => t.readyState === "live");
      if (!stream || !alive) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        streamRef.current = stream;
      }
      setCamWarning(null);
      if (videoRef.current) {
        if (videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("detecting");
      setStatusMsg("Posicione o rosto no centro…");
      let attempts = 0;
      const verify = async (): Promise<void> => {
        if (!videoRef.current) return;
        attempts++;
        setAttemptCount(attempts);
        try {
          const result = await detectFaceStable(videoRef.current, 5);
          if (!result) {
            if (attempts >= MAX_ATTEMPTS_NO_FACE) { setPhase("not_found"); stopCamera(); return; }
            setStatusMsg("Posicione o rosto no centro…");
            detectLoopRef.current = window.setTimeout(() => void verify(), RETRY_DELAY_MS);
            return;
          }
          setLandmarks(result.landmarks);
          const best: Matched = {
            employee: {
              id: employee.id,
              full_name: employee.full_name,
              photo_url: employee.photo_url,
              descriptor: [],
              facial_required: employee.facial_required,
            },
            score: 0,
            distance: 0,
            selfie: captureVideoFrame(videoRef.current),
            descriptor: result.descriptor,
          };
          setMatched(best);
          try {
            const np = await api<{ next: string }>(`/api/rh/kiosk/next-punch/${employee.id}`);
            setNextPunch(np.next || "entrada");
          } catch { setNextPunch("entrada"); }
          setPhase("matched");
          stopCamera();
        } catch (e) {
          console.error(e);
          detectLoopRef.current = window.setTimeout(() => void verify(), RETRY_DELAY_MS);
        }
      };
      void verify();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao abrir câmera", description: err?.message || "Verifique permissões", variant: "destructive" });
      setPhase("error");
    }
  }, [stopCamera, toast]);

  const cancel = useCallback(() => {
    stopCamera();
    setMatched(null);
    setPhase("idle");
  }, [stopCamera]);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white overflow-hidden flex flex-col">
      {/* top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Relógio de Ponto</h1>
            <p className="text-xs text-white/60">Fábrica — Tablet</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono tabular-nums font-bold tracking-tight">
            {clock.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div className="text-xs text-white/60 capitalize">
            {clock.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (kiosk) {
              if (!confirm("Sair do modo quiosque? Será necessário fazer login novamente no tablet.")) return;
              localStorage.removeItem("auth_token");
              localStorage.removeItem("kiosk_mode");
              navigate("/kiosk/login", { replace: true });
            } else {
              navigate("/rh/ponto");
            }
          }}
          className="text-white/70 hover:text-white hover:bg-white/10"
        >
          <LogOut className="h-4 w-4 mr-2" /> Sair
        </Button>
      </div>

      {/* content */}
      <div className="flex-1 flex items-center justify-center p-6">
        {phase === "idle" && (
          <div className="text-center max-w-lg">
            <div className="mb-8 flex justify-center">
              <div className="h-40 w-40 rounded-full bg-primary/20 flex items-center justify-center">
                <ScanFace className="h-20 w-20 text-primary" />
              </div>
            </div>
            <h2 className="text-4xl font-bold mb-3">Pronto para registrar</h2>
            <p className="text-white/70 text-lg mb-8">
              Digite os últimos dígitos da sua matrícula para identificar você.
            </p>
            <Button
              size="lg"
              onClick={() => { setMatricula(""); setLookupError(null); setLookupResults([]); setPhase("matricula"); }}
              className="h-20 px-16 text-2xl font-semibold rounded-2xl bg-primary hover:bg-primary/90 shadow-2xl shadow-primary/30"
            >
              <Camera className="h-8 w-8 mr-3" />
              Bater Ponto
            </Button>
            {camWarning && (
              <p className="mt-6 text-sm text-amber-300/90 bg-amber-500/10 border border-amber-400/20 rounded-xl px-4 py-3">
                {camWarning}
              </p>
            )}
          </div>
        )}

        {phase === "matricula" && (
          <div className="w-full max-w-md">
            <Card className="bg-black/40 border-white/10 p-6">
              <h2 className="text-2xl font-bold mb-2 text-center">Digite sua matrícula</h2>
              <p className="text-white/60 text-sm mb-6 text-center">
                Informe os últimos {MATRICULA_DIGITS} dígitos do seu número de registro.
              </p>
              <div className="mb-4">
                <div className="text-center text-4xl font-mono tracking-[0.3em] bg-black border border-orange-500/60 text-orange-400 rounded-xl py-4 mb-4 min-h-[4.5rem] flex items-center justify-center">
                  {matricula.padEnd(MATRICULA_DIGITS, "•")}
                </div>
                {lookupError && (
                  <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-400/20 rounded-lg px-3 py-2 text-center">
                    {lookupError}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {["1","2","3","4","5","6","7","8","9"].map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    className="h-14 text-2xl font-mono"
                    onClick={() => {
                      if (matricula.length < MATRICULA_DIGITS) {
                        const next = matricula + d;
                        setMatricula(next);
                        setLookupError(null);
                        if (next.length === MATRICULA_DIGITS) {
                          void lookupByMatricula(next);
                        }
                      }
                    }}
                  >
                    {d}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  className="h-14 text-xl"
                  onClick={() => setMatricula((m) => m.slice(0, -1))}
                  disabled={!matricula}
                >
                  <Delete className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  className="h-14 text-2xl font-mono"
                  onClick={() => {
                    if (matricula.length < MATRICULA_DIGITS) {
                      const next = matricula + "0";
                      setMatricula(next);
                      setLookupError(null);
                      if (next.length === MATRICULA_DIGITS) {
                        void lookupByMatricula(next);
                      }
                    }
                  }}
                >
                  0
                </Button>
                <Button
                  variant="outline"
                  className="h-14 text-xl"
                  onClick={() => setPhase("idle")}
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </div>
              {lookupLoading && (
                <div className="flex items-center justify-center gap-2 text-white/60 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                </div>
              )}
            </Card>
          </div>
        )}

        {phase === "lookup" && (
          <div className="w-full max-w-md">
            <Card className="bg-black/40 border-white/10 p-6">
              <h2 className="text-2xl font-bold mb-2 text-center">Confirme sua identidade</h2>
              <p className="text-white/60 text-sm mb-6 text-center">
                {lookupResults.length === 1
                  ? "É você? Toque em Confirmar para continuar."
                  : "Encontramos mais de um colaborador. Selecione o seu nome."}
              </p>
              <div className="space-y-2 mb-6 max-h-80 overflow-y-auto">
                {lookupResults.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => {
                      if (!emp.has_face) {
                        toast({
                          title: "Biometria não cadastrada",
                          description: `${emp.full_name} não possui cadastro facial. Fale com o RH.`,
                          variant: "destructive",
                        });
                        return;
                      }
                      void startVerify(emp);
                    }}
                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-black border border-orange-500/60 hover:bg-orange-500/10 hover:border-orange-400 transition-colors text-left"
                  >
                    <Avatar className="h-12 w-12">
                      {emp.photo_url && <AvatarImage src={emp.photo_url} alt={emp.full_name} />}
                      <AvatarFallback className="text-lg font-bold bg-orange-500/20 text-orange-300">
                        {emp.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-lg truncate text-orange-400">{emp.full_name}</p>
                      <p className="text-sm text-white/80">Matrícula: {emp.registration_number}</p>
                    </div>
                    {emp.has_face ? (
                      <BadgeCheck className="h-6 w-6 text-green-400 shrink-0" />
                    ) : (
                      <XCircle className="h-6 w-6 text-amber-400 shrink-0" />
                    )}
                  </button>
                ))}
                {lookupResults.length === 0 && !lookupLoading && (
                  <p className="text-center text-white/50 py-8">Nenhum colaborador encontrado.</p>
                )}
              </div>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setPhase("matricula"); setLookupResults([]); setLookupError(null); }}
              >
                <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
              </Button>
            </Card>
          </div>
        )}

        {(phase === "loading" || phase === "detecting" || phase === "camera") && (
          <div className="w-full max-w-3xl">
            <Card className="bg-black/40 border-white/10 overflow-hidden">
              {/* Sem max-h: o vídeo ocupa a tela inteira do tablet. Limitar a
                  70vh reduzia a área de leitura justamente onde o rosto podia
                  estar. object-cover preenche o contêiner sem cortar o centro. */}
              <div className="relative flex-1 bg-black min-h-0">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: `scaleX(-1) rotate(${cameraRotation}deg)` }} />
                {/* Moldura guia — ocupa a maior parte da altura, cabe um rosto inteiro */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="h-[78%] aspect-[3/4] max-w-[70%] border-4 border-primary/70 rounded-[45%] shadow-[0_0_50px_rgba(59,130,246,0.45)]" />
                </div>
                {/* Marca��ão dos pontos faciais, enquanto a busca no banco acontece */}
                <canvas ref={landmarksCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  {/* Fundo escuro + texto claro: a tela do quiosque é escura e o
                      texto herdava cor escura, ficando ilegível. */}
                  <div className="bg-black/80 backdrop-blur px-5 py-2.5 rounded-full flex items-center gap-2 border border-white/10">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm text-white font-medium">{statusMsg}</span>
                    {phase === "detecting" && attemptCount > 0 && (
                      <span className="text-xs text-white/50 ml-1">
                        {videoRef.current?.videoWidth
                          ? `${videoRef.current.videoWidth}×${videoRef.current.videoHeight}`
                          : "sem vídeo"} · {attemptCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
            <div className="flex justify-center gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  const next = (cameraRotation + 90) % 360;
                  setCameraRotation(next);
                  try {
                    localStorage.setItem("kiosk_camera_rotation", String(next));
                  } catch {}
                }}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10"
              >
                Ajustar câmera ({cameraRotation}°)
              </Button>
              <Button variant="outline" onClick={cancel} className="bg-white/5 border-white/20 text-white hover:bg-white/10">
                <ArrowLeft className="h-4 w-4 mr-2" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {phase === "matched" && matched && (
          <div className="w-full max-w-lg">
            <Card className="bg-black/90 backdrop-blur border-orange-500/60 p-8 text-center">
              <div className="flex justify-center mb-6">
                <Avatar className="h-32 w-32 border-4 border-orange-400 shadow-2xl">
                  <AvatarImage src={matched.selfie || matched.employee.photo_url || undefined} />
                  <AvatarFallback className="text-3xl bg-orange-500/20 text-orange-300">
                    {matched.employee.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </AvatarFallback>
                </Avatar>
              </div>
              <p className="text-sm uppercase tracking-widest text-white/70 mb-1">Olá</p>
              <h2 className="text-3xl font-bold mb-2 text-orange-400">{matched.employee.full_name}</h2>
              <p className="text-white mb-6">
                Confiança: <span className="font-semibold text-orange-400">{matched.score}%</span>
                <span className="text-white/60 ml-2 text-sm">
                  (distância {matched.distance.toFixed(3)})
                </span>
              </p>

              <div className="bg-orange-500/10 border border-orange-500/40 rounded-2xl p-6 mb-6">
                <p className="text-sm text-white/80 mb-1">Próxima batida</p>
                <p className="text-3xl font-bold text-orange-400">{PUNCH_LABELS[nextPunch] || nextPunch}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={cancel}
                  className="h-16 text-lg bg-black border-white/40 text-white hover:bg-white/10"
                >
                  <XCircle className="h-5 w-5 mr-2" /> Não sou eu
                </Button>
                <Button
                  size="lg"
                  onClick={confirmPunch}
                  className="h-16 text-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <CheckCircle2 className="h-5 w-5 mr-2" /> Confirmar
                </Button>
              </div>
            </Card>
          </div>
        )}

        {phase === "confirming" && (
          <div className="text-center">
            <Loader2 className="h-16 w-16 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-xl">Registrando ponto…</p>
          </div>
        )}

        {phase === "success" && confirmation && (
          <div className="w-full max-w-md">
            <Card className="bg-emerald-500/10 backdrop-blur border-emerald-500/30 p-10 text-center">
              <div className="flex justify-center mb-6">
                <div className="h-24 w-24 rounded-full bg-emerald-500 flex items-center justify-center">
                  <CheckCircle2 className="h-14 w-14 text-white" />
                </div>
              </div>
              <h2 className="text-3xl font-bold mb-2 text-emerald-300">Ponto registrado!</h2>
              <p className="text-xl mb-1">{confirmation.name}</p>
              <p className="text-white/70 mb-4">{confirmation.type} às <span className="font-mono font-semibold">{confirmation.time}</span></p>
              <p className="text-xs text-white/50 mt-6">Voltando ao início em instantes…</p>
            </Card>
          </div>
        )}

        {phase === "not_found" && (
          <div className="w-full max-w-md">
            <Card className="bg-amber-500/10 backdrop-blur border-amber-500/30 p-10 text-center">
              <div className="flex justify-center mb-6">
                <div className="h-24 w-24 rounded-full bg-amber-500/30 flex items-center justify-center">
                  <XCircle className="h-14 w-14 text-amber-400" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-2">Colaborador não encontrado</h2>
              <p className="text-white/70 mb-2">
                Nenhum rosto cadastrado corresponde ao rosto apresentado.
              </p>
              {notFoundInfo && (
                <div className="bg-black/30 rounded-xl p-4 mb-4 text-left text-sm space-y-1">
                  <p className="text-white/60">
                    <span className="text-white/80 font-medium">Banco de rostos:</span>{" "}
                    {notFoundInfo.dbSize} colaborador{notFoundInfo.dbSize !== 1 ? "es" : ""}
                  </p>
                  {notFoundInfo.bestDistance !== null && (
                    <p className="text-white/60">
                      <span className="text-white/80 font-medium">Melhor distância:</span>{" "}
                      {Number.isFinite(notFoundInfo.bestDistance)
                        ? notFoundInfo.bestDistance.toFixed(3)
                        : "—"}
                      <span className="text-white/40 ml-2">
                        (máx. aceita: {maxDistanceForScore(minConfidence).toFixed(3)})
                      </span>
                    </p>
                  )}
                  <p className="text-white/40 text-xs mt-2">
                    Distância menor = rosto mais parecido. Se a melhor distância está perto do limite,
                    o rosto pode estar mal posicionado ou a biometria precisa ser refeita.
                  </p>
                </div>
              )}
              <p className="text-white/70 mb-6">
                Se o seu rosto ainda não foi cadastrado, procure o RH para registrar sua biometria.
              </p>
              <Button size="lg" onClick={startCapture} className="w-full h-16 text-lg">
                <Camera className="h-5 w-5 mr-2" /> Tentar novamente
              </Button>
              <Button variant="ghost" onClick={cancel} className="mt-3 text-white/70">Voltar</Button>
            </Card>
          </div>
        )}

        {phase === "error" && (
          <div className="text-center">
            <XCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
            <p className="text-xl mb-4">Erro ao iniciar câmera</p>
            <Button onClick={cancel}>Voltar</Button>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 py-3 text-center text-xs text-white/40">
        Fuso America/Sao_Paulo · Ponto validado por biometria facial · Anatriello
      </div>
    </div>
  );
}
