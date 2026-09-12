/**
 * Node.js だけで動く結合テスト用の、最小限の非同期の IndexedDB の実装。
 * ブラウザの E2E テストでは、代わりに Chromium の実際の IndexedDB を使う。
 * 文書の保存が使う、文字列のキーと値による、単一の保存領域のトランザクションに対応する。
 * 1つの保存領域のトランザクションは、作った順に実行する（読み取り専用のトランザクションも含む）。
 * 意図的に、汎用の IndexedDB の実装にはしていない。
 */
export function fakeIndexedDB(): IDBFactory {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
  const queues = new WeakMap<Map<IDBValidKey, unknown>, (() => void)[]>();
  return {
    open(name: string) {
      const isNew = !databases.has(name);
      if (isNew) databases.set(name, new Map());
      const stores = databases.get(name)!;
      const db: any = {
        close() {},
        onversionchange: null,
        createObjectStore(storeName: string) {
          const map = new Map<IDBValidKey, unknown>();
          stores.set(storeName, map);
          return {};
        },
        transaction(storeName: string, mode = "readonly") {
          const map = stores.get(storeName);
          if (!map) throw new Error("Object store missing");
          const queue = queues.get(map) ?? [];
          queues.set(map, queue);
          const requests: (() => void)[] = [];
          let snapshot: Map<IDBValidKey, unknown>;
          let finished = false;
          let started = false;
          const release = () => {
            const index = queue.indexOf(start);
            queue.splice(index, 1);
            if (index === 0 && queue.length) queueMicrotask(queue[0]);
          };
          const transaction: any = {
            error: null,
            oncomplete: null, onerror: null, onabort: null,
            abort() {
              if (finished) return;
              finished = true;
              requests.length = 0;
              queueMicrotask(() => {
                try { transaction.onabort?.(); } finally { release(); }
              });
            },
          };
          const pump = () => {
            if (finished) return;
            const next = requests.shift();
            if (next) {
              next();
              queueMicrotask(pump);
              return;
            }
            // 書き込みを反映するのは、完了したトランザクションだけ。中断したものは捨てる。
            if (mode === "readwrite") {
              map.clear();
              for (const [key, value] of snapshot) map.set(key, value);
            }
            finished = true;
            try { transaction.oncomplete?.(); } finally { release(); }
          };
          const start = () => {
            if (finished || started) return;
            started = true;
            // 先のトランザクションが確定または中断した後で、スナップショットを取る。
            snapshot = new Map(map);
            pump();
          };
          function enqueue(item: any, action: () => unknown) {
            if (finished) throw new DOMException("Transaction finished", "TransactionInactiveError");
            requests.push(() => {
              try {
                item.result = action();
                item.onsuccess?.();
              } catch (error) {
                item.error = error;
                transaction.error = error;
                item.onerror?.();
                transaction.abort();
              }
            });
          }
          function request(action: () => unknown, write = false): any {
            if (write && mode !== "readwrite") throw new DOMException("Readonly transaction", "ReadOnlyError");
            const item: any = { result: undefined, error: null, onsuccess: null, onerror: null };
            enqueue(item, action);
            return item;
          }
          const objectStore = {
            get(id: IDBValidKey) { return request(() => snapshot.get(id)); },
            getKey(id: IDBValidKey) { return request(() => snapshot.has(id) ? id : undefined); },
            add(value: unknown, id: IDBValidKey) {
              return request(() => {
                if (snapshot.has(id)) throw new DOMException("Duplicate document", "ConstraintError");
                snapshot.set(id, value);
                return id;
              }, true);
            },
            put(value: unknown, id: IDBValidKey) { return request(() => { snapshot.set(id, value); return id; }, true); },
            delete(id: IDBValidKey) { return request(() => { snapshot.delete(id); }, true); },
            openCursor() {
              let entries: [IDBValidKey, unknown][] | undefined;
              let index = 0;
              const item: any = { result: null, error: null, onsuccess: null, onerror: null };
              const next = () => {
                entries ??= [...snapshot.entries()];
                if (index >= entries.length) return null;
                const [key, value] = entries[index++];
                return { key, value, continue: () => enqueue(item, next) };
              };
              enqueue(item, next);
              return item;
            },
          };
          transaction.objectStore = () => objectStore;
          queue.push(start);
          if (queue.length === 1) queueMicrotask(start);
          return transaction;
        },
      };
      const result: any = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (isNew) result.onupgradeneeded?.();
        result.onsuccess?.();
      });
      return result;
    },
  } as unknown as IDBFactory;
}
