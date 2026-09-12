import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCanvasCss } from "../components/canvas/css";
import { generateProject } from "../lib/generator";
import { buildClassNames } from "../lib/generator/names";
import { makeBox } from "../lib/presets";
import { applyBreakpoints, bpRangeQuery } from "../lib/style";
import type { SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
function fixture(): SiteDoc {
  return {
    siteName: "Visibility",
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["hidden", "visible"] } },
    pageOrder: ["p"], assets: {},
    components: {
      card: { id: "card", name: "Card", rootId: "root" },
      inner: { id: "inner", name: "Inner", rootId: "innerRoot" },
    },
    nodes: {
      hidden: { ...makeBox(), id: "hidden", type: "instance", componentId: "card", styles: {}, hiddenOn: ["sm"] },
      visible: { ...makeBox(), id: "visible", type: "instance", componentId: "card", styles: {} },
      root: { ...makeBox(), id: "root", semantic: "div", children: ["nested"], styles: { base: { default: { display: "flex" }, hover: { display: "grid" } } } },
      nested: { ...makeBox(), id: "nested", type: "instance", componentId: "inner", styles: {}, hiddenOn: ["lg"] },
      innerRoot: { ...makeBox(), id: "innerRoot", semantic: "div", text: { content: "Inner content", heading: 0 } },
    },
  };
}

test("canvas visibility targets individual instances in design and preview at the exact breakpoint", () => {
  const doc = fixture();
  applyBreakpoints(doc);
  for (const mode of ["design", "preview"] as const) {
    for (const bp of ["base", "lg", "sm"] as const) {
      const css = buildCanvasCss(doc, doc.pages.p.children, bp, mode, null, "default");
      assert.equal(css.includes('[data-node="hidden"], [data-instance-node~="hidden"]) { display: none !important; }'), bp === "sm");
      assert.equal(css.includes('[data-node="nested"], [data-instance-node~="nested"]) { display: none !important; }'), bp === "lg");
      assert.ok(!css.includes('[data-node="visible"], [data-instance-node~="visible"]) { display: none'));
      assert.match(css, /display: flex/);
    }
  }
});

test("canvas nested ghosts retain instance IDs on the actual root without wrappers", () => {
  const doc = fixture();
  const filename = new URL("../components/canvas/NodeView.tsx", import.meta.url);
  const localRequire = createRequire(filename);
  const code = transformSync(readFileSync(filename, "utf8"), { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  const mod = { exports: {} as { NodeView: any } };
  const state = { doc, mode: "design", selectedIds: [], editingText: null };
  new Function("require", "module", "exports", code)((id: string) =>
    id === "../../lib/store" ? { useEditor: (select: any) => select(state) } : localRequire(id),
    mod, mod.exports);
  const html = renderToStaticMarkup(createElement(mod.exports.NodeView, { id: "visible", isTop: true }));
  assert.match(html, /data-node="visible"/);
  assert.match(html, /data-ghost="innerRoot" data-instance-node="nested"/);
  assert.equal((html.match(/<div/g) ?? []).length, 2);
});

function renderExport(doc: SiteDoc): { html: string; css: string; files: Record<string, string> } {
  const { files } = generateProject(doc);
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as { default: any } };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id.startsWith("@/components/")) return load(id.replace("@/", "") + ".tsx");
      if (id.startsWith("./")) return load("components/" + id.slice(2) + ".tsx");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  };
  return { html: renderToStaticMarkup(createElement(load("app/page.tsx").default)), css: files["styles/site.css"], files };
}

test("published instances forward independent visibility onto the component root", () => {
  const doc = fixture();
  const names = buildClassNames(doc);
  const { html, css } = renderExport(doc);
  assert.ok(html.includes('data-instance-hidden="' + names.get("hidden") + '"'));
  assert.equal((html.match(/data-instance-hidden=/g) ?? []).length, 3); // 非表示の外側のインスタンスと、入れ子の2つのインスタンス。
  assert.equal((html.match(/<div/g) ?? []).length, 4); // 表示を切り替えるための包みは無い。
  assert.ok(css.includes('@media ' + bpRangeQuery("sm") + ' {\n  [data-instance-hidden~="' + names.get("hidden") + '"] {\n    display: none !important;'));
  assert.ok(css.includes('@media ' + bpRangeQuery("lg") + ' {\n  [data-instance-hidden~="' + names.get("nested") + '"] {\n    display: none !important;'));
  assert.ok(!css.includes('[data-instance-hidden~="' + names.get("visible") + '"]'));
});

test("a component whose root is another instance forwards both visibility constraints", () => {
  const doc = fixture();
  doc.components!.card.rootId = "nested";
  const names = buildClassNames(doc);
  const { html } = renderExport(doc);
  assert.ok(html.includes('data-instance-hidden="' + names.get("nested") + " " + names.get("hidden") + '"'));
  assert.equal((html.match(/<div/g) ?? []).length, 2);
});
