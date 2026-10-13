/**
 * Biometria facial — motor ONNX (YuNet + MobileFaceNet)
 * =====================================================
 *
 * Este arquivo é o coração do reconhecimento facial. Se algo de biometria
 * precisar ser entendido ou corrigido, é aqui.
 *
 * POR QUE ESTE MOTOR EXISTE
 * -------------------------
 * O sistema anterior usava face-api.js 0.22.2, que dependia de um backend
 * WebGL do TensorFlow.js que NÃO estava instalado no projeto (só tfjs-core).
 * Sem WebGL, tudo rodava em CPU e cada ciclo de detecção demorava 1-3s no
 * tablet — tempo suficiente para a pessoa desistir antes do rosto ser
 * reconhecido. O rebuild trocou o motor por ONNX Runtime, que inferencia
 * por quadro mesmo sem GPU.
 *
 * PIPELINE
 * --------
 *   vídeo/imagem
 *     → YuNet: detecta o rosto, devolve caixa + 5 landmarks
 *       (olho esq., olho dir., nariz, boca esq., boca dir.)
 *     → alignFace: transformação de similaridade que alinha os 5 pontos
 *       para 112x112 (corrige rotação, escala e translação)
 *     → MobileFaceNet: embedding de 128 dimensões, já normalizado (norma 1)
 *     → cosineSimilarity: produto interno entre embeddings normalizados
 *
 * MODELOS
 * -------
 *   YuNet: face_detection_yunet_2023mar.onnx (~232 KB)
 *   MobileFaceNet: qualcomm/MobileFaceNet (~387 KB + sidecar .data)
 *
 * Ambos são baixados de CDN e cacheados pelo navegador. O MobileFaceNet é
 * uma rede siamese de duas entradas, mas a normalização L2 já está dobrada
 * no grafo — por isso `img1` e `img2` recebem a mesma imagem e basta usar a
 * primeira metade da saída.
 *
 * CONTRATO DE DADOS
 * ------------------
 * employees.face_descriptor (JSONB):
 *   {
 *     "descriptor": number[],   // 128 dimensões, normalizado
 *     "landmarks": [x,y][],      // 5 pontos do YuNet
 *     "geometricProfile": {...}  // razões calculadas dos 5 pontos
 *   }
 *
 * Comparação: similaridade de cosseno (0-1). Mesmo rosto: > 0.6; rostos
 * diferentes: < 0.3. O limiar padrão é 70% (cosine ~0.70).
 *
 * Os 28 cadastros antigos (face-api.js, 128-dim euclidiano) são inválidos
 * neste espaço de embedding — todos precisam ser recadastrados.
 */
import * as ort from 'onnxruntime-web';

// Modelos servidos pela própria aplicação (public/models). Evita depender de
// CDN externa no tablet, onde a rede costuma ser o ponto fraco.
const MODEL_BASE = `${import.meta.env.BASE_URL}models`;

/** YuNet: detector facial. Devolve caixa + 5 landmarks. */
const YUNET_URL = `${MODEL_BASE}/yunet.onnx`;

/**
 * MobileFaceNet (treinado com ArcFace). Entra 112x112, sai 128-dim.
 *
 * É uma rede siamese de duas entradas, mas a normalização L2 já está dobrada
 * no grafo — por isso `img1` e `img2` recebem a mesma imagem e basta usar a
 * primeira metade da saída.
 */
const MOBILEFACENET_URL = `${MODEL_BASE}/mobile_facenet.onnx`;
const MOBILEFACENET_DATA_URL = `${MODEL_BASE}/mobile_facenet.data`;

const FACE_SIZE = 112;
const EMBEDDING_SIZE = 128;

let yunetSession: ort.InferenceSession | null = null;
let mobileFaceNetSession: ort.InferenceSession | null = null;
let modelsLoadingPromise: Promise<void> | null = null;
let activeProvider = 'wasm';

export interface OnnxFaceResult {
  /** Embedding de 128 dimensões, já normalizado (norma 1). */
  descriptor: number[];
  /** 5 landmarks: olho esq, olho dir, nariz, canto boca esq, canto boca dir. */
  landmarks: [number, number][];
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
}

