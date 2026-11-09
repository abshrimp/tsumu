import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { useEditor } from "../lib/store";
import { readRestoreJson } from "../lib/publish-security";
import { IMPORT_LIMITS, validateImportedDoc } from "../lib/site-import";
import { sanitizeImportedInlineIcons } from "../lib/imported-svg";
import { createInitialDoc, makeIcon } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8");
const restoreCode = transformSync(source.slice(source.indexOf("async function restoreFrom("), source.indexOf("function PublishHistory(")), { loader: "tsx" }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(validate: typeof validateImportedDoc = validateImportedDoc) {
  const doc = { siteName: "Original", assets: {}, nodes: {}, pages: { p: { id: "p", name: "Home", title: "", description: "", slug: "", children: [] } }, pageOrder: ["p"] };
  useEditor.getState().replaceDoc(doc);
  const revision = useEditor.getState().historyRevision;
  const restored = { ...doc, siteName: "Backup" };
  const response = deferred<Response>();
  const confirm = deferred<boolean>();
  let mounted = true, confirmations = 0;
  const run = new Function("fetch", "showConfirm", "useEditor", "tr", "readRestoreJson", "IMPORT_LIMITS", "validateImportedDoc", "sanitizeImportedInlineIcons", `${restoreCode}; return restoreFrom;`)(
    () => response.promise, () => { confirmations++; return confirm.promise; }, useEditor, (s: string) => s,
    readRestoreJson, IMPORT_LIMITS, validate, sanitizeImportedInlineIcons,
  ) as (url: string, label: string, current: () => boolean) => Promise<boolean>;
  return { restored, response, confirm, cancel: () => { mounted = false; }, get confirmations() { return confirmations; },
    run: () => run("https://example.test/backup", "yesterday", () => mounted && useEditor.getState().historyRevision === revision) };
}

test("history restore is cancelled before confirmation when its panel or history changes while fetching", async () => {
  for (const stop of ["unmount", "replace"] as const) {
    const f = fixture(); const result = f.run();
    if (stop === "unmount") f.cancel();
    else useEditor.getState().replaceDoc({ ...useEditor.getState().doc, siteName: "Another document" });
    const before = useEditor.getState().doc;
    f.response.resolve(Response.json(f.restored));
    await tick();
    assert.equal(f.confirmations, 0);
    assert.equal(await result, false);
    assert.equal(useEditor.getState().doc, before);
  }
});
test("history restore cannot overwrite a replaced document or closed target after confirmation", async () => {
  for (const stop of ["unmount", "replace"] as const) {
    const f = fixture(); const result = f.run(); f.response.resolve(Response.json(f.restored)); await tick();
    assert.equal(f.confirmations, 1);
    if (stop === "unmount") f.cancel();
    else useEditor.getState().replaceDoc({ ...useEditor.getState().doc, siteName: "Another document" });
    const before = useEditor.getState().doc; f.confirm.resolve(true);
    assert.equal(await result, false); assert.equal(useEditor.getState().doc, before);
  }
});
test("an active history restore remains one undoable operation and preserves ordinary edits for undo", async () => {
  const f = fixture(); const result = f.run(); f.response.resolve(Response.json(f.restored)); await tick();
  useEditor.getState().updatePage("p", { name: "Edited while reviewing" });
  f.confirm.resolve(true); assert.equal(await result, true);
  assert.equal(useEditor.getState().doc.siteName, "Backup");
  useEditor.getState().undo(); assert.equal(useEditor.getState().doc.pages.p.name, "Edited while reviewing");
});
test("cancelled requests suppress stale server errors", async () => {
  const f = fixture(); const result = f.run(); f.cancel();
  f.response.resolve(Response.json({ error: "obsolete failure" }, { status: 500 }));
  assert.equal(await result, false); assert.equal(f.confirmations, 0);
});

test("obsolete restore completions cannot clear the newer request's busy state, including the same revision", async () => {
  for (const kind of ["publish", "backup"] as const) {
    const start = source.indexOf(kind === "publish" ? "  const restore = async (c: PublishCommit)" : "  const restore = async (b: Backup)");
    const callback = transformSync(source.slice(start, source.indexOf("\n  return (", start)), { loader: "tsx" }).code;
    const first = deferred<boolean>(), second = deferred<boolean>();
    let count = 0, busy: unknown, generation = 0;
    const busyRequest = { current: 0 };
    const injected = {
      pendingRestore: { begin() { const own = ++generation; return { current: () => generation === own, finish() {} }; } },
      busyRequest, setBusy: (value: unknown) => { busy = value; },
      restoreFrom: () => ++count === 1 ? first.promise : second.promise,
      historyUrl: () => "history", siteApi: () => "backup", formatDate: () => "date",
      conf: {}, target: "production", onDone() {}, showAlert() {}, userMessage: String, tr: String,
    };
    const restore = new Function(...Object.keys(injected), `${callback}; return restore;`)(...Object.values(injected));
    const item = { sha: "same-revision", date: "date", day: 2, savedAt: 123 };
    const older = restore(item), newer = restore(item);
    const active = busy;
    first.resolve(false); await older;
    assert.equal(busy, active, `${kind}: an older completion must not unlock newer work`);
    // Restoring the document changes historyRevision before finally runs.
    generation++;
    second.resolve(true); await newer;
    assert.equal(busy, null, `${kind}: successful restore still clears its own busy state`);
  }
});

test("untrusted GitHub history inline SVG is sanitized before it enters the editor", async () => {
  const doc = createInitialDoc();
  const icon = makeIcon();
  const page = doc.pages[doc.pageOrder[0]];
  doc.nodes[icon.id] = icon;
  page.children.push(icon.id);
  icon.icon!.svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
    '<script>alert(2)</script><circle cx="3" cy="3" r="2"/></svg>';
  // The browser import validator permits structurally valid SVG for DOM-based
  // sanitization, whereas its Node variant rejects unsafe bytes immediately.
  const browserValidator = ((input: unknown): SiteDoc => {
    const valid = structuredClone(input as SiteDoc);
    valid.nodes[icon.id].icon!.svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="3" cy="3" r="2"/></svg>';
    validateImportedDoc(valid);
    return input as SiteDoc;
  }) as typeof validateImportedDoc;
  const f = fixture(browserValidator);
  const task = f.run();
  f.response.resolve(Response.json(doc));
  await tick();
  assert.equal(f.confirmations, 1);
  f.confirm.resolve(true);
  assert.equal(await task, true);
  const savedSvg = useEditor.getState().doc.nodes[icon.id].icon!.svg;
  assert.match(savedSvg, /<svg/);
  assert.match(savedSvg, /<circle/);
  assert.doesNotMatch(savedSvg, /onload|<script|alert/i);
});
