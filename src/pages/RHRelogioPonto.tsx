import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, CheckCircle2, Clock, Loader2, ScanFace, XCircle, ArrowLeft, LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { loadFaceModels, detectFace, captureVideoFrame } from "@/lib/facial-recognition";
import { useNavigate } from "react-router-dom";

interface Enrollment {
  id: string;
  full_name: string;
  photo_url: string | null;
  descriptor: number[];
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

export default function RHRelogioPonto({ kiosk = false }: { kiosk?: boolean } = {}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectLoopRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [matched, setMatched] = useState<Matched | null>(null);
  const [nextPunch, setNextPunch] = useState<string>("entrada");
  const [clock, setClock] = useState(new Date());
  const [confirmation, setConfirmation] = useState<{ name: string; type: string; time: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [camWarning, setCamWarning] = useState<string | null>(null);

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
    const res = await api<{ items: Enrollment[] }>(`/api/rh/kiosk/enrollments`);
    setEnrollments(res.items || []);
    return res.items || [];
  }, []);

  const runDetection = useCallback(async (items: Enrollment[]) => {
    if (!videoRef.current) return;
    setStatusMsg("Procurando rosto…");
    let attempts = 0;

    const loop = async () => {
      if (!videoRef.current) return;
      attempts++;
      try {
        const result = await detectFace(videoRef.current);
        if (result) {
          // find best match
          let best: Matched | null = null;
          for (const emp of items) {
            if (!emp.descriptor?.length || emp.descriptor.length !== result.descriptor.length) continue;
            const d = euclideanDistance(emp.descriptor, result.descriptor);
            const score = d <= 0.6 ? 100 - (d / 0.6) * 40 : d <= 1 ? 60 - ((d - 0.6) / 0.4) * 60 : 0;
            if (!best || d < best.distance) {
              best = { employee: emp, score: Math.round(score), distance: d, selfie: "", descriptor: result.descriptor };
            }
          }
          if (best && best.distance <= 0.6) {
            best.selfie = captureVideoFrame(videoRef.current);
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
          if (attempts >= 25) {
            setPhase("not_found");
            stopCamera();
            return;
          }
          setStatusMsg("Rosto detectado, aproxime mais…");
        } else {
          if (attempts >= 30) {
            setPhase("not_found");
            stopCamera();
            return;
          }
          setStatusMsg("Posicione o rosto no centro…");
        }
      } catch (e) {
        console.error(e);
      }
      detectLoopRef.current = window.setTimeout(loop, 600);
    };

    loop();
  }, [stopCamera]);

  const startCapture = useCallback(async () => {
    setMatched(null);
    setConfirmation(null);
    setPhase("loading");
    setStatusMsg("Carregando reconhecimento facial…");
    try {
      await loadFaceModels();
      const items = enrollments.length ? enrollments : await loadEnrollments();
      if (!items.length) {
        toast({ title: "Nenhum colaborador com biometria cadastrada", variant: "destructive" });
        setPhase("idle");
        return;
      }
      setStatusMsg("Abrindo câmera…");
      // Reaproveita o stream já autorizado (quiosque) — evita novo pedido de permissão
      let stream = streamRef.current;
      const alive = stream?.getVideoTracks().some((t) => t.readyState === "live");
      if (!stream || !alive) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
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
      runDetection(items);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao abrir câmera", description: err?.message || "Verifique permissões", variant: "destructive" });
      setPhase("error");
    }
  }, [enrollments, loadEnrollments, runDetection, toast]);

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
      toast({ title: "Erro ao registrar ponto", description: err?.message || "Tente novamente", variant: "destructive" });
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
          <div className="w-full max-w-2xl">
            <Card className="bg-black/40 border-white/10 overflow-hidden">
              <div className="relative aspect-video bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-64 h-80 border-4 border-primary/60 rounded-[50%] shadow-[0_0_40px_rgba(59,130,246,0.4)]" />
                </div>
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <div className="bg-black/70 backdrop-blur px-4 py-2 rounded-full flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{statusMsg}</span>
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
              <h2 className="text-2xl font-bold mb-2">Não conseguimos identificar</h2>
              <p className="text-white/70 mb-6">Verifique a iluminação e tente novamente. Se persistir, procure o RH.</p>
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
