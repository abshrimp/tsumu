/**
 * Minimal asynchronous IndexedDB implementation for Node-only integration fixtures.
 * Browser E2E tests use Chromium's real IndexedDB instead.
 */
export function fakeIndexedDB(): IDBFactory {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
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
        transaction(storeName: string) {
          const map = stores.get(storeName);
          if (!map) throw new Error("Object store missing");
          let pending = 0;
          let finished = false;
          const transaction: any = {
            error: null,
            oncomplete: null, onerror: null, onabort: null,
            abort() {
              if (finished) return;
              finished = true;
              transaction.error = new Error("Transaction aborted");
              queueMicrotask(() => transaction.onabort?.());
            },
          };
          const maybeComplete = () => queueMicrotask(() => {
            if (pending === 0 && !finished) {
              finished = true;
              transaction.oncomplete?.();
            }
          });
          function request(action: () => unknown): any {
            pending++;
            const item: any = { result: undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              if (finished) return;
              try {
                item.result = action();
                item.onsuccess?.();
              } catch (error) {
                item.error = error;
                transaction.error = error;
                item.onerror?.();
                transaction.abort();
              } finally {
                pending--;
                maybeComplete();
              }
            });
            return item;
          }
          const objectStore = {
            get(id: IDBValidKey) { return request(() => map.get(id)); },
            getKey(id: IDBValidKey) { return request(() => map.has(id) ? id : undefined); },
            add(value: unknown, id: IDBValidKey) {
              return request(() => {
                if (map.has(id)) throw new Error("Duplicate document");
                map.set(id, value);
              });
            },
            put(value: unknown, id: IDBValidKey) { return request(() => { map.set(id, value); }); },
            delete(id: IDBValidKey) { return request(() => { map.delete(id); }); },
            openCursor() {
              pending++;
              const entries = [...map.entries()];
              let index = 0;
              const item: any = { result: null, onsuccess: null, onerror: null };
              const next = () => {
                if (index >= entries.length) {
                  item.result = null;
                  item.onsuccess?.();
                  pending--;
                  maybeComplete();
                  return;
                }
                const [key, value] = entries[index++];
                item.result = { key, value, continue: () => queueMicrotask(next) };
                item.onsuccess?.();
              };
              queueMicrotask(next);
              return item;
            },
          };
          transaction.objectStore = () => objectStore;
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
