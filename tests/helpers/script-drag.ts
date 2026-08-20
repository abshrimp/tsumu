import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function scriptDragDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Script gestures", assets: {}, nodes: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: [], pageScripts: [
        { id: "script", trigger: "load", pos: { x: 32, y: 32 }, steps: [{ id: "wait", kind: "wait", seconds: 1 }] },
      ] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
    },
  };
}

/** 実際のスクリプト画面・ストア・CSSで、操作の中断と履歴を確かめる。 */
export async function scriptDragBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(scriptDragDoc())});
useEditor.getState().setActivePage("p");
window.scriptDragEditor = useEditor;
function Fixture() {
  const [open, setOpen] = useState(true);
  return <>
    <button id="reopen-script" onClick={() => setOpen(true)}>Reopen scripts</button>
    {open && <ScriptEditor onClose={() => setOpen(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<React.StrictMode><Fixture /></React.StrictMode>);
`, loader: "tsx", sourcefile: "script-drag-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
