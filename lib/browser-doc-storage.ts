/**
 * Site documents live in IndexedDB, not localStorage's small (~5 MiB) quota.
 * Only document JSON is stored here; small site-list/UI settings stay in localStorage.
 * An existing localStorage document is copied once and removed only after the
 * IndexedDB transaction commits. A failed migration keeps the original intact.
 */
import { storageKey } from "./storage-keys";

const DB_NAME = "tsumu-browser-documents";
const STORE_NAME = "documents";
const DOC_KEY = storageKey("doc-v1");
const DELETED_KEY = storageKey("site-deleted-v1");
const keyFor = (id: string) => `${DOC_KEY}:${id}`;
let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> | null {
  if (typeof window === "undefined" || !window.indexedDB) return null;
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

/** Read an existing document, migrating it atomically when it is still in localStorage. */
export async function readBrowserDoc(id: string): Promise<string | null> {
  const key = keyFor(id);
  const legacy = window.localStorage.getItem(key);
  const db = await database();
  if (!db) return legacy;

  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).get(id);
    let raw: string | null = null;
    let removeLegacy = false;
    request.onsuccess = () => {
      const stored = request.result as string | undefined;
      if (stored !== undefined) {
        raw = stored;
        removeLegacy = legacy !== null && legacy === stored;
      } else if (legacy !== null && window.localStorage.getItem(`${DELETED_KEY}:${id}`) === null) {
        raw = legacy;
        tx.objectStore(STORE_NAME).put(legacy, id);
        removeLegacy = true;
      }
    };
    tx.oncomplete = () => {
      if (removeLegacy) {
        try { window.localStorage.removeItem(key); } catch { /* The IndexedDB copy is committed. */ }
      }
      resolve(raw);
    };
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB read aborted"));
  });
}

export type BrowserDocWrite = "saved" | "conflict";

/** Compare-and-write in one IndexedDB transaction to prevent stale tabs overwriting newer edits. */
export async function writeBrowserDoc(id: string, raw: string, expected: string | null): Promise<BrowserDocWrite> {
  const db = await database();
  if (!db) {
    const key = keyFor(id);
    const current = window.localStorage.getItem(key);
    if (current !== expected && current !== raw) return "conflict";
    if (current !== raw) window.localStorage.setItem(key, raw);
    return "saved";
  }
  return new Promise<BrowserDocWrite>((resolve, reject) => {
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

/** Create-only write; unlike an autosave, even identical existing content is a collision. */
export async function createBrowserDoc(id: string, raw: string): Promise<boolean> {
  const db = await database();
  if (!db) {
    if (window.localStorage.getItem(keyFor(id)) !== null) return false;
    window.localStorage.setItem(keyFor(id), raw);
    return true;
  }
  // A record left only in localStorage must also count as occupied.
  if (window.localStorage.getItem(keyFor(id)) !== null) return false;
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const get = store.get(id);
    let created = false;
    get.onsuccess = () => {
      if (get.result !== undefined) return;
      store.add(raw, id);
      created = true;
    };
    tx.oncomplete = () => resolve(created);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB create failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB create aborted"));
  });
}

/** Called after the site deletion marker is committed (or to roll back a new site). */
export async function deleteBrowserDoc(id: string): Promise<void> {
  const db = await database();
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB delete aborted"));
    });
  }
  window.localStorage.removeItem(keyFor(id));
}

/** Assets may be shared across sites. Check both migrated and not-yet-opened documents. */
export async function otherBrowserDocs(ownId: string): Promise<string[]> {
  const docs = new Map<string, string>();
  const db = await database();
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const cursor = tx.objectStore(STORE_NAME).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const id = String(item.key);
        if (id !== ownId) docs.set(id, item.value as string);
        item.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB enumeration failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB enumeration aborted"));
    });
  }
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(`${DOC_KEY}:`)) continue;
    const id = key.slice(DOC_KEY.length + 1);
    if (id === ownId || docs.has(id)) continue;
    const raw = window.localStorage.getItem(key);
    if (raw !== null) docs.set(id, raw);
  }
  return [...docs.values()];
}
