import { readEditorCss } from "./editor-css";
import { build } from "./bundle";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function scriptDragDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Script gestures", assets: {}, nodes: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: [], pageScripts: [
        { id: "script", trigger: "load", steps: [{ id: "wait", kind: "wait", seconds: 1 }] },
      ] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
    },
  };
}

let compiledScriptDragBundle: Promise<string> | undefined;

/** 実際のスクリプトの画面・ストア・CSS で、操作の中断と履歴を確かめる。 */
export async function scriptDragBundle(doc: SiteDoc = scriptDragDoc()) {
  compiledScriptDragBundle ??= build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
import { useEditor } from "./lib/store";
const css = ${JSON.stringify(readEditorCss())};
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(window.__scriptDragDoc);
useEditor.getState().setActivePage("p");
window.scriptDragEditor = useEditor;
let ScriptEditor;
function Fixture() {
  const [open, setOpen] = useState(true);
  return <>
    <button id="reopen-script" onClick={() => setOpen(true)}>Reopen scripts</button>
    {open && <ScriptEditor onClose={() => setOpen(false)} />}
  </>;
}
void loadLocale().then(async () => {
  ({ default: ScriptEditor } = await import("./components/ScriptEditor"));
  createRoot(document.getElementById("app")).render(<React.StrictMode><Fixture /></React.StrictMode>);
});
`, loader: "tsx", sourcefile: "script-drag-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  }).then(result => result.outputFiles[0].text);
  return `window.__scriptDragDoc = ${JSON.stringify(doc)};\n` + await compiledScriptDragBundle;
}
