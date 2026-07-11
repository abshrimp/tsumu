import { build } from "esbuild";
import { resolve } from "node:path";
import type { FieldContent, SiteDoc } from "../../lib/types";
import { scriptInputValueDoc } from "./script-input-value";
export { publishedSelectDefault as publishedInputDefault } from "./select-default";

export function inputDefaultDoc(field: FieldContent, query = ""): SiteDoc {
  const doc = scriptInputValueDoc(field, "8", "12");
  doc.pages.home.query = query;
  return doc;
}

/** 本物の設定欄で初期値を編集し、Canvasと公開用React出力を比較する。 */
export async function inputDefaultBundle(doc: SiteDoc) {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import SettingsPanel from "./components/SettingsPanel";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
window.initialEditor = useEditor;
function Example() {
  const mode = useEditor(s => s.mode);
  return <>
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <div style={{ display: "flex", height: 750 }}>
      <aside style={{ width: 300, flexShrink: 0, overflow: "auto" }}><SettingsPanel nodeId="entry" /></aside>
      <Canvas />
    </div>
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "input-default-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
