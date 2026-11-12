/**
 * Cache SVG effect analysis by immutable uploaded asset path.
 *
 * A new upload always gets a new path; replacing its content therefore changes
 * the cache key. No document schema fields, migration markers, or SVG bytes are
 * persisted. Cache failures never block publishing.
 */
export interface SvgEffectAnalysis {
  svgFilter: boolean;
  width?: number;
  height?: number;
}

interface StoredAnalysis {
  path: string;
  analysis: SvgEffectAnalysis;
  savedAt: number;
}

const DB_NAME = "tsumu-svg-effects";
const STORE = "analysis";
const MAX_STORED = 4096;
const MAX_MEMORY = 1024;
const memory = new Map<string, SvgEffectAnalysis>();
let connection: Promise<IDBDatabase | null> | null = null;
let writes = 0;

function remember(path: string, analysis: SvgEffectAnalysis) {
  memory.delete(path);
  memory.set(path, analysis);
  if (memory.size > MAX_MEMORY) memory.delete(memory.keys().next().value!);
}

function valid(value: unknown): value is SvgEffectAnalysis {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SvgEffectAnalysis>;
  const size = (x: number | undefined) =>
    x === undefined || (typeof x === "number" && Number.isFinite(x) && x > 0);
  return typeof data.svgFilter === "boolean" && size(data.width) && size(data.height);
}

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (connection) return connection;
  connection = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DB_NAME, 1); }
    catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains(STORE)) return;
      const store = request.result.createObjectStore(STORE, { keyPath: "path" });
      store.createIndex("savedAt", "savedAt");
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
  });
  return connection;
}

export async function cachedSvgEffect(path: string): Promise<SvgEffectAnalysis | null> {
  const recent = memory.get(path);
  if (recent) return recent;
  const db = await database();
  if (!db) return null;
  return new Promise<SvgEffectAnalysis | null>((resolve) => {
    try {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(path);
      request.onsuccess = () => {
        const stored = request.result as StoredAnalysis | undefined;
        if (!valid(stored?.analysis)) { resolve(null); return; }
        remember(path, stored.analysis);
        resolve(stored.analysis);
      };
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

export function cacheSvgEffect(path: string, analysis: SvgEffectAnalysis): void {
  if (!path || !valid(analysis)) return;
  remember(path, analysis);
  // A persistent cache is optional. Failure to open/write IndexedDB is harmless.
  void (async () => {
    const db = await database();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        store.put({ path, analysis, savedAt: Date.now() } satisfies StoredAnalysis);
        // Bound storage without slowing each read or continuously rewriting entries.
        if (++writes % 64 === 0) {
          const count = store.count();
          count.onsuccess = () => {
            const excess = count.result - MAX_STORED;
            if (excess <= 0) return;
            let removed = 0;
            const cursor = store.index("savedAt").openKeyCursor();
            cursor.onsuccess = () => {
              const item = cursor.result;
              if (!item || removed >= excess) return;
              store.delete(item.primaryKey);
              removed += 1;
              item.continue();
            };
          };
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch { resolve(); }
    });
  })();
}
