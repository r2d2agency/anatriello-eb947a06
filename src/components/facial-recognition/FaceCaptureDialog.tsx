import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Camera, Loader2, CheckCircle2, AlertTriangle, RotateCcw, ScanFace } from "lucide-react";
import { loadFaceModels, detectFace, captureVideoFrame, drawLandmarks, extractGeometricProfile, type FaceDetectionResult } from "@/lib/facial-recognition";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (data: { descriptor: number[]; landmarks: number[][]; imageDataUrl: string; geometricProfile: Record<string, number>; quality: number; confidence: number }) => void;
  title?: string;
  description?: string;
}

type Status = "loading_models" | "starting_camera" | "detecting" | "captured" | "error";

export const FaceCaptureDialog = ({ open, onOpenChange, onCapture, title = "Captura Facial", description }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const detectTimeoutRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const detectSessionRef = useRef(0);
  const latestDetectionRef = useRef<FaceDetectionResult | null>(null);
  const capturedDetectionRef = useRef<FaceDetectionResult | null>(null);

  const [status, setStatus] = useState<Status>("loading_models");
  const [modelsProgress, setModelsProgress] = useState(0);
  const [detection, setDetection] = useState<FaceDetectionResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string>("");
  const [error, setError] = useState("");
  // Diagnóstico do quadro: distingue "vídeo preto/zerado" de "YuNet não achou
  // rosto". Fica visível só enquanto está procurando, some quando detecta.
  const [diag, setDiag] = useState("");

  const stopCamera = useCallback(() => {
    detectSessionRef.current += 1;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (detectTimeoutRef.current) window.clearTimeout(detectTimeoutRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Espera até que o vídeo tenha dimensões válidas.
   *
   * `video.play()` resolve antes do stream estar pronto em vários navegadores
   * (WebView Android, Safari iOS): `videoWidth`/`videoHeight` continuam 0 por
   * vários quadros. Sem esta espera o primeiro ciclo de detecção falha com
   * "Imagem sem dimensões disponíveis" e o diálogo de cadastro fica procurando
   * rosto sem nunca detectar — o quiosque não sofre porque já tem o stream
   * aquecido desde a abertura da tela.
   */
  const waitForVideoReady = useCallback((video: HTMLVideoElement, timeoutMs = 10000) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const started = Date.now();
      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) { cleanup(); resolve(); return; }
        if (Date.now() - started > timeoutMs) { cleanup(); resolve(); return; }
        rafRef.current = requestAnimationFrame(check);
      };
      const cleanup = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        video.removeEventListener('loadedmetadata', check);
      };
      video.addEventListener('loadedmetadata', check);
      check();
    });
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setStatus("starting_camera");
      latestDetectionRef.current = null;
      capturedDetectionRef.current = null;
      setDetection(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", frameRate: { ideal: 30 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        // Não entra em "detecting" antes do vídeo ter tamanho: a detecção em um
        // quadro de 0x0 lança e o loop morre sem explicação na tela.
        await waitForVideoReady(videoRef.current);
        setStatus("detecting");
      }
    } catch {
      setError("Não foi possível acessar a câmera. Verifique as permissões.");
      setStatus("error");
    }
  }, [waitForVideoReady]);

  const detectLoop = useCallback(async (sessionId: number) => {
    if (!videoRef.current || status !== "detecting" || detectSessionRef.current !== sessionId) return;

    try {
      // Detectar no <video> diretamente é o que trava o cadastro: em vários
      // navegadores (WebView Android, Safari iOS) o elemento pode ter
      // videoWidth/videoHeight > 0 e ainda assim não ter renderizado um único
      // quadro — drawImage copia preto, YuNet não acha rosto e devolve null
      // para sempre. Desenhar num canvas primeiro garante um quadro real.
      const video = videoRef.current;
      const w = video.videoWidth;
      const h = video.videoHeight;
      let result: FaceDetectionResult | null = null;
      let brightness = -1;

      if (w > 0 && h > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          // Brilho médio do quadro: distingue "vídeo preto" de "YuNet não achou
          // rosto". Sem isto os dois casos são indistinguíveis na tela.
          try {
            const { data } = ctx.getImageData(0, 0, w, h);
            let sum = 0;
            const step = 4 * 17; // amostra esparsa, sem custo de ler tudo
            let count = 0;
            for (let i = 0; i < data.length; i += step) {
              sum += data[i] + data[i + 1] + data[i + 2];
              count++;
            }
            brightness = count ? sum / (count * 3) : 0;
          } catch {
            brightness = -1;
          }
          result = await detectFace(canvas);
        }
      }
      if (detectSessionRef.current !== sessionId) return;

      setDiag(
        !w || !h
          ? `vídeo sem dimensões (${w}×${h})`
          : brightness >= 0
            ? `quadro ${w}×${h} · brilho ${brightness.toFixed(0)}`
            : `quadro ${w}×${h}`,
      );

      if (result && canvasRef.current) {
        const canvas = canvasRef.current;
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawLandmarks(canvas, result.landmarks, result.box);
        }
        latestDetectionRef.current = result;
        setDetection(result);
        setError("");
        setDiag("");
      } else {
        latestDetectionRef.current = null;
        setDetection(null);
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext("2d");
          ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }

      // YuNet + MobileFaceNet rodam em ~200ms por quadro mesmo em CPU — rápido
      // o bastante para uma captura responsiva no tablet.
      const nextDelay = 200;
      animFrameRef.current = requestAnimationFrame(() => {
        detectTimeoutRef.current = window.setTimeout(() => {
          void detectLoop(sessionId);
        }, nextDelay);
      });
    } catch (error) {
      if (detectSessionRef.current !== sessionId) return;

      // Sem este log o erro real fica invisível: a mensagem abaixo aparece igual
      // para "modelo não baixou", "WASM não carregou" e "GPU estourou memória".
      console.error('[FaceCapture] detecção falhou', error);
      latestDetectionRef.current = null;
      setDetection(null);
      setError(
        error instanceof Error && error.message
          ? `Falha no reconhecimento facial: ${error.message}`
          : "Não foi possível processar o reconhecimento facial neste dispositivo. Tente novamente ou use um navegador/dispositivo com aceleração gráfica disponível."
      );
      setStatus("error");
      stopCamera();
    }
  }, [status, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      latestDetectionRef.current = null;
      capturedDetectionRef.current = null;
      setStatus("loading_models");
      setDetection(null);
      setCapturedImage("");
      setError("");
      setDiag("");
      return;
    }

    let cancelled = false;
    (async () => {
      setStatus("loading_models");
      setModelsProgress(10);
      try {
        await loadFaceModels();
        setModelsProgress(100);
        if (!cancelled) await startCamera();
      } catch {
        if (!cancelled) {
          setError("Erro ao carregar modelos de detecção facial.");
          setStatus("error");
        }
      }
    })();

    return () => { cancelled = true; stopCamera(); };
  }, [open, startCamera, stopCamera]);

  useEffect(() => {
    if (status !== "detecting") return;

    const sessionId = ++detectSessionRef.current;
    void detectLoop(sessionId);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (detectTimeoutRef.current) window.clearTimeout(detectTimeoutRef.current);
    };
  }, [status, detectLoop]);

  const handleCapture = () => {
    const capturedDetection = latestDetectionRef.current ?? detection;
    if (!videoRef.current || !capturedDetection) return;

    const imageDataUrl = captureVideoFrame(videoRef.current);
    capturedDetectionRef.current = capturedDetection;
    const geometricProfile = extractGeometricProfile(capturedDetection.landmarks);
    setCapturedImage(imageDataUrl);
    setDetection(capturedDetection);
    setStatus("captured");
    stopCamera();
  };

  const handleRetake = async () => {
    setCapturedImage("");
    setDetection(null);
    await startCamera();
  };

  const handleConfirm = () => {
    const confirmedDetection = capturedDetectionRef.current ?? detection;
    if (!confirmedDetection || !capturedImage) return;

    const geometricProfile = extractGeometricProfile(confirmedDetection.landmarks);
    const confidence = Number(confirmedDetection.confidence) || 0;
    onCapture({
      descriptor: confirmedDetection.descriptor,
      landmarks: confirmedDetection.landmarks,
      imageDataUrl: capturedImage,
      geometricProfile,
      quality: confidence,
      confidence,
    });
    onOpenChange(false);
  };

  /**
   * Confiança sempre como string de porcentagem pronta para exibir.
   *
   * O score do YuNet vinha sem guarda e um NaN escapava até o badge como
   * "NaN%". Um detector que devolve algo não numérico agora mostra "—" em vez
   * de texto quebrado na tela do cadastro.
   */
  const confText = (decimals: number) =>
    Number.isFinite(detection?.confidence) ? `${detection!.confidence.toFixed(decimals)}%` : '—%';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>

        {description && <p className="text-sm text-muted-foreground">{description}</p>}

        <div className="space-y-4">
          {status === "loading_models" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Carregando modelos de detecção...</p>
              <Progress value={modelsProgress} className="w-48" />
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => { setError(""); startCamera(); }}>
                <RotateCcw className="h-4 w-4 mr-1" /> Tentar novamente
              </Button>
            </div>
          )}

          {(status === "starting_camera" || status === "detecting") && (
            <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
              
              <div className="absolute top-2 right-2">
                {detection ? (
                  <Badge className="gap-1 bg-green-600">
                    <CheckCircle2 className="h-3 w-3" /> Rosto detectado ({confText(0)})
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Procurando rosto...
                    {diag && <span className="ml-1 font-normal opacity-80">[{diag}]</span>}
                  </Badge>
                )}
              </div>

              {status === "starting_camera" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
            </div>
          )}

          {status === "captured" && capturedImage && (
            <div className="relative rounded-lg overflow-hidden bg-muted aspect-video">
              <img src={capturedImage} alt="Captura facial" className="w-full h-full object-cover" />
              <div className="absolute top-2 right-2">
                <Badge className="gap-1 bg-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Captura confirmada
                </Badge>
              </div>
            </div>
          )}

          {/* Quality indicators */}
          {detection && status !== "captured" && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-border p-2">
                <p className="text-xs text-muted-foreground">Confiança</p>
                <p className="text-sm font-bold">{confText(1)}</p>
              </div>
              <div className="rounded-lg border border-border p-2">
                <p className="text-xs text-muted-foreground">Landmarks</p>
                <p className="text-sm font-bold">{detection.landmarks.length}</p>
              </div>
              <div className="rounded-lg border border-border p-2">
                <p className="text-xs text-muted-foreground">Vetor</p>
                <p className="text-sm font-bold">{detection.descriptor.length}d</p>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            O processamento é feito localmente no seu navegador. Nenhuma imagem é enviada para serviços externos.
          </p>
        </div>

        <DialogFooter className="gap-2">
          {status === "detecting" && (
            <Button onClick={handleCapture} disabled={!detection} className="gap-2">
              <Camera className="h-4 w-4" /> Capturar
            </Button>
          )}
          {status === "captured" && (
            <>
              <Button variant="outline" onClick={handleRetake} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Refazer
              </Button>
              <Button onClick={handleConfirm} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> Confirmar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
