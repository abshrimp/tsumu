import { build, transformSync } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import { makeBox, makeText } from "../../lib/presets";
import type { FieldContent, SiteDoc } from "../../lib/types";

export function selectDefaultDoc(field: Partial<FieldContent> = {}, query = ""): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Select defaults", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", query, children: ["choice", "result"] } },
    nodes: {
      choice: { ...makeBox(), id: "choice", attrId: "choice", type: "field", field: { kind: "select", options: ["A", "B"], defaultValue: "B", ...field } },
      result: { ...makeText("value={choice}; index={choice.index}"), id: "result", attrId: "result" },
    },
  };
}

/** 選択肢の編集は本物の設定欄を使い、保存データ・Undo/Redo・プレビューを一緒に確かめる。 */
export async function selectDefaultBundle(doc = selectDefaultDoc()) {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import SettingsPanel from "./components/SettingsPanel";
import { useEditor } from "./lib/store";
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
window.selectEditor = useEditor;
function Example() {
  const mode = useEditor(s => s.mode);
  return <>
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <aside><SettingsPanel nodeId="choice" /></aside>
    <Canvas />
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "select-default-browser.tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** 書き出したページを実行する。手書きのselectではなく、同じ文書の公開用React要素を使う。 */
export async function publishedSelectDefault(doc: SiteDoc) {
  const { files } = generateProject(doc);
  const require = createRequire(resolve("package.json"));
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  };
  const query = Object.fromEntries(new URLSearchParams(doc.pages.home.query));
  const tree = await load("app/page.tsx").default({ searchParams: Promise.resolve(query) });
  return { tree, html: renderToStaticMarkup(tree) };
}
