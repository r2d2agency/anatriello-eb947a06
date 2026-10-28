// Cache offline (IndexedDB) para enrollments do totem de ponto.
// Permite consultar a base local ANTES de ir à rede (offline-first).

const DB_NAME = "kiosk_ponto";
const DB_VERSION = 1;
const STORE = "enrollments";
const META_STORE = "meta";

export interface CachedEnrollments {
  items: any[];
  min_confidence?: number;
  savedAt: number;
  organization_id?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveEnrollmentsCache(data: CachedEnrollments): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    for (const item of data.items) store.put(item);
    const meta = tx.objectStore(META_STORE);
    meta.put({ key: "enrollments_meta", savedAt: data.savedAt, min_confidence: data.min_confidence, organization_id: data.organization_id });
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    // fallback para localStorage caso IndexedDB indisponível
    try {
      localStorage.setItem("kiosk_enrollment_cache", JSON.stringify(data));
    } catch {}
  }
}

export async function loadEnrollmentsCache(ttlMs: number): Promise<CachedEnrollments | null> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readonly");
    const metaReq = tx.objectStore(META_STORE).get("enrollments_meta");
    const itemsReq = tx.objectStore(STORE).getAll();
    const [meta, items] = await Promise.all([
      new Promise<any>((res) => { metaReq.onsuccess = () => res(metaReq.result); metaReq.onerror = () => res(null); }),
      new Promise<any[]>((res) => { itemsReq.onsuccess = () => res(itemsReq.result || []); itemsReq.onerror = () => res([]); }),
    ]);
    db.close();
    if (!meta || !items?.length) throw new Error("empty");
    if (Date.now() - meta.savedAt > ttlMs) return null;
    return { items, min_confidence: meta.min_confidence, savedAt: meta.savedAt, organization_id: meta.organization_id };
  } catch {
    // fallback localStorage
    try {
      const raw = localStorage.getItem("kiosk_enrollment_cache");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedEnrollments;
      if (!parsed.items?.length) return null;
      if (Date.now() - parsed.savedAt > ttlMs) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

export async function clearEnrollmentsCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(META_STORE).clear();
    db.close();
  } catch {}
  try { localStorage.removeItem("kiosk_enrollment_cache"); } catch {}
}
