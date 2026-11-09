/**
 * Large browser documents live in IndexedDB. UI preferences and the site list
 * are small enough to remain in localStorage.
 */
import { storageKey } from "./storage-keys";

const DB_NAME = "tsumu-browser-documents";
const STORE_NAME = "documents";
const DELETED_KEY = storageKey("site-deleted-v1");
let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

export async function readBrowserDoc(id: string): Promise<string | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    let raw: string | null = null;
    request.onsuccess = () => { raw = (request.result as string | undefined) ?? null; };
    tx.oncomplete = () => resolve(raw);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB read aborted"));
  });
}

export async function hasBrowserDoc(id: string): Promise<boolean> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getKey(id);
    let exists = false;
    request.onsuccess = () => { exists = request.result !== undefined; };
    tx.oncomplete = () => resolve(exists);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB lookup failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB lookup aborted"));
  });
}

export type BrowserDocWrite = "saved" | "conflict";

/** Compare-and-write in one transaction prevents stale tabs overwriting newer edits. */
export async function writeBrowserDoc(id: string, raw: string, expected: string | null): Promise<BrowserDocWrite> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    let result: BrowserDocWrite = "conflict";
    request.onsuccess = () => {
      const current = (request.result as string | undefined) ?? null;
      if (current !== expected && current !== raw) return;
      result = "saved";
      if (current !== raw) store.put(raw, id);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

/** Create only, never overwrite an existing document. */
export async function createBrowserDoc(id: string, raw: string): Promise<boolean> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const read = store.getKey(id);
    let created = false;
    read.onsuccess = () => {
      if (read.result !== undefined) return;
      store.add(raw, id);
      created = true;
    };
    tx.oncomplete = () => resolve(created);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB create failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB create aborted"));
  });
}

export async function deleteBrowserDoc(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB delete aborted"));
  });
}

/** Include only active documents; a deleted site's assets are not referenced. */
export async function otherBrowserDocs(ownId: string): Promise<string[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const docs: string[] = [];
    const tx = db.transaction(STORE_NAME, "readonly");
    const cursor = tx.objectStore(STORE_NAME).openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      const id = String(entry.key);
      if (id !== ownId && window.localStorage.getItem(`${DELETED_KEY}:${id}`) === null) {
        docs.push(entry.value as string);
      }
      entry.continue();
    };
    tx.oncomplete = () => resolve(docs);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB enumeration failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB enumeration aborted"));
  });
}
