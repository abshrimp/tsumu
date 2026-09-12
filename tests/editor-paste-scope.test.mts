import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { useEditor } from "../lib/store";
import { makeText } from "../lib/presets";
import * as clips from "../lib/clip-transfer";

// 実際の Editor の paste の effect を動かす。DOM への伝播とネイティブの貼り付けは、E2E でも確かめる。
function mount(context: "design" | "preview" | "modal" | "script" | "leaving" = "design", active = false) {
  const node = { ...makeText("Copied text"), id: "a", ...(active ? { type: "code" as const, code: { html: "<script>window.pasted = true</script>" } } : {}) };
  useEditor.getState().replaceDoc({ siteName: "Paste scope", assets: {}, pageOrder: ["p"], pages: {
    p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"] },
  }, nodes: { a: node } });
  useEditor.getState().select("a");
  useEditor.getState().setMode(context === "preview" ? "preview" : "design");
  const payload = JSON.stringify(clips.buildClipPayload(useEditor.getState().doc, { nodes: [node], rootIds: ["a"] }));
  const source = readFileSync("components/Editor.tsx", "utf8");
  const start = source.indexOf("    const pending = new Set<ReturnType<typeof startImageInsertion>>();");
  const end = source.indexOf("  }, [initialLoadComplete]);", start);
  assert.ok(start >= 0 && end > start);
  const code = transformSync(`export function attach() {${source.slice(start, end)}}`, { loader: "ts", format: "cjs" }).code;
  const handlers = new Map<string, (event: any) => void>();
  const notices: unknown[] = [];
  const confirmations: ((ok: boolean) => void)[] = [];
  let reads = 0, uploads = 0, cancelled = 0;
  const mod = { exports: {} as any };
  const globals = {
    useEditor,
    window: { addEventListener: (type: string, fn: any) => handlers.set(type, fn), removeEventListener: (type: string) => handlers.delete(type) },
    document: { querySelector: (selector: string) => {
      assert.equal(selector, ".se-backdrop, .modal-backdrop:not(.is-leaving)");
      return context === "modal" || context === "script" ? {} : null;
    } },
    setPasteNotice: (notice: unknown) => notices.push(notice),
    // Editor は、この ref を paste の effect の外に持つ。取り出したハンドラーに渡す。
    internalClipboardOwned: { current: false },
    clipboardPayload: clips.clipboardPayload, isOwnClip: clips.isOwnClip, activeContentNames: clips.activeContentNames,
    currentSiteId: () => "default",
    hasClipboardArtwork: () => true,
    clipboardArtworkFile: async () => new File(["image"], "image.png", { type: "image/png" }),
    startImageInsertion: () => { uploads++; return { done: new Promise(() => {}), cancel: () => { cancelled++; } }; },
    insertPointFor: () => ({ parent: { kind: "page", id: "p" } }),
    tr: (s: string) => s,
    showConfirm: () => new Promise<boolean>(resolve => confirmations.push(resolve)),
    userMessage: () => "error",
  };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(
    createRequire(resolve("package.json")), mod, mod.exports, ...Object.values(globals),
  );
  const cleanup = mod.exports.attach();
  return {
    notices, cleanup, confirmations,
    counts: () => ({ reads, uploads, cancelled }),
    snapshot: () => structuredClone({ doc: useEditor.getState().doc, past: useEditor.getState().past, future: useEditor.getState().future }),
    paste(kind: "elements" | "artwork", target = { tagName: "BODY", isContentEditable: false }) {
      let prevented = false;
      handlers.get("paste")!({ target, preventDefault: () => { prevented = true; }, clipboardData: {
        getData: () => { reads++; return kind === "elements" ? payload : ""; }, types: [], items: [],
      } });
      return prevented;
    },
  };
}

for (const context of ["preview", "modal", "script"] as const) for (const kind of ["elements", "artwork"] as const) {
  test(`${context}: ${kind} paste does not touch the hidden design or start an upload`, () => {
    const f = mount(context), before = f.snapshot();
    assert.equal(f.paste(kind), false);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.counts(), { reads: 0, uploads: 0, cancelled: 0 });
    assert.deepEqual(f.notices, []);
    f.cleanup();
  });
}
for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "DIV"]) test(`native ${tagName} paste is left alone`, () => {
  const f = mount(), before = f.snapshot();
  assert.equal(f.paste("elements", { tagName, isContentEditable: tagName === "DIV" }), false);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.counts().reads, 0);
  f.cleanup();
});
for (const context of ["design", "leaving"] as const) test(`${context}: normal element paste stays one Undo/Redo operation`, () => {
  const f = mount(context), before = f.snapshot();
  assert.equal(f.paste("elements"), true);
  const after = f.snapshot();
  assert.equal(Object.keys(after.doc.nodes).length, 2);
  assert.equal(after.past.length, before.past.length + 1);
  useEditor.getState().undo(); assert.deepEqual(useEditor.getState().doc, before.doc);
  useEditor.getState().redo(); assert.deepEqual(useEditor.getState().doc, after.doc);
  f.cleanup();
});
test("design artwork paste still starts an insertion and cancels it on unmount", () => {
  const f = mount();
  assert.equal(f.paste("artwork"), true);
  assert.equal(f.counts().uploads, 1);
  assert.equal(f.notices.length, 1);
  f.cleanup();
  assert.equal(f.counts().cancelled, 1);
});

for (const change of ["unchanged", "undo", "replace", "edit", "selection", "page", "preview", "script", "unmount", "newer", "decline"] as const) {
  test(`active clipboard confirmation does not outlive ${change}`, async () => {
    const f = mount("design", true);
    useEditor.getState().updateDoc(d => { d.siteName = "Edited"; });
    f.paste("elements");
    assert.equal(f.confirmations.length, 1);
    if (change === "undo") useEditor.getState().undo();
    if (change === "replace") useEditor.getState().replaceDoc(structuredClone(useEditor.getState().doc));
    if (change === "edit") useEditor.getState().updateDoc(d => { d.siteName = "Remote change"; });
    if (change === "selection") useEditor.getState().select(null);
    if (change === "page") useEditor.getState().setActivePage("other");
    if (change === "preview") useEditor.getState().setMode("preview");
    if (change === "script") useEditor.getState().openScriptEditor({ focusNodeId: "a" });
    if (change === "unmount") f.cleanup();
    if (change === "newer") f.paste("elements");
    const before = f.snapshot();
    f.confirmations[0](change !== "decline");
    await new Promise(resolve => setImmediate(resolve));
    if (change === "unchanged") {
      assert.equal(Object.keys(useEditor.getState().doc.nodes).length, 2);
      useEditor.getState().undo();
      assert.deepEqual(useEditor.getState().doc, before.doc);
    } else assert.deepEqual(f.snapshot(), before);
    f.cleanup();
    useEditor.getState().openScriptEditor(null);
  });
}
