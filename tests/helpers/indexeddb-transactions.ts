import * as storage from "../../lib/browser-doc-storage";

function opened(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function settled(tx: IDBTransaction): Promise<string> {
  return new Promise(resolve => {
    tx.oncomplete = () => resolve("complete");
    tx.onabort = () => resolve("abort");
  });
}

export const transactionCases = ["commit", "abort", "duplicate"] as const;

/** Run unchanged against the Node fixture and Chromium's native IndexedDB. */
export async function transactionScenario(factory: IDBFactory, mode: typeof transactionCases[number]) {
  const db = await opened(factory, `transaction-${mode}`);
  try {
    const seed = db.transaction("documents", "readwrite");
    const seeded = settled(seed);
    seed.objectStore("documents").put("original", "source");
    seed.objectStore("documents").put("keep", "retained");
    await seeded;

    const tx = db.transaction("documents", "readwrite");
    const done = settled(tx);
    const store = tx.objectStore("documents");
    const events: string[] = [];
    store.put("edited", "source").onsuccess = () => events.push("put");
    store.delete("retained").onsuccess = () => events.push("delete");
    store.add("copy", "destination").onsuccess = () => {
      events.push("add");
      if (mode === "abort") tx.abort();
    };
    if (mode === "duplicate") store.add("overwrite", "source");
    // Queue the reader before the writer settles: it must see the full commit
    // or the original data, never an uncommitted snapshot.
    const read = db.transaction("documents", "readonly");
    const readDone = settled(read);
    const records: Record<string, unknown> = {};
    for (const key of ["source", "retained", "destination"]) {
      const request = read.objectStore("documents").get(key);
      request.onsuccess = () => { records[key] = request.result ?? null; };
    }
    const outcome = await done;
    const error = tx.error?.name ?? null;
    await readDone;
    return { outcome, error, events, records };
  } finally { db.close(); }
}

export function expectedTransaction(mode: typeof transactionCases[number]) {
  return {
    outcome: mode === "commit" ? "complete" : "abort",
    error: mode === "duplicate" ? "ConstraintError" : null,
    events: ["put", "delete", "add"],
    records: mode === "commit"
      ? { source: "edited", retained: null, destination: "copy" }
      : { source: "original", retained: "keep", destination: null },
  };
}

/** Exercise the production create-only path concurrently. */
export async function browserDocumentCreateScenario() {
  const creates = await Promise.all([
    storage.createBrowserDoc("created-site", "original"),
    storage.createBrowserDoc("created-site", "collision"),
  ]);
  const created = await storage.readBrowserDoc("created-site");
  await storage.deleteBrowserDoc("created-site");
  return { creates, created };
}

export const expectedCreate = { creates: [true, false], created: "original" };

/** Exercise real compare-and-write, idempotent retry, enumeration and deletion. */
export async function browserDocumentScenario() {
  await storage.createBrowserDoc("site", "original");
  const writes = await Promise.all([
    storage.writeBrowserDoc("site", "first edit", "original"),
    storage.writeBrowserDoc("site", "stale edit", "original"),
  ]);
  const saved = await storage.readBrowserDoc("site");
  const retry = await storage.writeBrowserDoc("site", "first edit", "original");
  await storage.createBrowserDoc("other", "other document");
  const others = await storage.otherBrowserDocs("site");
  await storage.deleteBrowserDoc("site");
  const deleted = await storage.readBrowserDoc("site");
  const retained = await storage.readBrowserDoc("other");
  return { writes, saved, retry, others, deleted, retained };
}

export const expectedDocument = {
  writes: ["saved", "conflict"],
  saved: "first edit", retry: "saved", others: ["other document"],
  deleted: null, retained: "other document",
};

export async function cursorScenario(factory: IDBFactory, abort: boolean) {
  const db = await opened(factory, `cursor-${abort}`);
  try {
    const seed = db.transaction("documents", "readwrite");
    const seeded = settled(seed);
    seed.objectStore("documents").put("one", "a");
    seed.objectStore("documents").put("two", "b");
    await seeded;
    const tx = db.transaction("documents", "readonly");
    const done = settled(tx);
    const seen: unknown[] = [];
    const cursor = tx.objectStore("documents").openCursor();
    cursor.onsuccess = () => {
      seen.push(cursor.result?.value ?? null);
      if (abort && seen.length === 1) {
        // Continuing before abort must not deliver another successful cursor event.
        cursor.result!.continue();
        tx.abort();
      }
      // Without continue(), the transaction must still complete.
    };
    const outcome = await done;
    return { outcome, seen };
  } finally { db.close(); }
}
