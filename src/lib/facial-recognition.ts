/**
 * Reconhecimento facial por embedding (face-api.js).
 *
 * Motor original do projeto: SSD MobileNet v1 para detecção, 68 landmarks
 * geométricos e MobileFaceNet para o embedding de 128 dimensões.
 *
 * A camada pública é estável: os componentes importam `loadFaceModels`,
 * `detectFace`, `detectFaceStable`, `compareFaces`, `facesMatch`,
 * `extractGeometricProfile`, `drawLandmarks` e `captureVideoFrame`.
 *
 * Comparação usa distância euclidiana — mesma métrica que o servidor
 * (backend/src/services/face-match.js) usa para liberar o ponto.
 */
import * as faceapi from 'face-api.js';

/** Modelos servidos pela CDN @vladmandic/face-api (mantidos no CDN: o tablet
 *  costuma ter rede fraca, e os modelos são baixados uma única vez). */
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let modelsLoaded = false;
let modelsLoadingPromise: Promise<void> | null = null;

export interface DetectOptions {
  /** Confiança mínima do detector SSD (0-1) para aceitar o rosto. */
  scoreThreshold?: number;
}

export interface FaceDetectionResult {
  /** Embedding de 128 dimensões. */
  descriptor: number[];
  /** 68 landmarks geométricos [x,y]. */
  landmarks: number[][];
  box: { x: number; y: number; width: number; height: number };
  /** Confiança do detector em 0-100. */
  confidence: number;
}

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
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
  return modelsLoaded ? 'face-api' : null;
}

/**
 * Detecta o rosto e extrai o embedding em uma passada.
 *
 * `scoreThreshold` ajusta a confiança mínima do SSD (padrão 0.5).
 */
export async function detectFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  options: DetectOptions = {}
): Promise<FaceDetectionResult | null> {
  await loadFaceModels();

  const minConfidence = options.scoreThreshold ?? 0.5;
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) return null;

  const landmarks = detection.landmarks.positions.map((p) => [p.x, p.y]);
  const descriptor = Array.from(detection.descriptor);
  const box = detection.detection.box;

  return {
    descriptor,
    landmarks,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    confidence: detection.detection.score * 100,
  };
}

/**
 * Detecta o rosto em vários quadros seguidos e devolve o embedding médio.
 *
 * Um único quadro é ruidoso: variação de iluminação, ruído do sensor e a
 * quantização do modelo fazem a similaridade oscilar. Média de N quadros reduz
 * a chance de uma medição infeliz passar do limiar por acidente — e também das
 * medições ruins que afastam um rosto legítimo.
 */
