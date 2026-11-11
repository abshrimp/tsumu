import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function aiCloneDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "AI clone isolation", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["group", "outside"] } },
    nodes: {
      group: { ...makeBox(), id: "group", children: ["button", "menu", "entry", "readout", "jump"] },
      button: { ...makeText("Toggle menu"), id: "button", attrId: "button", semantic: "button", scripts: [{
        id: "original-script", trigger: "click", pos: { x: 32, y: 32 }, steps: [
          { id: "original-toggle", kind: "toggle", target: "menu" },
          { id: "original-value", kind: "set-value", target: "entry", value: "Changed" },
        ],
      }] },
      menu: { ...makeText("Menu"), id: "menu", attrId: "menu", styles: { base: { default: { display: "none" } } } },
      entry: { ...makeBox(), id: "entry", attrId: "entry", type: "field", field: { kind: "input", defaultValue: "Initial" } },
      readout: { ...makeText("{entry}"), id: "readout", attrId: "readout" },
      jump: { ...makeText("Jump"), id: "jump", link: { kind: "url", url: "#menu" } },
      outside: { ...makeText("External"), id: "outside", attrId: "outside" },
    },
  };
}

/** 通信だけを置き換え、実際のAI操作・チャット・スクリプト画面・プレビューを使う。 */
export async function aiCloneBundle() {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";



import { useEditor } from "./lib/store";
import { applyAiOps } from "./lib/aiOps";
import { parseAiRequest } from "./lib/ai/request";
import css from "./app/globals.css";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: AiChat, useAi } = await import("./components/AiChat");
  const { default: ScriptEditor } = await import("./components/ScriptEditor");
  const { default: Canvas } = await import("./components/Canvas");
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(aiCloneDoc())});
useEditor.getState().setActivePage("p");
useAi.setState({ open: true });
window.aiCloneEditor = useEditor;
window.fetch = async (_url, init) => {
  const { context } = parseAiRequest(JSON.parse(init.body));
  const result = applyAiOps(context.doc, [{ op: "duplicate", id: "group", newId: "copy" }], context.target);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  window.aiCloneServerDoc = context.doc;
  return new Response(JSON.stringify({ type: "result", result: { reply: "Duplicated", operations: result.applied } }) + "\\n",
    { headers: { "content-type": "application/x-ndjson" } });
};
function Fixture() {
  const [edit, setEdit] = useState(false);
  const doc = useEditor(s => s.doc);
  const mode = useEditor(s => s.mode);
  const copiedButton = doc.nodes[doc.nodes.copy?.children[0]];
  return <>
    <button onClick={() => setEdit(true)} disabled={!copiedButton}>Edit copied script</button>
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <Canvas /><AiChat />
    {edit && <ScriptEditor focusNodeId={copiedButton.id} focusScriptId={copiedButton.scripts[0].id} onClose={() => setEdit(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Fixture />);

});
`, loader: "tsx", sourcefile: "ai-clone-browser.tsx", resolveDir: resolve(".") },
    loader: { ".css": "text" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
