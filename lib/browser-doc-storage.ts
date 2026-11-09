/**
 * Browser-only site documents are stored in IndexedDB.
 * Site lists and small UI preferences stay in localStorage.
 */
const DB_NAME = "tsumu-documents";
const STORE_NAME = "documents";

let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable"));
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
  }).catch((error: unknown) => {
    connection = null;
    throw error;
  });
  return connection;
}

export async function readBrowserDoc(id: string): Promise<string | null> {
  const db = await openDatabase();
  return new Promise<string | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    let result: string | null = null;
    request.onsuccess = () => { result = (request.result as string | undefined) ?? null; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB read failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB read aborted"));
  });
}

export type BrowserDocWriteResult = "saved" | "conflict";

/** An atomic compare-and-write prevents stale tabs overwriting newer snapshots. */
export async function writeBrowserDoc(
  id: string, raw: string, expected: string | null,
): Promise<BrowserDocWriteResult> {
  const db = await openDatabase();
  return new Promise<BrowserDocWriteResult>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    let outcome: BrowserDocWriteResult = "conflict";
    request.onsuccess = () => {
      const current = (request.result as string | undefined) ?? null;
      if (current !== expected && current !== raw) return;
      outcome = "saved";
      if (current !== raw) store.put(raw, id);
    };
    transaction.oncomplete = () => resolve(outcome);
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
  });
}

/** A site creation must not overwrite a preexisting or orphaned document. */
export async function createBrowserDoc(id: string, raw: string): Promise<boolean> {
  const db = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    let created = false;
    request.onsuccess = () => {
      if (request.result !== undefined) return;
      store.add(raw, id);
      created = true;
    };
    transaction.oncomplete = () => resolve(created);
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB create failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB create aborted"));
  });
}

export async function deleteBrowserDoc(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB delete aborted"));
  });
}

/** Asset references in other sites must be considered before remote assets are deleted. */
export async function otherBrowserDocs(excludedId: string): Promise<string[]> {
  const db = await openDatabase();
  return new Promise<string[]>((resolve, reject) => {
    const documents: string[] = [];
    const transaction = db.transaction(STORE_NAME, "readonly");
    const cursor = transaction.objectStore(STORE_NAME).openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (entry.key !== excludedId) documents.push(entry.value as string);
      entry.continue();
    };
    transaction.oncomplete = () => resolve(documents);
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB enumeration failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB enumeration aborted"));
  });
}
