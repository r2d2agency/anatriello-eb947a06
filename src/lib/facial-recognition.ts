/**
 * Facial Recognition by Geometric Landmarks
 * 
 * Uses face-api.js to extract 68 facial landmarks and compute
 * a 128-dimension face descriptor (geometric vector).
 * Comparison is done via euclidean distance — runs 100% in the browser.
 */
import * as faceapi from 'face-api.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let modelsLoaded = false;
let modelsLoadingPromise: Promise<void> | null = null;
let activeFaceBackend: string | null = null;

type FaceDescriptorPayload =
  | number[]
  | { descriptor?: number[] | null }
  | null
  | undefined;

type FaceApiTensorflowBackend = {
  getBackend?: () => string;
  ready?: () => Promise<void>;
  setBackend?: (backend: string) => Promise<boolean> | boolean;
};

function getFaceTensorflowBackend(): FaceApiTensorflowBackend | undefined {
  return (faceapi as typeof faceapi & { tf?: FaceApiTensorflowBackend }).tf;
}

function hasWebGLSupport(): boolean {
  if (typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    return ['webgl2', 'webgl', 'experimental-webgl'].some((contextName) =>
      Boolean((canvas.getContext as (contextId: string) => RenderingContext | null)(contextName))
    );
  } catch {
    return false;
  }
}

function getPreferredFaceBackends(preferredBackends: string[]): string[] {
  const supportsWebGL = hasWebGLSupport();
  const filtered = preferredBackends.filter((backend) => backend !== 'webgl' || supportsWebGL);
  return filtered.includes('cpu') ? filtered : [...filtered, 'cpu'];
}

async function ensureFaceBackend(preferredBackends: string[] = ['webgl', 'cpu']): Promise<string> {
  const tf = getFaceTensorflowBackend();
  if (!tf) {
    activeFaceBackend = 'unknown';
    return activeFaceBackend;
  }

  const orderedBackends = getPreferredFaceBackends(preferredBackends);

  const currentBackend = tf.getBackend?.();
  if (currentBackend) {
    try {
      if (currentBackend === 'webgl' && !hasWebGLSupport()) {
        throw new Error('WebGL indisponível neste dispositivo.');
      }

      await tf.ready?.();
      activeFaceBackend = currentBackend;
      return currentBackend;
    } catch (error) {
      activeFaceBackend = null;
      if (orderedBackends.length === 0) {
        throw error;
      }
    }
  }

  let lastError: unknown;

  for (const backend of orderedBackends) {
    try {
      const changed = await tf.setBackend?.(backend);
      if (changed === false) continue;

      await tf.ready?.();
      activeFaceBackend = tf.getBackend?.() || backend;
      return activeFaceBackend;
    } catch (error) {
      lastError = error;
    }
  }

  const fallbackBackend = tf.getBackend?.();
  if (fallbackBackend) {
    activeFaceBackend = fallbackBackend;
    return fallbackBackend;
  }

  throw lastError instanceof Error ? lastError : new Error('Nenhum backend facial disponível no navegador.');
}

async function switchFaceBackend(backend: string): Promise<boolean> {
  const tf = getFaceTensorflowBackend();
  if (!tf?.setBackend) return false;

  try {
    const changed = await tf.setBackend(backend);
    if (changed === false) return false;

    await tf.ready?.();
    activeFaceBackend = tf.getBackend?.() || backend;
    return true;
  } catch {
    return false;
  }
}

export interface DetectOptions {
  /** Lado da entrada do TinyFaceDetector. Maior = mais preciso e mais lento. */
  inputSize?: number;
  /** Confiança mínima do detector (0-1) para aceitar o rosto. */
  scoreThreshold?: number;
  /** Lado maior do canvas de trabalho ao reduzir o vídeo. Menor = mais rápido. */
  workSize?: number;
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
  const { inputSize = 320, scoreThreshold = 0.5, workSize = 640 } = options;

  // Para vídeo, reduz antes de detectar: o custo de reescalar o quadro
  // inteiro é maior que o de rodar o detector numa imagem menor.
  const target =
    input instanceof HTMLVideoElement ? downscale(input, workSize) ?? input : input;

  // TinyFaceDetector é ~5-10x mais rápido que SSD MobileNet em CPU (mobile).
  // Usa SSD como fallback caso o Tiny falhe.
  let detection = await faceapi
    .detectSingleFace(target, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    detection = await faceapi
      .detectSingleFace(target, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
  }

  if (!detection) return null;

  const landmarks = detection.landmarks.positions.map(p => [p.x, p.y]);
  const descriptor = Array.from(detection.descriptor);
  const box = detection.detection.box;

  return {
    descriptor,
    landmarks,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    confidence: detection.detection.score * 100,
  };
}

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    await ensureFaceBackend(getPreferredFaceBackends(['webgl', 'cpu']));
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
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
  return activeFaceBackend;
}

