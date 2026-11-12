import { storageKey } from "./storage-keys";

const list = storageKey("sites-v1");
const marker = storageKey("sites-lock-v1");
const unavailable = () => new Error("ブラウザにサイトを保存できませんでした。空き容量と保存設定を確認してください。");

/** サイトの一覧の変更はすべて、読み取り・変更・書き込みの全体を、タブ間で共有する1つのロックの中で行う。 */
export async function withLocalSiteListLock<T>(change: () => T): Promise<T> {
  if (!window.navigator) return change(); // メモリだけで動く環境には、他のタブが無い。
  if (window.navigator.locks) return window.navigator.locks.request(list, change);
  // HTTP のオリジンでは、Web Locks が無くても IndexedDB は使えることがある。
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
            // 他のタブの IndexedDB のトランザクションは、その localStorage の更新がこのプロセスに
            // 届く前に確定することがある。印は一覧と文書の後に書かれるため、両方が
            // 見えるようになるまで待つ。
            // 新しい操作が、明示的な保存領域の消去や、中断したトランザクションの後に来ることもある。
            // 古いまま変わらない食い違いは、回復できるものとして扱う。
            if (previous && seen !== previous.token &&
                (previous.time >= started - 2000 || Date.now() - started < 2000)) {
              result = retry;
              return;
            }
            const token = Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(16).padStart(8, "0")).join("");
            if (seen === null) storage.setItem(marker, "0000000000000000"); // サイトを変更する前に、領域を確保しておく
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