export async function detectFaceStable(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  samples = 5,
  options: DetectOptions = {}
): Promise<FaceDetectionResult | null> {
  const out: FaceDetectionResult[] = [];

  // Amostras adaptativas: o mínimo para uma média confiável é 3, mas se os
  // primeiros quadros já forem consistentes entre si, não precisa esperar os 5.
  const minSamples = Math.min(3, samples);
  const earlyExitAfter = Math.min(3, samples);

  for (let i = 0; i < samples; i++) {
    const r = await detectFace(input, options);
    if (r) out.push(r);

    // Early exit: se já temos amostras suficientes e elas são consistentes,
    // parar agora. "Consistente" = todos os pares com distância < 0.2.
    if (out.length >= earlyExitAfter && i + 1 >= minSamples) {
      let maxPairDist = 0;
      for (let a = 0; a < out.length; a++) {
        for (let b = a + 1; b < out.length; b++) {
          const d = euclideanDistance(out[a].descriptor, out[b].descriptor);
          if (d > maxPairDist) maxPairDist = d;
        }
      }
      if (maxPairDist < 0.2) break;
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
    const d = euclideanDistance(r.descriptor, mean);
    if (d < bestD) { bestD = d; best = r; }
  }

  return { ...best, descriptor: mean };
}

/**
 * Compara dois embeddings usando distância euclidiana.
 * Retorna similaridade 0-100 (100 = idêntico).
 *
 * face-api.js: distância 0 = idêntico, ~0.6+ = pessoa diferente.
 * Convertido para a régua 0-100 que o servidor usa.
 */
export function compareFaces(descriptor1: number[], descriptor2: number[]): number {
  if (descriptor1.length !== descriptor2.length) return 0;
  const distance = faceapi.euclideanDistance(
    new Float32Array(descriptor1),
    new Float32Array(descriptor2)
  );
  const score = Math.max(0, Math.min(100, (1 - distance / 0.8) * 100));
  return Math.round(score * 100) / 100;
}

/**
 * Verifica se dois rostos correspondem com base em um limiar.
 */
export function facesMatch(descriptor1: number[], descriptor2: number[], threshold = 70): boolean {
  return compareFaces(descriptor1, descriptor2) >= threshold;
}

/**
 * Distância euclidiana entre dois descritores.
 * Mesma métrica que o servidor usa (backend/src/services/face-match.js).
 */
export function euclideanDistance(descriptor1: number[], descriptor2: number[]): number {
  const len = Math.min(descriptor1.length, descriptor2.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const d = descriptor1[i] - descriptor2[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Mesma curva de backend/src/services/face-match.js — mantenha em sincronia. */
export function scoreFromDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= 0.6) return 100 - (distance / 0.6) * 40;
  if (distance <= 1) return 60 - ((distance - 0.6) / 0.4) * 60;
  return 0;
}

/** Distância máxima aceita para um limiar (0-100). Espelho de maxDistanceForScore. */
export function maxDistanceForScore(threshold: number): number {
  const safe = Math.max(0, Math.min(100, threshold));
  if (safe >= 60) return ((100 - safe) / 40) * 0.6;
  return 0.6 + ((60 - safe) / 60) * 0.4;
}

/**
 * Distância + score na régua do servidor. Use onde a decisão final é tomada:
 * o que o tablet aceita precisa ser o que o backend aceita.
 */
export function verifyDistance(descriptor1: number[], descriptor2: number[], threshold = 70) {
  const distance = euclideanDistance(descriptor1, descriptor2);
  const score = Math.round(scoreFromDistance(distance) * 100) / 100;
  return { distance, score, ok: distance <= maxDistanceForScore(threshold) };
}

/**
 * Extrai medidas geométricas dos landmarks para auditoria.
 * face-api.js devolve 68 landmarks; os índices usados aqui seguem o padrão
 * do modelo (dlib 68-point).
 */
export function extractGeometricProfile(landmarks: number[][]): Record<string, number> {
  if (landmarks.length < 68) return {};

  const dist = (a: number[], b: number[]) =>
    Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));

  // Índices do modelo 68-point:
  // 36-41 = olho esquerdo, 42-47 = olho direito, 27-35 = nariz,
  // 48-59 = boca, 8 = queixo.
  const eyeLeft = landmarks[36];
  const eyeRight = landmarks[45];
  const noseTip = landmarks[30];
  const mouthLeft = landmarks[48];
  const mouthRight = landmarks[54];
  const chinBottom = landmarks[8];
  const foreheadApprox = landmarks[27];

  const interEyeDistance = dist(eyeLeft, eyeRight);

  return {
    eye_distance: interEyeDistance,
    nose_to_chin_ratio: dist(noseTip, chinBottom) / interEyeDistance,
    mouth_width_ratio: dist(mouthLeft, mouthRight) / interEyeDistance,
    face_height_ratio: dist(foreheadApprox, chinBottom) / interEyeDistance,
    nose_to_mouth_ratio: dist(noseTip, landmarks[62]) / interEyeDistance,
    left_eye_to_nose_ratio: dist(eyeLeft, noseTip) / interEyeDistance,
    right_eye_to_nose_ratio: dist(eyeRight, noseTip) / interEyeDistance,
  };
}

/**
 * Desenha os landmarks do rosto em um canvas (para feedback visual).
 */
export function drawLandmarks(
  canvas: HTMLCanvasElement,
  landmarks: number[][],
  box: FaceDetectionResult['box']
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Caixa delimitadora
  ctx.strokeStyle = 'hsl(142, 76%, 36%)';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  // Pontos dos landmarks
  ctx.fillStyle = 'hsl(142, 76%, 36%)';
  landmarks.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Captura um quadro do vídeo como data URL (imagem JPEG).
 */
export function captureVideoFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}
