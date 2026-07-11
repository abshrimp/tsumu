import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export const nestedListProducts = [
  { name: "First product", tags: ["red", "blue"], scores: [0, 3], flags: [false, true], empty: [], info: { tags: ["deep"] }, details: [{ title: "record" }] },
  { name: "Second product", tags: ["green"], scores: [2], flags: [true], empty: [], info: { tags: ["other"] }, details: [{ title: "second record" }] },
];
export function nestedListSourcesDoc(): SiteDoc {
  return {
    siteName: "Nested lists", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "P", slug: "", title: "P", description: "", children: ["products", "other"], pageScripts: [{
      id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: "fetch", kind: "fetch", url: "https://example.test/products", as: "response", sample: nestedListProducts, fetchedAt: 1 },
        { id: "alias", kind: "set-var", value: "{response}", into: "items" },
      ],
    }] } },
    nodes: {
      products: { ...makeBox(), id: "products", type: "list", list: { from: "items" }, children: ["card"] },
      card: { ...makeBox(), id: "card", children: ["name", "tag"] },
      name: { ...makeText("{name}"), id: "name" },
      tag: { ...makeText("{値}"), id: "tag" },
      other: { ...makeText("Unchanged"), id: "other" },
    },
  };
}

/** 実際のリスト化・配列選択・キャンバス描画を、保存済みの見本で確かめる。 */
export async function nestedListSourcesBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import SettingsPanel from "./components/SettingsPanel";
import { NodeView } from "./components/canvas/NodeView";
import { VarsCtx } from "./components/canvas/render";
import { previewDataVars, pagePlan } from "./lib/data";
import { useEditor } from "./lib/store";
useEditor.getState().replaceDoc(${JSON.stringify(nestedListSourcesDoc())});
useEditor.getState().setActivePage("p"); useEditor.getState().select("tag");
window.nestedListStore = useEditor;
function Example() {
  const doc = useEditor(s => s.doc), selected = useEditor(s => s.selection);
  const plan = pagePlan(doc, "p");
  return <><aside>{selected && <SettingsPanel nodeId={selected} />}</aside>
    <div id="preview"><VarsCtx.Provider value={{
      pageVars: previewDataVars(doc, "p"), preview: true, fieldValues: {},
      clientVars: plan.clientVars, listOps: plan.listOps, setFieldValue() {}, refresh() {}, navigate() {},
    }}><NodeView id="products" isTop /></VarsCtx.Provider></div>
  </>;
}
window.nestedListRoot = createRoot(document.getElementById("app"));
window.nestedListRoot.render(<Example />);
`,
      loader: "tsx", sourcefile: "nested-list-sources-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