export interface FaceDetectionResult {
  descriptor: number[];          // 128-dim face descriptor
  landmarks: number[][];         // 68 landmark points [x,y]
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
}

function normalizeFaceDescriptor(input: FaceDescriptorPayload): number[] {
  const source = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray(input.descriptor)
      ? input.descriptor
      : [];

  return source
    .map((value) => (typeof value === 'number' ? value : Number(value)))
    .filter((value) => Number.isFinite(value));
}

function getFaceDistance(descriptor1: FaceDescriptorPayload, descriptor2: FaceDescriptorPayload): number | null {
  const normalizedDescriptor1 = normalizeFaceDescriptor(descriptor1);
  const normalizedDescriptor2 = normalizeFaceDescriptor(descriptor2);

  if (!normalizedDescriptor1.length || normalizedDescriptor1.length !== normalizedDescriptor2.length) {
    return null;
  }

  return faceapi.euclideanDistance(
    new Float32Array(normalizedDescriptor1),
    new Float32Array(normalizedDescriptor2)
  );
}

function scoreFromFaceDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;

  if (distance <= 0.6) {
    return 100 - (distance / 0.6) * 40;
  }

  if (distance <= 1) {
    return 60 - ((distance - 0.6) / 0.4) * 60;
  }

  return 0;
}

function maxDistanceForThreshold(threshold: number): number {
  const safeThreshold = Math.max(0, Math.min(100, threshold));

  if (safeThreshold >= 60) {
    return ((100 - safeThreshold) / 40) * 0.6;
  }

  return 0.6 + ((60 - safeThreshold) / 60) * 0.4;
}

/**
 * Detect face from an HTMLVideoElement or HTMLImageElement and extract descriptor
 */
export async function detectFace(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  options?: DetectOptions
): Promise<FaceDetectionResult | null> {
  await loadFaceModels();

  try {
    return await runFaceDetection(input, options);
  } catch (error) {
    const switchedToCpu = activeFaceBackend !== 'cpu' && await switchFaceBackend('cpu');
    if (!switchedToCpu) throw error;

    return runFaceDetection(input, options);
  }
}

/**
 * Detecta o rosto em vários quadros seguidos e devolve o descritor médio.
 *
 * Um único quadro é ruidoso: variação de iluminação, ruído do sensor e a própria
 * quantização do modelo fazem a distância oscilar. Média de N quadros reduz
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
  for (let i = 0; i < samples; i++) {
    const source = isVideo ? downscale(input, options.workSize ?? 640) ?? input : input;
    const r = await detectFace(source, options);
    if (r) out.push(r);
  }
  // Com poucas detecções a média fica instável. É melhor devolver null e deixar
  // o chamador tentar de novo do que medir em cima de um quadro só.
  if (out.length < Math.min(3, samples)) return null;

  const len = out[0].descriptor.length;
  const mean = new Array<number>(len).fill(0);
  for (const r of out) {
    for (let i = 0; i < len; i++) mean[i] += r.descriptor[i] / out.length;
  }

  // O descritor médio não tem geometria, então o resultado exibido (box e
  // landmarks) vem do quadro cujo descritor está mais próximo da média.
  let best = out[0];
  let bestD = Infinity;
  for (const r of out) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (r.descriptor[i] - mean[i]) ** 2;
    const d = Math.sqrt(sum);
    if (d < bestD) { bestD = d; best = r; }
  }

  return { ...best, descriptor: mean };
}

/**
 * Compare two face descriptors using euclidean distance
 * Returns a similarity score 0-100 (100 = identical)
 */
export function compareFaces(descriptor1: number[], descriptor2: number[]): number {
  const distance = getFaceDistance(descriptor1, descriptor2);
  if (distance === null) return 0;

  const score = scoreFromFaceDistance(distance);
  return Math.round(score * 100) / 100;
}

/**
 * Check if two faces match based on a threshold
 */
export function facesMatch(descriptor1: number[], descriptor2: number[], threshold = 70): boolean {
  const distance = getFaceDistance(descriptor1, descriptor2);
  if (distance === null) return false;

  return distance <= maxDistanceForThreshold(threshold);
}

/**
 * Extract geometric measurements from landmarks for auditing
 */
export function extractGeometricProfile(landmarks: number[][]): Record<string, number> {
  if (landmarks.length < 68) return {};

  const dist = (a: number[], b: number[]) => 
    Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));

  // Key measurements (ratios to normalize for distance)
  const eyeLeft = landmarks[36];
  const eyeRight = landmarks[45];
  const noseTip = landmarks[30];
  const mouthLeft = landmarks[48];
  const mouthRight = landmarks[54];
  const chinBottom = landmarks[8];
  const foreheadApprox = landmarks[27]; // between eyes top

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
