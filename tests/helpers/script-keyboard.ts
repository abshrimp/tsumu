import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function scriptKeyboardDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Script keyboard scope", assets: {}, nodes: {}, pageOrder: ["p", "q", "r"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: [], pageScripts: [
        { id: "script", trigger: "load", pos: { x: 32, y: 32 }, steps: [{ id: "open", kind: "open-page", pageId: "q" }] },
        { id: "other", trigger: "load", pos: { x: 32, y: 220 }, steps: [{ id: "wait", kind: "wait", seconds: 1 }] },
      ] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
      r: { id: "r", name: "R", slug: "r", title: "", description: "", children: [] },
    },
  };
}

/** 実際のスクリプト画面・ストア・CSSで、選択欄のキー操作と履歴を確かめる。 */
export async function scriptKeyboardBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(scriptKeyboardDoc())});
useEditor.getState().setActivePage("p");
window.scriptKeyboardEditor = useEditor;
createRoot(document.getElementById("app")).render(<React.StrictMode><ScriptEditor onClose={() => {}} /></React.StrictMode>);
`, loader: "tsx", sourcefile: "script-keyboard-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
