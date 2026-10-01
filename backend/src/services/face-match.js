/**
 * Verificação facial no servidor.
 *
 * O reconhecimento feito no navegador serve apenas para dar feedback rápido ao
 * usuário. A decisão que libera o ponto precisa acontecer aqui: o tablet informa
 * qual colaborador foi identificado e o descritor do rosto capturado, e o
 * servidor compara com o descritor enrolled. Confiar no `match_score` enviado
 * pelo cliente permitiria registrar ponto para qualquer pessoa.
 */

const DESCRIPTOR_MIN_LENGTH = 64;

/** Extrai um array numérico de descritores gravados em formatos variados (JSONB, texto, { descriptor }). */
export function normalizeDescriptor(raw) {
  let value = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (value && !Array.isArray(value) && Array.isArray(value.descriptor)) {
    value = value.descriptor;
  }

  if (!Array.isArray(value)) return [];

  return value.map(Number).filter((n) => Number.isFinite(n));
}

/** Distância euclidiana entre dois descritores de mesmo tamanho. */
export function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Converte distância em similaridade 0-100 (100 = idêntico).
 * Mesma curva usada pelo frontend, para que servidor e tablet concordem.
 */
export function scoreFromDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance <= 0.6) return 100 - (distance / 0.6) * 40;
  if (distance <= 1) return 60 - ((distance - 0.6) / 0.4) * 60;
  return 0;
}

/** Distância máxima aceita para um limiar de confiança (0-100). */
export function maxDistanceForScore(threshold) {
  const safe = Math.max(0, Math.min(100, threshold));
  if (safe >= 60) return ((100 - safe) / 40) * 0.6;
  return 0.6 + ((60 - safe) / 60) * 0.4;
}

/**
 * Compara o descritor capturado com o cadastrado.
 * Retorna `{ ok, score, distance, reason }`.
 */
export function verifyFace(capturedDescriptor, enrolledDescriptor, threshold = 70) {
  const captured = normalizeDescriptor(capturedDescriptor);
  const enrolled = normalizeDescriptor(enrolledDescriptor);

  if (!enrolled.length || enrolled.length < DESCRIPTOR_MIN_LENGTH) {
    return { ok: false, score: 0, distance: null, reason: 'not_enrolled' };
  }

  if (!captured.length || captured.length !== enrolled.length) {
    return { ok: false, score: 0, distance: null, reason: 'descriptor_mismatch' };
  }

  const distance = euclideanDistance(captured, enrolled);
  const score = Math.round(scoreFromDistance(distance) * 100) / 100;
  const ok = distance <= maxDistanceForScore(threshold);

  return { ok, score, distance: Math.round(distance * 1000) / 1000, reason: ok ? 'match' : 'below_threshold' };
}