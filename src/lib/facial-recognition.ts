/**
 * Reconhecimento facial por embedding (YuNet + MobileFaceNet via ONNX).
 *
 * A camada pública é estável: os componentes continuam importando
 * `loadFaceModels`, `detectFace`, `detectFaceStable`, `compareFaces`,
 * `facesMatch`, `extractGeometricProfile`, `drawLandmarks` e
 * `captureVideoFrame`. A inferência real vive em `onnx-face.ts`.
 *
 * Comparação usa similaridade de cosseno. Os embeddings já saem normalizados
 * do modelo, então o produto interno é a própria similaridade.
 */
import {
  cosineSimilarity,
  detectAndEmbed,
  loadOnnxModels,
} from './onnx-face';

let modelsLoaded = false;
let modelsLoadingPromise: Promise<void> | null = null;
let activeFaceBackend: string | null = null;

export interface DetectOptions {
  /** Lado maior do canvas de trabalho ao reduzir o vídeo. Menor = mais rápido. */
  workSize?: number;
  /** Confiança mínima do YuNet (0-1) para aceitar o rosto. */
  scoreThreshold?: number;
  /** Devolve as coordenadas do rosto na imagem original. */
  returnOriginalCoords?: boolean;
}

export interface FaceDetectionResult {
  /** Embedding de 128 dimensões, já normalizado. */
  descriptor: number[];
  /** 5 landmarks do YuNet: olho esq., olho dir., nariz, boca esq., boca dir. */
  landmarks: number[][];
  box: { x: number; y: number; width: number; height: number };
  /** Confiança do detector em 0-100. */
  confidence: number;
}

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    await loadOnnxModels();
    modelsLoaded = true;
    activeFaceBackend = 'onnx';
  })();

  try {
    await modelsLoadingPromise;
  } catch (error) {
    modelsLoadingPromise = null;
    throw error;
  }
}

export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

export function getActiveFaceBackend(): string | null {
  return activeFaceBackend;
}

/**
 * Canvas de trabalho reaproveitado entre quadros.
 *
 * Detectar direto no <video> faz o navegador reescalar 1920x1080 a cada
 * quadro, o que domina o tempo do ciclo no quiosque. Reduzir uma vez para um
 * canvas pequeno e detectar nele corta esse custo por um fator grande.
 */
let workCanvas: HTMLCanvasElement | null = null;

function getWorkCanvas(width: number, height: number): HTMLCanvasElement {
  if (!workCanvas) workCanvas = document.createElement('canvas');
  if (workCanvas.width !== width || workCanvas.height !== height) {
    workCanvas.width = width;
    workCanvas.height = height;
  }
  return workCanvas;
}

