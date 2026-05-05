/** Web-only: store downloaded blobs in IndexedDB (in-app library, no OS Downloads folder). */

const DB_NAME = "3i-learning-web-offline";
const STORE = "files";
const DB_VERSION = 1;

export type WebOfflineRecord = {
  userId: number;
  itemType: "lecture" | "material";
  itemId: number;
  localFilename: string;
  title: string;
  fileType: string;
  mimeType: string;
  blob: Blob;
  downloadedAt: number;
};

function keyOf(userId: number, itemType: string, itemId: number): string {
  return `${userId}:${itemType}:${itemId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function putWebOffline(record: WebOfflineRecord): Promise<void> {
  const db = await openDb();
  const k = keyOf(record.userId, record.itemType, record.itemId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.objectStore(STORE).put(record, k);
  });
  db.close();
}

export async function getWebOffline(userId: number, itemType: string, itemId: number): Promise<WebOfflineRecord | null> {
  const db = await openDb();
  const k = keyOf(userId, itemType, itemId);
  const record = await new Promise<WebOfflineRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const q = tx.objectStore(STORE).get(k);
    q.onerror = () => reject(q.error ?? new Error("IndexedDB read failed"));
    q.onsuccess = () => resolve((q.result as WebOfflineRecord) ?? null);
  });
  db.close();
  return record;
}

export async function removeWebOffline(userId: number, itemType: string, itemId: number): Promise<void> {
  const db = await openDb();
  const k = keyOf(userId, itemType, itemId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    tx.objectStore(STORE).delete(k);
  });
  db.close();
}

export async function hasWebOffline(userId: number, itemType: string, itemId: number): Promise<boolean> {
  const r = await getWebOffline(userId, itemType, itemId);
  return r != null;
}

export async function listWebOfflineKeys(): Promise<string[]> {
  const db = await openDb();
  const keys = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const q = tx.objectStore(STORE).getAllKeys();
    q.onerror = () => reject(q.error ?? new Error("IndexedDB keys failed"));
    q.onsuccess = () => resolve((q.result as string[]) ?? []);
  });
  db.close();
  return keys;
}