/**
 * Aponta os arquivos .wasm do runtime para o CDN.
 *
 * Sem isso o onnxruntime tentava embarcar os wasm no bundle e o build estourava.
 * Configurado no bootstrap da aplicação e não aqui em import estático, para
 * não acionar um carregamento de módulo antes da hora.
 */
export function configureOnnxRuntime(): void {
  // Multiple providers supported by ort.env.wasm.wasmPaths:
  // 'webnn' | 'webgpu' | 'webgl' | 'wasm' | 'cpu'.
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
}

/** Progresso de 0 a 1 para alimentar a barra de carregamento. */
export type ModelProgressCallback = (progress: number, label: string) => void;

async function fetchAsArrayBuffer(url: string, onProgress?: ModelProgressCallback, label?: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao baixar ${url} (${response.status})`);

  const total = Number(response.headers.get('content-length') || 0);
  if (!total || !response.body) {
    onProgress?.(1, label || 'concluído');
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(0.99, received / total), label || 'baixando');
    }
  }

  onProgress?.(1, label || 'concluído');

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

async function loadYuNet(onProgress?: ModelProgressCallback): Promise<ort.InferenceSession> {
  const buffer = await fetchAsArrayBuffer(YUNET_URL, onProgress, 'detector facial (YuNet)');
  yunetSession = await ort.InferenceSession.create(buffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
}

async function loadMobileFaceNet(onProgress?: ModelProgressCallback): Promise<ort.InferenceSession> {
  const [modelBuffer, dataBuffer] = await Promise.all([
    fetchAsArrayBuffer(MOBILEFACENET_URL, onProgress, 'reconhecedor (MobileFaceNet)'),
    fetchAsArrayBuffer(MOBILEFACENET_DATA_URL),
  ]);

  mobileFaceNetSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    externalData: [{ data: dataBuffer, path: 'mobile_facenet.data' }],
  });
}

/**
 * Carrega os dois modelos uma única vez.
 *
 * Chamado no boot do quiosque e na tela de cadastro; se já estiver carregado
 * resolve imediatamente, então é seguro chamar em todo render.
 */
export function loadOnnxModels(onProgress?: ModelProgressCallback): Promise<void> {
  if (yunetSession && mobileFaceNetSession) return Promise.resolve();
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    configureOnnxRuntime();
    onProgress?.(0.02, 'preparando mecanismo ONNX');
    await loadYuNet(onProgress);
    onProgress?.(0.5, 'detector pronto');
    await loadMobileFaceNet(onProgress);
    activeProvider = 'wasm';
    onProgress?.(1, 'modelos prontos');
  })();

  return modelsLoadingPromise.catch((error) => {
    // Falha não pode deixar o load "preso" para sempre: o chamador tenta de
    // novo na próxima abertura da tela.
    modelsLoadingPromise = null;
    yunetSession = null;
    mobileFaceNetSession = null;
    throw error;
  });
}

export function areOnnxModelsLoaded(): boolean {
  return !!yunetSession && !!mobileFaceNetSession;
}

/** Nome do backend ONNX em uso, para diagnóstico no próprio tablet. */
export function getOnnxProvider(): string {
  return activeProvider;
}

interface RawYuNetOutput {
  boxes: number[][];
  scores: number[];
  landmarks: number[][][];
}

/**
 * Decodifica as 12 saídas do YuNet (cls/obj/bbox/kps x strides 8/16/32).
 *
 * O YuNet é uma detecção estilo YOLO com três escalas. Juntar as três e
 * filtrar por score elimina a necessidade de NMS externo na maioria dos casos —
 * mas mesmo assim aplicamos NMS, porque duas escalas podem disparar no mesmo
 * rosto e devolver a caixa duas vezes.
 */
async function runYuNet(
  session: ort.InferenceSession,
  input: ort.Tensor,
  width: number,
  height: number,
  scoreThreshold: number
): Promise<RawYuNetOutput> {
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = input;
  const out = await session.run(feeds);

  const strideList = [8, 16, 32];

  const boxes: number[][] = [];
  const scores: number[] = [];
  const landmarks: number[][][] = [];
  const fmc = 3;
  const numLandmarks = 5;
  const landmarkStride = 2;

  for (let i = 0; i < fmc; i++) {
    const clsMap = out[`cls_${strideList[i]}`].data as Float32Array;
    const objMap = out[`obj_${strideList[i]}`].data as Float32Array;
    const bboxMap = out[`bbox_${strideList[i]}`].data as Float32Array;
    const kpsMap = out[`kps_${strideList[i]}`].data as Float32Array;

    const gridW = Math.floor(width / strideList[i]);
    const gridH = Math.floor(height / strideList[i]);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const index = gy * gridW + gx;
        const clsScore = Math.max(
          clsMap[index * 2] as number,
          clsMap[index * 2 + 1] as number
        );
        const objScore = objMap[index] as number;
        const score = clsScore * objScore;

        if (score < scoreThreshold) continue;

        const cx = (gx + 0.5) * strideList[i];
        const cy = (gy + 0.5) * strideList[i];

        const xOff = bboxMap[index * 4] as number;
        const yOff = bboxMap[index * 4 + 1] as number;
        const wOff = bboxMap[index * 4 + 2] as number;
        const hOff = bboxMap[index * 4 + 3] as number;

        const xMin = cx - xOff;
        const yMin = cy - yOff;
        const boxW = xOff + wOff;
        const boxH = yOff + hOff;

        const kps: number[][] = [];
        for (let k = 0; k < numLandmarks; k++) {
          const kx = (gx * strideList[i]) + (kpsMap[index * numLandmarks * landmarkStride + k * landmarkStride] as number) * strideList[i];
          const ky = (gy * strideList[i]) + (kpsMap[index * numLandmarks * landmarkStride + k * landmarkStride + 1] as number) * strideList[i];
          kps.push([kx, ky]);
        }

        boxes.push([xMin, yMin, boxW, boxH]);
        scores.push(score);
        landmarks.push(kps);
      }
    }
  }

  return { boxes, scores, landmarks };
}

/** NMS simples: descarta caixas que se sobrepõem demais com uma melhor. */
function applyNMS(
  boxes: number[][],
  scores: number[],
  landmarks: number[][][],
  iouThreshold = 0.3
): RawYuNetOutput {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const keep: number[] = [];

  while (order.length > 0) {
    const current = order.shift()!;
    keep.push(current);

    const remaining: number[] = [];
    for (const idx of order) {
      if (computeIou(boxes[current], boxes[idx]) <= iouThreshold) remaining.push(idx);
    }
    order.length = 0;
    order.push(...remaining);
  }

  return {
    boxes: keep.map((i) => boxes[i]),
    scores: keep.map((i) => scores[i]),
    landmarks: keep.map((i) => landmarks[i]),
  };
}

function computeIou(a: number[], b: number[]): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];

  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  if (inter <= 0) return 0;

  const areaA = a[2] * a[3];
  const areaB = b[2] * b[3];
  return inter / (areaA + areaB - inter);
}

/**
 * Converte a imagem para o tensor de entrada do YuNet.
 *
 * O modelo YuNet neste projeto foi exportado com entrada fixa 640×640.
 * A imagem é redimensionada para caber dentro de 640×640 mantendo a
 * proporção (letterbox) e o espaço restante é preenchido com preto
 * (valor 0 no espaço normalizado [-1, 1]).
 *
 * Retorna também os offsets (padX, padY) e o scale para que as
 * coordenadas detectadas sejam convertidas de volta para a imagem
 * original.
 */
function imageToYuNetTensor(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  targetSize: number
): { tensor: ort.Tensor; width: number; height: number; scale: number; padX: number; padY: number } {
  const sw = 'videoWidth' in source ? source.videoWidth : source.width;
  const sh = 'videoHeight' in source ? source.videoHeight : source.height;
  if (!sw || !sh) throw new Error('Imagem sem dimensões disponíveis');

  const scale = targetSize / Math.max(sw, sh);
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponível');

  // Fundo preto → valor 0 no espaço normalizado [-1, 1]
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetSize, targetSize);

  const padX = Math.floor((targetSize - w) / 2);
  const padY = Math.floor((targetSize - h) / 2);
  ctx.drawImage(source, padX, padY, w, h);

  const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
  const data = new Float32Array(3 * targetSize * targetSize);
  const pixels = imageData.data;

  // NCHW com normalização [-1, 1]
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const p = (y * targetSize + x) * 4;
      data[y * targetSize + x] = (pixels[p] / 255) * 2 - 1;                     // R
      data[targetSize * targetSize + y * targetSize + x] = (pixels[p + 1] / 255) * 2 - 1;     // G
      data[2 * targetSize * targetSize + y * targetSize + x] = (pixels[p + 2] / 255) * 2 - 1; // B
    }
  }

  return {
    tensor: new ort.Tensor('float32', data, [1, 3, targetSize, targetSize]),
    width: targetSize,
    height: targetSize,
    scale,
    padX,
    padY,
  };
}

/** Landmarks de referência do MobileFaceNet (112x112), na ordem do YuNet. */
const REFERENCE_LANDMARKS: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/**
 * Recorta e alinha o rosto usando os 5 landmarks do YuNet.
 *
 * A transformação é uma similaridade (rotação + escala + translação) calculada
 * por mínimos quadrados entre os pontos detectados e os pontos de referência do
 * MobileFaceNet. Sem esse alinhamento, o embedding fica enviesado pela pose e
 * a similaridade cai — era parte do que fazia o sistema atual falhar em perfil.
 */
export function alignFace(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  landmarks: [number, number][],
  scale = 1,
  outputSize = FACE_SIZE
): HTMLCanvasElement {
  const sw = 'videoWidth' in source ? source.videoWidth : source.width;
  const sh = 'videoHeight' in source ? source.videoHeight : source.height;
  if (!sw || !sh) throw new Error('Imagem sem dimensões disponíveis');

  // Converte as coordenadas do espaço do tensor para a imagem original.
  const pts = landmarks.map(([x, y]) => [x / scale, y / scale] as [number, number]);

  // Mínimos quadrados para a transformação de similaridade.
  const n = pts.length;
  const sumSrcX = pts.reduce((s, p) => s + p[0], 0);
  const sumSrcY = pts.reduce((s, p) => s + p[1], 0);
  const sumDstX = REFERENCE_LANDMARKS.reduce((s, p) => s + p[0], 0);
  const sumDstY = REFERENCE_LANDMARKS.reduce((s, p) => s + p[1], 0);

  const meanSrcX = sumSrcX / n;
  const meanSrcY = sumSrcY / n;
  const meanDstX = sumDstX / n;
  const meanDstY = sumDstY / n;

  let numXX = 0;
  let numXY = 0;
  let numYX = 0;
  let numYY = 0;
  for (let i = 0; i < n; i++) {
    const sx = pts[i][0] - meanSrcX;
    const sy = pts[i][1] - meanSrcY;
    const dx = REFERENCE_LANDMARKS[i][0] - meanDstX;
    const dy = REFERENCE_LANDMARKS[i][1] - meanDstY;
    numXX += sx * dx;
    numXY += sx * dy;
    numYX += sy * dx;
    numYY += sy * dy;
  }

  const denom = numXX * numXX + numXY * numXY + numYX * numYX + numYY * numYY;
  if (denom < 1e-9) throw new Error('Landmarks degenerados para alinhamento');

  // Rotação 2x2 da similaridade: [[a, -b], [b, a]].
  const a = (numXX + numYY) / denom;
  const b = (numYX - numXY) / denom;

  // Translação para que a média dos pontos de origem caia na média dos de destino.
  const tx = meanDstX - (a * meanSrcX - b * meanSrcY);
  const ty = meanDstY - (b * meanSrcX + a * meanSrcY);

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');

  ctx.save();
  ctx.transform(a, b, -b, a, tx, ty);
  ctx.drawImage(source, 0, 0, sw, sh);
  ctx.restore();

  return canvas;
}

function alignedFaceToTensor(face: HTMLCanvasElement): ort.Tensor {
  const ctx = face.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  const imageData = ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE);
  const pixels = imageData.data;
  const data = new Float32Array(3 * FACE_SIZE * FACE_SIZE);

  // MobileFaceNet espera RGB em [0, 1], NCHW.
  for (let i = 0; i < FACE_SIZE * FACE_SIZE; i++) {
    data[i] = pixels[i * 4] / 255;
    data[FACE_SIZE * FACE_SIZE + i] = pixels[i * 4 + 1] / 255;
    data[2 * FACE_SIZE * FACE_SIZE + i] = pixels[i * 4 + 2] / 255;
  }

  return new ort.Tensor('float32', data, [1, 3, FACE_SIZE, FACE_SIZE]);
}

/**
 * Extrai o embedding do MobileFaceNet.
 *
 * A rede é siamese (duas entradas), mas como só precisamos de um vetor,
 * passamos a mesma imagem duas vezes e usamos a primeira metade da saída —
 * o dobro da economia de pré-processamento.
 */
async function runMobileFaceNet(session: ort.InferenceSession, face: HTMLCanvasElement): Promise<number[]> {
  const tensor = alignedFaceToTensor(face);
  const feeds: Record<string, ort.Tensor> = { img1: tensor, img2: tensor };
  const out = await session.run(feeds);

  const raw = out[session.outputNames[0]].data as Float32Array;
  const embedding = Array.from(raw.slice(0, EMBEDDING_SIZE));

  // A saída não vem normalizada (norma ~16). Normalizar aqui é obrigatório:
  // a similaridade de cosseno só faz sentido entre vetores unitários.
  let norm = 0;
  for (const v of embedding) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm < 1e-9) throw new Error('Embedding degenerado (norma zero)');

  return embedding.map((v) => v / norm);
}

export interface DetectAndEmbedOptions {
  /** Lado do tensor de entrada do YuNet. O modelo espera 640. */
  inputSize?: number;
  /** Confiança mínima para aceitar a detecção. */
  scoreThreshold?: number;
  /** Coordenadas de retorno já na imagem original (fora do espaço do tensor). */
  returnOriginalCoords?: boolean;
}

/**
 * Detecta o rosto e extrai o embedding em uma passada.
 *
 * É a única função que os chamadores precisam usar no dia a dia: detecta,
 * alinha e embute. Se não houver rosto, devolve null.
 */
export async function detectAndEmbed(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  options: DetectAndEmbedOptions = {}
): Promise<OnnxFaceResult | null> {
  await loadOnnxModels();
  if (!yunetSession || !mobileFaceNetSession) throw new Error('Modelos ONNX não carregados');

  const inputSize = options.inputSize || 640;
  const scoreThreshold = options.scoreThreshold ?? 0.5;

  const { tensor, width, height, scale, padX, padY } = imageToYuNetTensor(source, inputSize);
  const raw = await runYuNet(yunetSession, tensor, width, height, scoreThreshold);
  const { boxes, scores, landmarks } = applyNMS(raw.boxes, raw.scores, raw.landmarks);

  if (boxes.length === 0) return null;

  // Maior caixa primeiro: o rosto principal raramente é o menor.
  let bestIdx = 0;
  let bestArea = 0;
  for (let i = 0; i < boxes.length; i++) {
    const area = boxes[i][2] * boxes[i][3];
    if (area > bestArea) { bestArea = area; bestIdx = i; }
  }

  const box = boxes[bestIdx];
  const confidence = scores[bestIdx];

  // Converte coordenadas do espaço do tensor (640×640 com letterbox) para a imagem original.
  const kps = landmarks[bestIdx].map(
    ([x, y]) => [(x - padX) / scale, (y - padY) / scale] as [number, number]
  );

  // A caixa também precisa ser convertida do espaço do tensor.
  const boxOriginal = {
    x: (box[0] - padX) / scale,
    y: (box[1] - padY) / scale,
    width: box[2] / scale,
    height: box[3] / scale,
  };

  const faceCanvas = alignFace(source, kps, 1);
  const descriptor = await runMobileFaceNet(mobileFaceNetSession, faceCanvas);

  return {
    descriptor,
    landmarks: kps,
    box: boxOriginal,
    confidence: confidence * 100,
  };
}

/** Similaridade de cosseno entre dois embeddings (ambos já normalizados). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

/** Distância do cosseno (1 - similaridade), para quem pensa em distância. */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}
