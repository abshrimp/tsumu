import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createInitialDoc } from "../lib/presets";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";

// 新しいバンドルで、ストアの読み込みと、比較してから書く処理の基準を切り離す。
// 実際の保存の関数とトランザクションの実装はそのまま使い、
// 失敗するブラウザの保存領域の境界だけを差し込む。
const bundled = await build({
  stdin: { contents: `export { hydrateBrowserDoc, persistDoc } from './lib/store';
    export { createBrowserDoc, readBrowserDoc, writeBrowserDoc } from './lib/browser-doc-storage';`,
    resolveDir: resolve("."), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
});

async function fixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const module = { exports: {} as typeof import("../lib/store") & typeof import("../lib/browser-doc-storage") };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(
    createRequire(resolve("package.json")), module, module.exports,
  );
  let reads = 0, failAt = 0, deleted = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    indexedDB: fakeIndexedDB(), location: { pathname: "/sites/recovery" },
    localStorage: {
      getItem(key: string) {
        if (key === "tsumu-site-deleted-v1:recovery") {
          if (++reads === failAt) throw new DOMException("Temporarily unavailable", "SecurityError");
          return deleted ? "1" : null;
        }
        return null;
      },
    },
  } });
  const api = module.exports;
  const original = createInitialDoc();
  await api.createBrowserDoc("recovery", JSON.stringify(original));
  await api.hydrateBrowserDoc();
  return {
    ...api, original,
    failMarkerRead(n: number) { reads = 0; failAt = n; },
    deleteSite() { deleted = true; },
    raw: () => api.readBrowserDoc("recovery"),
    dispose() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

for (const next of ["edit", "undo"] as const) {
  test(`a post-commit marker read failure does not block the next ${next}`, async () => {
    const f = await fixture();
    try {
      const first = { ...f.original, siteName: "First edit" };
      f.failMarkerRead(2); // 事前の確認は成功する。IndexedDB は、この読み取りの前に確定する。
      assert.equal(await f.persistDoc(first), "error");
      assert.equal(await f.raw(), JSON.stringify(first), "the write has already committed");
      const latest = next === "undo" ? f.original : { ...first, siteName: "Latest edit" };
      assert.equal(await f.persistDoc(latest), "saved", "recovery must use the committed baseline");
      assert.equal(await f.raw(), JSON.stringify(latest));
    } finally { f.dispose(); }
  });
}

test("a preflight storage failure leaves the persisted baseline unchanged and retryable", async () => {
  const f = await fixture();
  try {
    const next = { ...f.original, siteName: "Retry" };
    f.failMarkerRead(1);
    assert.equal(await f.persistDoc(next), "error");
    assert.equal(await f.raw(), JSON.stringify(f.original));
    assert.equal(await f.persistDoc(next), "saved");
    assert.equal(await f.raw(), JSON.stringify(next));
  } finally { f.dispose(); }
});

test("post-commit recovery still rejects a genuinely newer write from another tab", async () => {
  const f = await fixture();
  try {
    const first = { ...f.original, siteName: "First edit" };
    f.failMarkerRead(2);
    assert.equal(await f.persistDoc(first), "error");
    const remote = JSON.stringify({ ...first, siteName: "Other tab" });
    assert.equal(await f.writeBrowserDoc("recovery", remote, JSON.stringify(first)), "saved");
    assert.equal(await f.persistDoc({ ...first, siteName: "Stale local edit" }), "error");
    assert.equal(await f.raw(), remote);
  } finally { f.dispose(); }
});

test("post-commit recovery cannot bypass a deletion marker", async () => {
  const f = await fixture();
  try {
    const first = { ...f.original, siteName: "First edit" };
    f.failMarkerRead(2);
    assert.equal(await f.persistDoc(first), "error");
    f.deleteSite();
    assert.equal(await f.persistDoc(f.original), "deleted");
    assert.equal(await f.raw(), JSON.stringify(first));
  } finally { f.dispose(); }
});
