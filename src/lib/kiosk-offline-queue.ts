// Fila offline de batidas do totem de ponto
// Salva localmente quando sem internet e sincroniza quando voltar online

const DB_NAME = "kiosk_ponto";
const DB_VERSION = 1;
const PUNCH_QUEUE_STORE = "punch_queue";

export interface QueuedPunch {
  id: string; // local id
  employee_id: string;
  punch_type: string;
  selfie_url?: string | null;
  face_descriptor?: number[] | null;
  client_distance?: number | null;
  client_score?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  created_at: number; // timestamp
  attempts: number;
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
      if (!db.objectStoreNames.contains("enrollments")) {
        db.createObjectStore("enrollments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(PUNCH_QUEUE_STORE)) {
        db.createObjectStore(PUNCH_QUEUE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function generateId() {
  return `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function enqueuePunch(punch: Omit<QueuedPunch, "id" | "created_at" | "attempts">): Promise<QueuedPunch> {
  const item: QueuedPunch = {
    ...punch,
    id: generateId(),
    created_at: Date.now(),
    attempts: 0,
  };
  try {
    const db = await openDb();
    const tx = db.transaction([PUNCH_QUEUE_STORE], "readwrite");
    tx.objectStore(PUNCH_QUEUE_STORE).put(item);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return item;
  } catch {
    // Fallback localStorage
    try {
      const key = "kiosk_punch_queue";
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(item);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch {}
    return item;
  }
}

export async function getQueuedPunches(): Promise<QueuedPunch[]> {
  try {
    const db = await openDb();
    const tx = db.transaction([PUNCH_QUEUE_STORE], "readonly");
    const req = tx.objectStore(PUNCH_QUEUE_STORE).getAll();
    const items = await new Promise<QueuedPunch[]>((res) => {
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
    db.close();
    // Ordena por created_at
    return items.sort((a, b) => a.created_at - b.created_at);
  } catch {
    try {
      const key = "kiosk_punch_queue";
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const arr = JSON.parse(raw) as QueuedPunch[];
      return arr.sort((a, b) => a.created_at - b.created_at);
    } catch {
      return [];
    }
  }
}

export async function removeQueuedPunch(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([PUNCH_QUEUE_STORE], "readwrite");
    tx.objectStore(PUNCH_QUEUE_STORE).delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
  try {
    const key = "kiosk_punch_queue";
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const arr = JSON.parse(raw) as QueuedPunch[];
    const filtered = arr.filter((p) => p.id !== id);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {}
}

export async function incrementPunchAttempt(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([PUNCH_QUEUE_STORE], "readwrite");
    const store = tx.objectStore(PUNCH_QUEUE_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as QueuedPunch | undefined;
      if (item) {
        item.attempts = (item.attempts || 0) + 1;
        store.put(item);
      }
    };
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}
