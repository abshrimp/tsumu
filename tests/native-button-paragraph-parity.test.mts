import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc, DocNode } from "../lib/types";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
function markup(framework: "vue" | "nuxt" | "sveltekit", nodes: Record<string, DocNode>, children: string[]) {
  const doc: SiteDoc = { siteName: "Controls", assets: {}, pageOrder: ["p"], nodes,
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children } } };
  const files = generateExportProject(doc, framework).files;
  const file = framework === "nuxt" ? "app/generated/pages/Page0.vue" : framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
  return parse(files[file]);
}
for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(`${framework}: scripted buttons do not submit their enclosing form`, () => {
    const button = (id: string): DocNode => ({ ...makeBox(), id, attrId: id, semantic: "button" });
    const tree = markup(framework, {
      form: { ...makeBox(), id: "form", semantic: "form", children: ["scripted", "ordinary", "onload", "explicit"] },
      scripted: { ...button("scripted"), scripts: [{ id: "click", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ id: "set", kind: "set-var", into: "clicked", value: "yes" }] }] },
      ordinary: button("ordinary"),
      onload: { ...button("onload"), scripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [] }] },
      explicit: { ...makeBox(), id: "explicit", attrId: "explicit", type: "field", field: { kind: "submit", label: "Go" } },
      outside: button("outside"),
    }, ["form", "outside"]);
    assert.equal(tree.querySelector("#scripted").getAttribute("type"), "button");
    assert.equal(tree.querySelector("#ordinary").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#onload").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#explicit").getAttribute("type"), "submit");
    assert.equal(tree.querySelector("#outside").getAttribute("type"), "button");
  });
  test(`${framework}: inline paragraph children keep p and block children retain paragraph styling`, () => {
    const paragraph = (id: string, child: string): DocNode => ({ ...makeBox(), id, attrId: id, text: { content: "Line one\nLine two", heading: 0 }, children: [child] });
    const tree = markup(framework, {
      inline: paragraph("inline", "span"),
      span: { ...makeBox(), id: "span", semantic: "custom", customTag: "span", text: { content: "bold", heading: 0 } },
      block: paragraph("block", "box"), box: { ...makeBox(), id: "box" },
    }, ["inline", "block"]);
    assert.equal(tree.querySelector("#inline").tagName.toLowerCase(), "p");
    assert.equal(tree.querySelector("#inline").hasAttribute("data-p"), false);
    assert.equal(tree.querySelector("#block").tagName.toLowerCase(), "div");
    assert.equal(tree.querySelector("#block").hasAttribute("data-p"), true);
  });
}
