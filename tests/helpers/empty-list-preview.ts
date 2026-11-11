import { build, transformSync } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import type { SiteDoc } from "../../lib/types";
import { nestedListSourcesDoc } from "./nested-list-sources";

export function emptyListDoc(items: readonly unknown[]) {
  const doc = nestedListSourcesDoc();
  doc.nodes.tag.text!.content = "Tag: {値}";
  (doc.pages.p.pageScripts![0].steps[0] as { preview?: { sample?: unknown } }).preview = { sample: items };
  return doc;
}

/** 本物の設定画面でリスト化・配列選択を行い、同じNodeViewのデザインとプレビューを切り替える。 */
export async function emptyListBundle(items: readonly unknown[]) {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
import { previewDataVars, pagePlan } from "./lib/data";
import { useEditor } from "./lib/store";
void loadLocale().then(async () => {
const { default: SettingsPanel } = await import("./components/SettingsPanel");
const { NodeView } = await import("./components/canvas/NodeView");
const { VarsCtx } = await import("./components/canvas/render");
useEditor.getState().replaceDoc(${JSON.stringify(emptyListDoc(items))});
useEditor.getState().setActivePage("p"); useEditor.getState().select("tag");
window.emptyListStore = useEditor;
function Example() {
  const doc = useEditor(s => s.doc), selected = useEditor(s => s.selection), mode = useEditor(s => s.mode);
  const plan = pagePlan(doc, "p");
  return <><button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <aside>{selected && <SettingsPanel nodeId={selected} />}</aside>
    <div id="preview"><VarsCtx.Provider value={{
      pageVars: previewDataVars(doc, "p"), preview: mode === "preview", fieldValues: {},
      clientVars: plan.clientVars, listOps: plan.listOps, setFieldValue() {}, refresh() {}, navigate() {},
    }}><NodeView id="products" isTop /></VarsCtx.Provider></div>
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
});
`, loader: "tsx", sourcefile: "empty-list-preview-browser.tsx", resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** 保存した同じ文書から実際のNext.jsページを生成し、取得データだけを固定する。 */
export async function publishedEmptyList(doc: SiteDoc, items: readonly unknown[]) {
  const { files } = generateProject(doc), require = createRequire(resolve("package.json")), cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id === "@/lib/safe-fetch") return { fetchPublic: async () => Response.json(items), readTextLimited: (res: Response) => res.text() };
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  };
  return renderToStaticMarkup(await load("app/page.tsx").default({ searchParams: Promise.resolve({}) }));
}
