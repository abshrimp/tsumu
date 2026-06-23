import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { anchorFixture, renderAnchorExport } from "./helpers/instance-anchor";

const require = createRequire(import.meta.url);
function preview(doc: SiteDoc, id: string) {
  const filename = new URL("../components/canvas/NodeView.tsx", import.meta.url);
  const localRequire = createRequire(filename);
  const { VarsCtx } = localRequire("./render");
  const mod = { exports: {} as { NodeView: any } };
  const state = { doc, mode: "preview", selectedIds: [], editingText: null };
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)((name: string) =>
    name === "../../lib/store" ? { useEditor: (select: any) => select(state) } : localRequire(name), mod, mod.exports);
  return renderToStaticMarkup(createElement(VarsCtx.Provider, {
    value: { preview: true, pageVars: {}, clientVars: new Set(), fieldValues: {}, refresh: () => {} },
  }, createElement(mod.exports.NodeView, { id, isTop: true })));
}

test("page instance anchors match preview, remain independent, and restore the master layout", () => {
  const doc = anchorFixture();
  const before = structuredClone(doc);
  const { html, files } = renderAnchorExport(doc);
  for (const id of ["first-card", "second-card"]) assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
  assert.match(html, /href="#first-card"/);
  assert.match(html, /id="first-card"[^>]*data-toggle-show="flex"/);
  assert.equal((html.match(/<div/g) ?? []).length, 2, "no layout wrappers");
  assert.match(preview(doc, "first"), /id="first-card"/);
  assert.match(preview(doc, "second"), /id="second-card"/);
  assert.deepEqual(generateProject(doc).files, files, "deterministic output");
  assert.deepEqual(doc, before, "source document is unchanged");
});

test("master IDs and authored references take priority over conflicting instance settings", () => {
  const doc = anchorFixture();
  doc.nodes.root.attrId = "master";
  doc.nodes.root.children = ["child", "custom"];
  doc.nodes.root.customCss = "--anchor-note: master; color: red";
  doc.nodes.child = { ...makeBox(), id: "child", link: { kind: "url", url: "#master" }, scripts: [{ id: "hide", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: "hide-step", kind: "hide", target: "master" }] }] };
  doc.nodes.custom = { ...makeBox(), id: "custom", type: "code", code: { html: '<span data-note="master"><style>#master { color: red; }</style></span>' } };
  const before = structuredClone(doc);
  const output = renderAnchorExport(doc);
  const noInstanceIds = structuredClone(doc);
  delete noInstanceIds.nodes.first.attrId;
  delete noInstanceIds.nodes.second.attrId;
  assert.deepEqual(output.files, generateProject(noInstanceIds).files, "ignored conflicts cannot rewrite authored references");
  assert.equal((output.html.match(/id="master"/g) ?? []).length, 2);
  assert.ok(!output.html.includes('id="first-card"'));
  assert.match(output.html, /href="#master"/);
  assert.match(output.html, /&quot;target&quot;:&quot;master&quot;/);
  assert.match(preview(doc, "first"), /id="master"/);
  assert.deepEqual(doc, before);
});

test("nested placements and instance-root aliases do not gain new IDs", () => {
  const doc = anchorFixture();
  doc.components!.inner = { id: "inner", name: "Inner", rootId: "innerRoot" };
  doc.nodes.root.children = ["nested"];
  doc.nodes.nested = { ...makeBox(), id: "nested", type: "instance", componentId: "inner", attrId: "nested-anchor" };
  doc.nodes.innerRoot = { ...makeBox(), id: "innerRoot", semantic: "div" };
  assert.ok(!renderAnchorExport(doc).html.includes('id="nested-anchor"'));
  assert.ok(!preview(doc, "first").includes('id="nested-anchor"'));
  doc.components!.card.rootId = "nested";
  const html = renderAnchorExport(doc).html;
  assert.ok(!html.includes('id="first-card"'));
  assert.ok(!html.includes('id="nested-anchor"'));
});

test("unanchored instances stay unanchored and IDs are escaped as JSX data", () => {
  const doc = anchorFixture();
  delete doc.nodes.second.attrId;
  doc.nodes.first.attrId = 'anchor"<&';
  const { html } = renderAnchorExport(doc);
  assert.match(html, /id="anchor&quot;&lt;&amp;"/);
  assert.equal((html.match(/data-toggle-show=/g) ?? []).length, 1);
});

test("the generated anchored project passes TypeScript checking", () => {
  const { files } = generateProject(anchorFixture());
  const dir = mkdtempSync(join(tmpdir(), "tsumu-instance-anchor-"));
  try {
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    execFileSync(process.execPath, [join(dirname(require.resolve("typescript/package.json")), "bin/tsc"), "--project", join(dir, "tsconfig.json"), "--noEmit", "--incremental", "false"], { cwd: dir, stdio: "pipe" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
