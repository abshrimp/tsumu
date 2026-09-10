import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDocPatch, createDocPatch } from "../lib/doc-patch";
import { sameDocContent, shareUnchangedDoc } from "../lib/doc-share";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(count = 40): SiteDoc {
  const ids = Array.from({ length: count }, (_, i) => `node-${i}`);
  return {
    schemaVersion: 1,
    siteName: "Structural sharing",
    colorPalette: ["#111111", "#eeeeee"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ids },
      about: { id: "about", name: "About", slug: "about", title: "About", description: "", children: [] },
    },
    pageOrder: ["home", "about"],
    nodes: Object.fromEntries(ids.map((id) => [
      id, { ...makeBox(), id, name: id, styles: { base: { default: { color: "red" } } } },
    ])),
    assets: {
      logo: { id: "logo", name: "logo.png", src: "", storagePath: "assets/logo.png", type: "image", width: 10, height: 10 },
    },
    components: {},
  } as SiteDoc;
}

const state = () => useEditor.getState();
function open(doc = fixture()): SiteDoc {
  state().endGesture();
  state().replaceDoc(doc);
  return state().doc;
}

test("a structural edit keeps every untouched page, node, asset and setting by reference", () => {
  const before = open();
  state().updateDoc((d) => {
    d.nodes["node-3"].name = "Renamed";
    d.pages.about.title = "About us";
  });
  const after = state().doc;
  assert.notEqual(after, before);
  assert.equal(after.nodes["node-3"].name, "Renamed");
  assert.notEqual(after.nodes["node-3"], before.nodes["node-3"]);
  assert.notEqual(after.pages.about, before.pages.about);
  for (const id of Object.keys(before.nodes)) {
    if (id !== "node-3") assert.equal(after.nodes[id], before.nodes[id], `${id} must be shared`);
  }
  assert.equal(after.pages.home, before.pages.home);
  assert.equal(after.assets, before.assets, "an unchanged collection is shared as a whole");
  assert.equal(after.colorPalette, before.colorPalette);
  assert.equal(after.pageOrder, before.pageOrder);
  // 履歴に積まれた編集前の文書は書き換わらず、元に戻すと同じ参照へ戻る
  assert.equal(before.nodes["node-3"].name, "node-3");
  state().undo();
  assert.equal(state().doc, before);
  state().redo();
  assert.equal(state().doc, after);
});

test("a structural edit that changes nothing keeps the document, history and redo stack", () => {
  const before = open();
  state().updateNode("node-0", { name: "Undoable" });
  state().undo();
  const current = state().doc;
  const { past, future } = state();
  assert.equal(future.length, 1);
  state().updateDoc((d) => {
    d.nodes["node-1"].name = "node-1";
    d.pageOrder = [...d.pageOrder];
    // JSON に出ない undefined の項目は、保存される内容を変えない
    (d.nodes["node-2"] as unknown as Record<string, unknown>).customTag = undefined;
  });
  assert.equal(state().doc, current);
  assert.equal(state().past, past);
  assert.equal(state().future, future);
  assert.equal(current, before);
});

test("after a structural edit, the incremental save sends only what changed", () => {
  const synced = open(fixture(300));
  state().insertNodes([{ ...makeBox(), id: "added", name: "Added" }], "added", { kind: "page", id: "home" }, 0);
  const next = state().doc;
  const patch = createDocPatch(synced, next);
  assert.deepEqual(patch?.map((op) => op.path), [["pages", "home"], ["nodes", "added"]]);
  // 変わっていない要素は参照が同じなので、差分の作成で直列化されない
  const original = JSON.stringify;
  let serialized = 0;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    serialized++;
    return original(...args);
  }) as typeof JSON.stringify;
  try {
    createDocPatch(synced, next);
  } finally {
    JSON.stringify = original;
  }
  assert.ok(serialized <= 4, `only the changed page and the new node are compared (${serialized} serializations)`);
});

test("adding, removing and reordering entries is never mistaken for an unchanged document", () => {
  const before = fixture(4);
  const removed = structuredClone(before);
  delete removed.nodes["node-3"];
  removed.pages.home.children = removed.pages.home.children.filter((id) => id !== "node-3");
  const shared = shareUnchangedDoc(before, removed);
  assert.deepEqual(shared, removed);
  assert.equal(Object.hasOwn(shared.nodes, "node-3"), false);
  assert.equal(shared.nodes["node-0"], before.nodes["node-0"]);

  // キーの並びが変わるだけでも、保存される JSON は変わる
  const reordered = structuredClone(before);
  const first = reordered.nodes["node-0"];
  delete reordered.nodes["node-0"];
  reordered.nodes["node-0"] = first;
  const result = shareUnchangedDoc(before, reordered);
  assert.notEqual(result, before);
  assert.equal(JSON.stringify(result), JSON.stringify(reordered));
  assert.equal(sameDocContent(before, reordered), false);

  const extraRoot = { ...structuredClone(before), siteUrl: "https://example.com" };
  assert.equal(JSON.stringify(shareUnchangedDoc(before, extraRoot)), JSON.stringify(extraRoot));
  assert.equal(sameDocContent(before, extraRoot), false);
});

