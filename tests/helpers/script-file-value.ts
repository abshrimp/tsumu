import { build, transformSync } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import { makeBox, makeText } from "../../lib/presets";
import type { DocNode, ScriptStep, SiteDoc } from "../../lib/types";

/** 空のファイル欄への代入、選択済みファイルの解除、通常の入力欄を同じランタイムで確かめる。 */
export function scriptFileValueDoc(): SiteDoc {
  let sequence = 0;
  const set = (target: string, value: string): ScriptStep => ({ id: `set-${++sequence}`, kind: "set-value", target, value });
  const button = (id: string, steps: ScriptStep[]): DocNode => ({
    ...makeText(id), id, semantic: "button",
    scripts: [{ id: `${id}-script`, trigger: "click", pos: { x: 0, y: 0 }, steps }],
  });
  const nodes: DocNode[] = [
    {
      ...makeBox(), id: "upload", attrId: "upload", type: "field", field: { kind: "file", multiple: true },
      scripts: [{ id: "count-change", trigger: "change", pos: { x: 0, y: 0 }, steps: [
        { id: "parse-changes", kind: "transform", source: "changes", into: "changes", transform: { kind: "parse" } }, { id: "increment", kind: "transform", source: "changes", into: "changes", transform: { kind: "math", operation: "add", operand: 1 } },
      ] }],
    },
    { ...makeBox(), id: "name", attrId: "name", type: "field", field: { kind: "input" } },
    { ...makeBox(), id: "agree", attrId: "agree", type: "field", field: { kind: "checkbox", label: "Agree" } },
    button("assign-file", [set("upload", "photo.png")]),
    button("assign-variable", [set("upload", "{filename}")]),
    button("clear-file", [set("upload", "")]),
    button("assign-clear-file", [set("upload", "photo.png"), set("upload", "")]),
    button("fill-controls", [set("name", "Ada"), set("agree", "yes")]),
    button("clear-controls", [set("name", ""), set("agree", "off")]),
    { ...makeText("file={upload}; changes={changes}; name={name}; agree={agree}"), id: "result", attrId: "result" },
  ];
  return {
    schemaVersion: 1, siteName: "Script file value", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: nodes.map((n) => n.id), pageScripts: [{
      id: "init", trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: "init-changes", kind: "set-var", into: "changes", value: "0" },
        { id: "init-filename", kind: "set-var", into: "filename", value: "report.pdf" },
      ],
    }] } },
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

export async function scriptFileValueBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
useEditor.getState().replaceDoc(${JSON.stringify(scriptFileValueDoc())});
useEditor.getState().setMode("preview");
window.fileEditor = useEditor;
createRoot(document.getElementById("app")).render(<Canvas />);
`, loader: "tsx", sourcefile: "script-file-value-browser.tsx", resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** 手書きのHTMLではなく、実際に書き出すReactページを描画する。 */
export async function publishedScriptFileValue() {
  const doc = scriptFileValueDoc();
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
  const tree = await load("app/page.tsx").default({ searchParams: Promise.resolve({}) });
  return { doc, html: renderToStaticMarkup(tree) };
}
