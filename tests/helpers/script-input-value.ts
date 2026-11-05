import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import type { FieldContent, ScriptStep, SiteDoc } from "../../lib/types";
export { publishedSelectDefault as publishedScriptInputValue } from "./select-default";

/** 有効な初期値から始め、ブラウザが書き換える値を実スクリプトで代入する。 */
export function scriptInputValueDoc(field: FieldContent, requested: string, restored: string): SiteDoc {
  const actions: [string, string[]][] = [
    ["assign-input", [requested]], ["repeat-input", [requested, requested]],
    ["restore-input", [restored]], ["restore-then-assign", [restored, requested]],
  ];
  const nodes = [
    { ...makeBox(), id: "entry", attrId: "entry", type: "field" as const, field, scripts: [{
      id: "changed", trigger: "change" as const, pos: { x: 32, y: 200 }, steps: [
        { id: "count", kind: "calc" as const, expr: "{changes}+1", into: "changes" },
      ],
    }] },
    ...actions.map(([id, values]) => ({ ...makeText(id), id, attrId: id, semantic: "button" as const, scripts: [{
      id: `${id}-script`, trigger: "click" as const, pos: { x: 32, y: 32 },
      steps: values.map((value, i): ScriptStep => ({ id: `${id}-set-${i}`, kind: "set-value", target: "entry", value })),
    }] })),
    { ...makeText("value=[{entry}]; changes={changes}"), id: "result", attrId: "result" },
  ];
  return {
    siteName: "Script input values", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: nodes.map((n) => n.id), pageScripts: [{
      id: "init", trigger: "load", pos: { x: 400, y: 32 }, steps: [
        { id: "init-count", kind: "set-var", into: "changes", value: "0" },
      ],
    }] } },
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

/** 本物のScriptEditorで動作を編集し、Canvasの入力値と参照表示を確認する。 */
export async function scriptInputValueBundle(doc: SiteDoc) {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
window.inputScriptEditor = useEditor;
function Example() {
  const [editing, setEditing] = useState(false);
  const mode = useEditor(s => s.mode);
  return <>
    <button onClick={() => setEditing(true)}>Edit assignment</button>
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <Canvas />
    {editing && <ScriptEditor focusNodeId="assign-input" focusScriptId="assign-input-script" onClose={() => setEditing(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "script-input-value-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
