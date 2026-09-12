import type { Page } from "@playwright/test";

const DB = "tsumu-documents";
const STORE = "documents";

/** 文書の保存を模擬せず、実際のブラウザの IndexedDB を使う。 */
export async function browserDoc(page: Page, siteId: string): Promise<string | null> {
  return page.evaluate(async ({ dbName, storeName, siteId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(siteId);
        request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, { dbName: DB, storeName: STORE, siteId });
}

export async function setBrowserDoc(page: Page, siteId: string, raw: string): Promise<void> {
  await page.evaluate(async ({ dbName, storeName, siteId, raw }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(raw, siteId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, { dbName: DB, storeName: STORE, siteId, raw });
}

export async function browserDocIds(page: Page): Promise<string[]> {
  return page.evaluate(async ({ dbName, storeName }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAllKeys();
        request.onsuccess = () => resolve((request.result as string[]).sort());
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, { dbName: DB, storeName: STORE });
}
