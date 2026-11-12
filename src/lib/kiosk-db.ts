// Banco IndexedDB ÚNICO do totem de ponto.
// Evita o bug em que kiosk-cache.ts e kiosk-offline-queue.ts abriam o mesmo
// banco com schemas diferentes e "venciam" um ao outro, sumindo com stores.
const DB_NAME = "kiosk_ponto";
const DB_VERSION = 2;

export const STORES = {
  ENROLLMENTS: "enrollments",
  META: "meta",
  PUNCH_QUEUE: "punch_queue",
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.ENROLLMENTS)) {
        db.createObjectStore(STORES.ENROLLMENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.PUNCH_QUEUE)) {
        db.createObjectStore(STORES.PUNCH_QUEUE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function resetDbPromise() {
  dbPromise = null;
}