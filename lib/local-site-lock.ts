import { storageKey } from "./storage-keys";

const list = storageKey("sites-v1");
const marker = storageKey("sites-lock-v1");
const unavailable = () => new Error("ブラウザにサイトを保存できませんでした。空き容量と保存設定を確認してください。");

/** All site-list changes use one cross-tab lock for their complete read/modify/write. */
export async function withLocalSiteListLock<T>(change: () => T): Promise<T> {
  if (!window.navigator) return change(); // In-memory hosts have no other tabs.
  if (window.navigator.locks) return window.navigator.locks.request(list, change);
  // HTTP origins can have IndexedDB without Web Locks.
  if (!window.indexedDB) throw unavailable();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = window.indexedDB.open(list, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("lock");
    open.onerror = () => reject(unavailable());
    open.onsuccess = () => resolve(open.result);
  });
  const started = Date.now();
  const retry = Symbol();
  try {
    for (;;) {
      const result = await new Promise<T | typeof retry>((resolve, reject) => {
        const tx = db.transaction("lock", "readwrite");
        const store = tx.objectStore("lock");
        const read = store.get("revision");
        let result: T | typeof retry;
        read.onsuccess = () => {
          try {
            const storage = window.localStorage;
            const previous: { token: string; time: number } | undefined = read.result;
            const seen = storage.getItem(marker);
            // The other tab's IndexedDB transaction can commit before its
            // localStorage updates reach this process. Its marker was written
            // after the list and document, so wait until both are observable.
            // A new operation can also follow an explicit storage clear or
            // an interrupted transaction. An old, stable mismatch is recoverable.
            if (previous && seen !== previous.token &&
                (previous.time >= started - 2000 || Date.now() - started < 2000)) {
              result = retry;
              return;
            }
            const token = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(16).padStart(8, "0")).join("");
            if (seen === null) storage.setItem(marker, "0000000000000000"); // reserve space before changing any site
            result = change();
            storage.setItem(marker, token);
            store.put({ token, time: Date.now() }, "revision");
          } catch (error) { tx.abort(); reject(error); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(unavailable());
      });
      if (result !== retry) return result as T;
      if (Date.now() - started >= 2500) throw unavailable();
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  } finally { db.close(); }
}