test("sharing never changes the saved content and never mutates either input", () => {
  // 決まった乱数列で、要素・ページ・設定への変更を組み合わせる
  let seed = 12345;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const mutations: Array<(d: SiteDoc) => void> = [
    (d) => { d.nodes[`node-${random(40)}`].name = `n${random(3)}`; },
    (d) => { d.nodes[`node-${random(40)}`].styles = { base: { default: { color: random(2) ? "red" : "blue" } } }; },
    (d) => { delete d.nodes[`node-${random(40)}`]; },
    (d) => { d.nodes[`extra-${random(5)}`] = { ...makeBox(), id: "extra", name: "Extra" }; },
    (d) => { d.pages.home.children = [...d.pages.home.children].reverse(); },
    (d) => { d.siteName = random(2) ? "Structural sharing" : "Renamed"; },
    (d) => { d.colorPalette = random(2) ? ["#111111", "#eeeeee"] : undefined; },
    (d) => { d.assets = {}; },
    (d) => { d.components = random(2) ? {} : undefined; },
    (d) => { (d as unknown as Record<string, unknown>).lang = random(2) ? "ja" : undefined; },
    (d) => { d.nodes = { ...d.nodes }; },
    () => {},
  ];
  for (let round = 0; round < 400; round++) {
    const before = fixture();
    const after = structuredClone(before);
    for (let i = random(4); i >= 0; i--) mutations[random(mutations.length)](after);
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    const result = shareUnchangedDoc(before, after);
    assert.equal(JSON.stringify(result), afterJson, `round ${round}: saved content`);
    assert.equal(result === before, beforeJson === afterJson, `round ${round}: no-op detection`);
    assert.equal(sameDocContent(before, after), beforeJson === afterJson, `round ${round}: comparison`);
    assert.equal(JSON.stringify(before), beforeJson, `round ${round}: before is not mutated`);
    assert.equal(JSON.stringify(after), afterJson, `round ${round}: after is not mutated`);
    // 差分保存も同じ比較を使う。差分を当てた結果は、編集後と同じ内容になる
    const patch = createDocPatch(before, result);
    if (patch) {
      assert.equal(patch.length === 0, beforeJson === afterJson, `round ${round}: empty patch`);
      if (patch.length) {
        assert.equal(sameDocContent(applyDocPatch(before, patch), after), true, `round ${round}: patch round trip`);
      }
    }
  }
});

test("keys that collide with Object.prototype stay own entries of the shared collections", () => {
  const before = fixture(2);
  const after = structuredClone(before);
  Object.defineProperty(after.nodes, "__proto__", {
    value: { ...makeBox(), id: "__proto__", name: "Own" }, enumerable: true, writable: true, configurable: true,
  });
  const result = shareUnchangedDoc(before, after);
  assert.equal(Object.getPrototypeOf(result.nodes), Object.prototype);
  assert.equal(Object.hasOwn(result.nodes, "__proto__"), true);
  assert.equal(JSON.stringify(result), JSON.stringify(after));
  assert.equal(result.nodes["node-0"], before.nodes["node-0"]);
});

test("values that differ in memory but serialize identically count as unchanged", () => {
  const before = fixture(3);
  const settings = before as unknown as Record<string, unknown>;
  settings.dataRevalidate = null;
  (before.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = { a: "1" };
  const after = structuredClone(before);
  // NaN は JSON で null になり、undefined の項目は JSON に出ない
  (after as unknown as Record<string, unknown>).dataRevalidate = Number.NaN;
  (after.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = { a: "1", b: undefined };
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  assert.equal(shareUnchangedDoc(before, after), before);
  assert.equal(sameDocContent(before, after), true);

  // 配列とオブジェクト、キーの並びの違いは別の内容として扱う
  const reshaped = structuredClone(before);
  (reshaped.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = [["a", "1"]];
  assert.equal(sameDocContent(before, reshaped), false);
  const reordered = structuredClone(before);
  reordered.nodes["node-1"] = { name: "node-1", ...reordered.nodes["node-1"] };
  assert.equal(JSON.stringify(reordered) === JSON.stringify(before), false);
  assert.equal(sameDocContent(before, reordered), false);
  assert.equal(shareUnchangedDoc(before, reordered).nodes["node-1"], reordered.nodes["node-1"]);
});

test("a value nested too deeply to walk is still compared by its serialized form", () => {
  const deep = (depth: number) => {
    let value: unknown = "leaf";
    for (let i = 0; i < depth; i++) value = [value];
    return value;
  };
  const before = fixture(2);
  (before.nodes["node-0"] as unknown as Record<string, unknown>).htmlAttrs = deep(50_000);
  const same = { ...before, nodes: { ...before.nodes, "node-0": { ...before.nodes["node-0"], htmlAttrs: deep(50_000) } } } as unknown as SiteDoc;
  const changed = { ...before, nodes: { ...before.nodes, "node-0": { ...before.nodes["node-0"], htmlAttrs: deep(50_001) } } } as unknown as SiteDoc;
  assert.equal(sameDocContent(before, same), JSON.stringify(before) === JSON.stringify(same));
  assert.equal(sameDocContent(before, changed), false);
  assert.equal(shareUnchangedDoc(before, same), before);
});
