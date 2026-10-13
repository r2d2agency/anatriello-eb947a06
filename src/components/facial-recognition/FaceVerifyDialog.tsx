import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RotateCcw, ScanFace, ShieldCheck } from "lucide-react";
import { loadFaceModels, detectFace, captureVideoFrame, compareFaces, drawLandmarks, facesMatch } from "@/lib/facial-recognition";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storedDescriptor: number[];
  storedPhotoUrl?: string;
  personName?: string;
  threshold?: number;
  onResult: (result: { match: boolean; score: number; imageDataUrl: string }) => void;
}

type Status = "loading" | "starting_camera" | "detecting" | "verifying" | "result" | "error";

export const FaceVerifyDialog = ({ open, onOpenChange, storedDescriptor, storedPhotoUrl, personName, threshold = 70, onResult }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const detectTimeoutRef = useRef<number>(0);
  const detectSessionRef = useRef(0);
  const detectStartRef = useRef<number>(0);
  const slowHintRef = useRef<number>(0);
  const [slowHint, setSlowHint] = useState(false);

  const [status, setStatus] = useState<Status>("loading");
  const [score, setScore] = useState<number | null>(null);
  const [matched, setMatched] = useState(false);
  const [capturedImage, setCapturedImage] = useState("");
  const [error, setError] = useState("");
  const [faceDetected, setFaceDetected] = useState(false);

  const stopCamera = useCallback(() => {
    detectSessionRef.current += 1;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (detectTimeoutRef.current) window.clearTimeout(detectTimeoutRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setStatus("starting_camera");

    // Pré-checagem de suporte
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Este navegador não suporta acesso à câmera. Abra o app em um navegador atualizado (Chrome, Safari) e via HTTPS."
      );
      setStatus("error");
      return;
    }

    // HTTPS é obrigatório para getUserMedia (exceto localhost)
    if (typeof window !== "undefined" && window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      setError("A câmera exige conexão segura (HTTPS). Acesse o app pelo endereço oficial https://…");
      setStatus("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } },
      });

      streamRef.current = stream;

      if (!videoRef.current) {
        setError("Não foi possível inicializar a câmera para teste facial.");
        setStatus("error");
        return;
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus("detecting");
    } catch (err: any) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError(
          "Permissão da câmera negada. Toque no ícone de cadeado ao lado da URL, ative 'Câmera' e tente novamente. No iPhone: Ajustes › Safari › Câmera › Permitir."
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("Nenhuma câmera frontal encontrada neste dispositivo.");
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError("A câmera está sendo usada por outro app. Feche outros apps que estejam usando a câmera e tente novamente.");
      } else if (name === "OverconstrainedError") {
        setError("A câmera não suporta a resolução solicitada. Tente novamente.");
      } else {
        setError("Câmera não disponível. Verifique as permissões do navegador.");
      }
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setStatus("loading");
      setScore(null);
      setMatched(false);
      setCapturedImage("");
      setFaceDetected(false);
      setError("");
      return;
    }

    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        // Add timeout to prevent hanging forever on model load
        await Promise.race([
          loadFaceModels(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
        ]);
      } catch (err) {
        if (cancelled) return;
        setError("Não foi possível carregar os modelos de detecção facial. Verifique sua conexão e tente novamente.");
        setStatus("error");
        return;
      }
      if (cancelled) return;

      if (!cancelled) {
        await startCamera();
      }
    })();

    return () => { cancelled = true; stopCamera(); };
  }, [open, startCamera, stopCamera]);

  const detectLoop = useCallback(async (sessionId: number) => {
    if (!videoRef.current || status !== "detecting" || detectSessionRef.current !== sessionId) return;

    try {
      const result = await detectFace(videoRef.current);

      if (detectSessionRef.current !== sessionId) return;

      if (result && canvasRef.current) {
        const canvas = canvasRef.current;
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawLandmarks(canvas, result.landmarks, result.box);
        }
        setFaceDetected(true);
        setError("");

        // Um score não numérico não pode ser maior que nada: sem esta guarda
        // NaN passava pela comparação e disparava a confirmação com lixo.
        if (Number.isFinite(result.confidence) && result.confidence > 60) {
          setStatus("verifying");
          const matchScore = compareFaces(storedDescriptor, result.descriptor);
          const isMatch = facesMatch(storedDescriptor, result.descriptor, threshold);
          const imageDataUrl = captureVideoFrame(videoRef.current);

          setScore(matchScore);
          setMatched(isMatch);
          setCapturedImage(imageDataUrl);
          setStatus("result");
          stopCamera();

          onResult({ match: isMatch, score: matchScore, imageDataUrl });
          return;
        }
      } else {
        setFaceDetected(false);
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }

      animFrameRef.current = requestAnimationFrame(() => {
        detectTimeoutRef.current = window.setTimeout(() => {
          void detectLoop(sessionId);
        }, 150);
      });
    } catch {
      if (detectSessionRef.current !== sessionId) return;

      setFaceDetected(false);
      setError("O reconhecimento facial não conseguiu iniciar neste dispositivo. Tente novamente ou use outro navegador/dispositivo.");
      setStatus("error");
      stopCamera();
    }
  }, [status, storedDescriptor, threshold, onResult, stopCamera]);

  useEffect(() => {
    if (status !== "detecting") return;

    const sessionId = ++detectSessionRef.current;
    detectStartRef.current = Date.now();
    setSlowHint(false);
    if (slowHintRef.current) window.clearTimeout(slowHintRef.current);
    slowHintRef.current = window.setTimeout(() => setSlowHint(true), 8000);
    void detectLoop(sessionId);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (detectTimeoutRef.current) window.clearTimeout(detectTimeoutRef.current);
      if (slowHintRef.current) window.clearTimeout(slowHintRef.current);
    };
  }, [status, detectLoop]);

  const handleRetry = async () => {
    stopCamera();
    setScore(null);
    setMatched(false);
    setCapturedImage("");
    setFaceDetected(false);
    setError("");
    await startCamera();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Verificação Facial
          </DialogTitle>
        </DialogHeader>

        {personName && (
          <p className="text-sm text-muted-foreground">Verificando identidade de <strong>{personName}</strong></p>
        )}

        <div className="space-y-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Preparando verificação...</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={handleRetry} className="gap-1">
                <RotateCcw className="h-4 w-4" /> Tentar novamente
              </Button>
            </div>
          )}

          {(status === "starting_camera" || status === "detecting" || status === "verifying") && (
            <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
              <div className="absolute top-2 right-2">
                <Badge variant={faceDetected ? "default" : "secondary"} className="gap-1">
                  {faceDetected ? <CheckCircle2 className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  {faceDetected ? "Rosto detectado" : "Procurando..."}
                </Badge>
              </div>
              {status === "detecting" && slowHint && !faceDetected && (
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="rounded-md bg-black/60 text-white text-[11px] px-2 py-1.5 text-center">
                    Está demorando? Aproxime o rosto, aumente a luz e mantenha-se parado. Em celulares antigos pode levar alguns segundos.
                  </div>
                </div>
              )}
              {status === "starting_camera" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm font-medium">Abrindo câmera...</p>
                  </div>
                </div>
              )}
              {status === "verifying" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm font-medium">Comparando...</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {status === "result" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {storedPhotoUrl && (
                  <div className="rounded-lg overflow-hidden border border-border">
                    <p className="text-xs text-center py-1 bg-muted text-muted-foreground">Foto cadastrada</p>
                    <img src={storedPhotoUrl} alt="Base" className="w-full aspect-square object-cover" />
                  </div>
                )}
                <div className="rounded-lg overflow-hidden border border-border">
                  <p className="text-xs text-center py-1 bg-muted text-muted-foreground">Captura atual</p>
                  <img src={capturedImage} alt="Captura" className="w-full aspect-square object-cover" />
                </div>
              </div>

              <div className={`rounded-lg p-4 text-center border ${matched ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-destructive bg-destructive/10"}`}>
                {matched ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                    <p className="font-bold text-green-700 dark:text-green-400">Identidade Confirmada</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <XCircle className="h-10 w-10 text-destructive" />
                    <p className="font-bold text-destructive">Identidade Não Confirmada</p>
                  </div>
                )}
                <p className="text-sm mt-1">Similaridade: <strong>{(score || 0).toFixed(1)}%</strong> (mínimo: {threshold}%)</p>
                <Progress value={score || 0} className="mt-2" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {status === "result" && !matched && (
            <Button variant="outline" onClick={handleRetry} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Tentar novamente
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