/** Reduz o vídeo para um canvas de no máximo `maxSide` pixels no lado maior. */
function downscale(video: HTMLVideoElement, maxSide: number): HTMLCanvasElement | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const canvas = getWorkCanvas(Math.round(vw * scale), Math.round(vh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function runFaceDetection(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  options: DetectOptions = {}
): Promise<FaceDetectionResult | null> {
  const { workSize = 640, scoreThreshold = 0.5, returnOriginalCoords = false } = options;

  // Para vídeo, reduz antes de detectar: o custo de reescalar o quadro
  // inteiro é maior que o de rodar o detector numa imagem menor.
  const target =
    input instanceof HTMLVideoElement ? downscale(input, workSize) ?? input : input;

  return detectAndEmbed(target, { scoreThreshold, returnOriginalCoords });
}

/**
 * Detect face from an HTMLVideoElement or HTMLImageElement and extract descriptor
 */
export async function detectFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  options?: DetectOptions
): Promise<FaceDetectionResult | null> {
  await loadFaceModels();
  return runFaceDetection(input, options);
}

/**
 * Detecta o rosto em vários quadros seguidos e devolve o embedding médio.
 *
 * Um único quadro é ruidoso: variação de iluminação, ruído do sensor e a própria
 * quantização do modelo fazem a similaridade oscilar. Média de N quadros reduz
 * bastante a chance de uma medição infeliz passar do limiar por acidente — e
 * também das medições ruins que afastam um rosto legítimo.
 */
export async function detectFaceStable(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  samples = 5,
  options: DetectOptions = {}
): Promise<FaceDetectionResult | null> {
  // Um canvas de trabalho é reaproveitado entre as amostras, mas precisa ser
  // redesenhado a cada uma: sem isso as N detecções medem o mesmo quadro e a
  // média não amortiza ruído nenhum.
  const isVideo = input instanceof HTMLVideoElement;
  const out: FaceDetectionResult[] = [];

  // Amostras adaptativas: o mínimo para uma média confiável é 3, mas se os
  // primeiros quadros já forem consistentes entre si, não precisa esperar os 5.
  // Isso reduz o tempo de confirmação de ~5 detecções para ~2-3 quando o rosto
  // está bom — a diferença entre 1s e 3s no quiosque.
  const minSamples = Math.min(3, samples);
  const earlyExitAfter = Math.min(3, samples);

  for (let i = 0; i < samples; i++) {
    const source = isVideo ? downscale(input, options.workSize ?? 640) ?? input : input;
    const r = await detectFace(source, options);
    if (r) out.push(r);

    // Early exit: se já temos amostras suficientes e elas são consistentes,
    // parar agora. "Consistente" = todos os pares com similaridade > 0.88.
    if (out.length >= earlyExitAfter && i + 1 >= minSamples) {
      let minPairSim = 1;
      for (let a = 0; a < out.length; a++) {
        for (let b = a + 1; b < out.length; b++) {
          const s = cosineSimilarity(out[a].descriptor, out[b].descriptor);
          if (s < minPairSim) minPairSim = s;
        }
      }
      if (minPairSim > 0.88) break;
    }
  }

  // Com poucas detecções a média fica instável. É melhor devolver null e deixar
  // o chamador tentar de novo do que medir em cima de um quadro só.
  if (out.length < minSamples) return null;

  const len = out[0].descriptor.length;
  const mean = new Array<number>(len).fill(0);
  for (const r of out) {
    for (let i = 0; i < len; i++) mean[i] += r.descriptor[i] / out.length;
  }

  // O embedding médio não tem geometria, então o resultado exibido (box e
  // landmarks) vem do quadro cujo embedding está mais próximo da média.
  let best = out[0];
  let bestD = Infinity;
  for (const r of out) {
    const d = 1 - cosineSimilarity(r.descriptor, mean);
    if (d < bestD) { bestD = d; best = r; }
  }

  return { ...best, descriptor: mean };
}

/**
 * Compare two face descriptors using cosine similarity
 * Returns a similarity score 0-100 (100 = identical)
 */
export function compareFaces(descriptor1: number[], descriptor2: number[]): number {
  const similarity = cosineSimilarity(descriptor1, descriptor2);
  return Math.round(similarity * 10000) / 100;
}

/**
 * Check if two faces match based on a threshold
 */
export function facesMatch(descriptor1: number[], descriptor2: number[], threshold = 70): boolean {
  return compareFaces(descriptor1, descriptor2) >= threshold;
}

/**
 * Extract geometric measurements from landmarks for auditing
 */
export function extractGeometricProfile(landmarks: number[][]): Record<string, number> {
  if (landmarks.length < 5) return {};

  const dist = (a: number[], b: number[]) =>
    Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));

  // YuNet: 0=olho esq., 1=olho dir., 2=nariz, 3=boca esq., 4=boca dir.
  const eyeLeft = landmarks[0];
  const eyeRight = landmarks[1];
  const noseTip = landmarks[2];
  const mouthLeft = landmarks[3];
  const mouthRight = landmarks[4];

  const interEyeDistance = dist(eyeLeft, eyeRight);

  return {
    eye_distance: interEyeDistance,
    nose_to_mouth_ratio: dist(noseTip, mouthLeft) / interEyeDistance,
    mouth_width_ratio: dist(mouthLeft, mouthRight) / interEyeDistance,
    left_eye_to_nose_ratio: dist(eyeLeft, noseTip) / interEyeDistance,
    right_eye_to_nose_ratio: dist(eyeRight, noseTip) / interEyeDistance,
  };
}

/**
 * Draw face landmarks on a canvas (for visual feedback)
 */
export function drawLandmarks(
  canvas: HTMLCanvasElement,
  landmarks: number[][],
  box: FaceDetectionResult['box']
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Draw bounding box
  ctx.strokeStyle = 'hsl(142, 76%, 36%)';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  // Draw landmark points
  ctx.fillStyle = 'hsl(142, 76%, 36%)';
  landmarks.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Capture a frame from video as an image data URL
 */
export function captureVideoFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}
