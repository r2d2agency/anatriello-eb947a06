import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, CheckCircle2, Clock, Loader2, ScanFace, XCircle, ArrowLeft, LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { loadFaceModels, detectFace, detectFaceStable, captureVideoFrame } from "@/lib/facial-recognition";
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

const ENROLLMENT_CACHE_KEY = "kiosk_enrollment_cache";
const ENROLLMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function loadCachedEnrollments(): EnrollmentCache | null {
  try {
    const raw = localStorage.getItem(ENROLLMENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EnrollmentCache;
    if (!parsed.items?.length) return null;
    if (Date.now() - parsed.savedAt > ENROLLMENT_CACHE_TTL) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveEnrollmentsCache(data: EnrollmentCache) {
  try {
    localStorage.setItem(ENROLLMENT_CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage cheio ou indisponível — segue sem cache
  }
}

interface Matched {
  employee: Enrollment;
  score: number;
  distance: number;
  selfie: string;
  /** Descritor do rosto capturado, revalidado pelo servidor antes do ponto. */
  descriptor: number[];
}

const PUNCH_LABELS: Record<string, string> = {
  entrada: "Entrada",
  saida_intervalo: "Saída Almoço",
  retorno_intervalo: "Volta Almoço",
  saida: "Saída",
};

type Phase = "idle" | "loading" | "camera" | "detecting" | "matched" | "confirming" | "success" | "not_found" | "error";

function euclideanDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Curva de distância -> similaridade (0-100). Mesma do backend em face-match.js. */
function scoreFromDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= 0.6) return 100 - (distance / 0.6) * 40;
  if (distance <= 1) return 60 - ((distance - 0.6) / 0.4) * 60;
  return 0;
}

/** Distância máxima aceita para um limiar de confiança (0-100). */
function maxDistanceForScore(threshold: number): number {
  const safe = Math.max(0, Math.min(100, threshold));
  if (safe >= 60) return ((100 - safe) / 40) * 0.6;
  return 0.6 + ((60 - safe) / 60) * 0.4;
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
 * mas não muito: 80 corresponde a distância 0.30 e rejeitaria gente legítima.
 */
const KIOSK_MATCH_THRESHOLD = 75;

/**
 * Distância abaixo da qual o segundo colocado é considerado ambíguo. Se dois
 * rostos estão praticamente igualmente próximos, não dá para saber qual é a
 * pessoa — escolher o menor seria adivinhar, e o caminho seguro é recusar.
 *
 * Com 12 funcionários, essa margem de 0.06 era a causa principal das buscas
 * infinitas: o rosto legítimo ficava a ~0.28 (limiar 75), mas o segundo colocado
 * muitas vezes estava a menos de 0.06 dele, e o ciclo rejeitava e tentava de novo
 * para sempre. 0.02 só recusa quando a escolha é genuinamente uma moeda
 * — dois gêmeos no mesmo turno, por exemplo.
 */
const AMBIGUITY_MARGIN = 0.02;
// Folga sobre o limiar de aceite para decidir quando vale pagar a confirmação
// cara (média de 5 quadros). Medidas de quadros únicos variam ~0.05.
const STABLE_CONFIRM_SLACK = 1.25;
// Tempo total de busca antes de desistir. Cada ciclo custa ~200ms na CPU do
// tablet (TinyFaceDetector + landmarks + descriptor), então 20 tentativas são
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

  // Aquece a câmera uma única vez no quiosque (pede permissão só na abertura da tela)
  useEffect(() => {
    if (!kiosk) return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCamWarning(null);
      } catch {
        setCamWarning(
          "Permita o acesso à câmera e escolha a opção de lembrar/permitir sempre neste site para não pedir a cada ponto."
        );
      }
    })();
    return () => { cancelled = true; };
  }, [kiosk]);

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
    // Tenta o cache primeiro: se a lista de colaboradores não mudou nos
    // últimos 5 minutos, não precisa baixar de novo. Isso elimina a espera
    // de rede em cada batida — o tablet muitas vezes está em WiFi fraco.
    const cached = loadCachedEnrollments();
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

    const res = await api<{ items: Enrollment[]; min_confidence?: number }>(`/api/rh/kiosk/enrollments`);
    setEnrollments(res.items || []);
    // 1:N exige mais rigidez que a sensibilidade do app (1:1). O admin pode
    // deixar o limiar mais alto, nunca mais frouxo que o padrão do quiosque.
    const configured = Number(res.min_confidence);
    const effective = Number.isFinite(configured)
      ? Math.max(KIOSK_MATCH_THRESHOLD, configured)
      : KIOSK_MATCH_THRESHOLD;
    setMinConfidence(effective);
    saveEnrollmentsCache({ items: res.items || [], min_confidence: res.min_confidence, savedAt: Date.now() });
    return res.items || [];
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
        // Etapa 1 (barata): um único quadro, detector pequeno. Serve só para
        // decidir se vale a pena confirmar. Medir a média a cada ciclo custaria
        // 5 detecções mesmo quando o rosto ainda nem é o da pessoa esperada.
        // `detectAll: true` captura rostos laterais/perfil que o single rejeita.
        const quick = await detectFace(videoRef.current, {
          inputSize: 320,
          scoreThreshold: 0.5,
          detectAll: true,
        });

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

        const rank = (descriptor: number[]) =>
          items
            .filter((emp) => emp.descriptor?.length && emp.descriptor.length === descriptor.length)
            .map((emp) => ({ emp, d: euclideanDistance(emp.descriptor, descriptor) }))
            .sort((x, y) => x.d - y.d);

        const quickRank = rank(quick.descriptor);
        const quickBest = quickRank[0];
        const acceptMax = maxDistanceForScore(threshold);

        // Rastreia a melhor distância para diagnóstico
        if (quickBest && (bestDistance === null || quickBest.d < bestDistance)) {
          bestDistance = quickBest.d;
        }

        // Só confirma quando o quadro único já está perto o suficiente. A margem
        // dá espaço para a média de vários quadros corrigir a medição.
        if (!quickBest || quickBest.d > acceptMax * STABLE_CONFIRM_SLACK) {
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

        // Etapa 2 (cara): média de 5 quadros em alta resolução. É aqui que a
        // decisão final é tomada, nunca com um único quadro.
        const result = await detectFaceStable(videoRef.current, 5, {
          inputSize: 512,
          scoreThreshold: 0.5,
        });

        const candidates = result ? rank(result.descriptor) : [];
        const winner = candidates[0];
        const runnerUp = candidates[1]?.d ?? null;
        const accepted = winner && winner.d <= acceptMax;
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

      const r = await api<any>(`/api/rh/kiosk/punch`, {
        method: "POST",
        body: {
          employee_id: matched.employee.id,
          punch_type: nextPunch,
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          accuracy_meters: coords?.accuracy ?? null,
          selfie_url: matched.selfie,
          face_descriptor: matched.descriptor,
          // Diagnóstico: o servidor recalcula a distância de qualquer forma e
          // registra no log. Enviar a do tablet permite comparar as duas na mesma
          // linha e ver se elas divergem. Não é usado na decisão.
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
      // O servidor responde 403 com score/limiar/distância calculada. Mostrar
      // esses números é a diferença entre "o sistema se contradiz" e um
      // diagnóstico real — o quiosque não tem console para consultá-los.
      const face = err?.response;
      const isFaceRejection =
        face?.code === "FACE_NOT_RECOGNIZED" || face?.code === "FACE_DESCRIPTOR_INVALID";
      if (isFaceRejection) {
        const parts = [
          `similaridade ${face.match_score}%`,
          `mínimo exigido ${face.threshold}%`,
        ];
        if (Number.isFinite(Number(face.distance))) parts.push(`distância ${face.distance}`);
        if (Number.isFinite(Number(face.client_distance))) parts.push(`quiosque mediu ${face.client_distance}`);
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
              Toque no botão abaixo e olhe para a câmera. Vamos identificar você automaticamente.
            </p>
            <Button
              size="lg"
              onClick={startCapture}
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

        {(phase === "loading" || phase === "detecting" || phase === "camera") && (
          <div className="w-full max-w-3xl">
            <Card className="bg-black/40 border-white/10 overflow-hidden">
              {/* Sem max-h: o vídeo ocupa a tela inteira do tablet. Limitar a
                  70vh reduzia a área de leitura justamente onde o rosto podia
                  estar. object-cover preenche o contêiner sem cortar o centro. */}
              <div className="relative flex-1 bg-black min-h-0">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
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
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={cancel} className="bg-white/5 border-white/20 text-white hover:bg-white/10">
                <ArrowLeft className="h-4 w-4 mr-2" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {phase === "matched" && matched && (
          <div className="w-full max-w-lg">
            <Card className="bg-white/5 backdrop-blur border-white/10 p-8 text-center">
              <div className="flex justify-center mb-6">
                <Avatar className="h-32 w-32 border-4 border-primary shadow-2xl">
                  <AvatarImage src={matched.selfie || matched.employee.photo_url || undefined} />
                  <AvatarFallback className="text-3xl bg-primary/20">
                    {matched.employee.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                  </AvatarFallback>
                </Avatar>
              </div>
              <p className="text-sm uppercase tracking-widest text-white/60 mb-1">Olá</p>
              <h2 className="text-3xl font-bold mb-2">{matched.employee.full_name}</h2>
              <p className="text-white/70 mb-6">
                Confiança: <span className="font-semibold text-primary">{matched.score}%</span>
              </p>

              <div className="bg-primary/10 border border-primary/30 rounded-2xl p-6 mb-6">
                <p className="text-sm text-white/70 mb-1">Próxima batida</p>
                <p className="text-3xl font-bold text-primary">{PUNCH_LABELS[nextPunch] || nextPunch}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={cancel}
                  className="h-16 text-lg bg-white/5 border-white/20 text-white hover:bg-white/10"
                >
                  <XCircle className="h-5 w-5 mr-2" /> Não sou eu
                </Button>
                <Button
                  size="lg"
                  onClick={confirmPunch}
                  className="h-16 text-lg bg-emerald-600 hover:bg-emerald-700"
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
                      {notFoundInfo.bestDistance.toFixed(3)}
                      <span className="text-white/40 ml-2">
                        (limiar: {maxDistanceForScore(minConfidence).toFixed(3)})
                      </span>
                    </p>
                  )}
                  <p className="text-white/40 text-xs mt-2">
                    Distância menor = rosto mais parecido. Se a melhor distância está perto do limiar,
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
