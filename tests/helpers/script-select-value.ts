import { build } from "esbuild";
import { resolve } from "node:path";
import { makeText } from "../../lib/presets";
import type { ScriptStep, SiteDoc } from "../../lib/types";
import { publishedSelectDefault, selectDefaultDoc } from "./select-default";

export function scriptSelectValueDoc(options = ["A", "B"]): SiteDoc {
  const doc = selectDefaultDoc({ options }, "empty=&missing=C");
  const actions: [string, string[]][] = [
    ["assign-choice", ["B"]], ["clear-choice", [""]], ["missing-choice", ["{missing}"]],
    ["valid-choice", ["A"]], ["repeat-missing", ["{missing}", "{missing}"]],
    ["missing-then-empty", ["{missing}", ""]], ["valid-then-missing", ["A", "{missing}"]],
  ];
  for (const [id, values] of actions) {
    doc.nodes[id] = { ...makeText(id), id, attrId: id, semantic: "button", scripts: [{
      id: `${id}-script`, trigger: "click", pos: { x: 32, y: 32 },
      steps: values.map((value, i): ScriptStep => ({ id: `${id}-set-${i}`, kind: "set-value", target: "choice", value })),
    }] };
  }
  doc.nodes.choice.scripts = [{ id: "changed", trigger: "change", pos: { x: 32, y: 220 }, steps: [
    { id: "parse-changes", kind: "transform", source: "changes", into: "changes", transform: { kind: "parse" } }, { id: "count", kind: "transform", source: "changes", into: "changes", transform: { kind: "math", operation: "add", operand: 1 } },
  ] }];
  doc.nodes.result.text!.content = "value={choice}; index={choice.index}; changes={changes}";
  doc.pages.home.children = ["choice", ...actions.map(([id]) => id), "result"];
  doc.pages.home.pageScripts = [{ id: "init", trigger: "load", pos: { x: 400, y: 32 }, steps: [
    { id: "init-count", kind: "set-var", into: "changes", value: "0" },
  ] }];
  return doc;
}

/** 本物のScriptEditorで動作を編集し、その文書をCanvasと書き出しサイトの両方で実行する。 */
export async function scriptSelectValueBundle(doc = scriptSelectValueDoc()) {
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
window.selectScriptEditor = useEditor;
function Example() {
  const [editing, setEditing] = useState(false);
  const mode = useEditor(s => s.mode);
  return <>
    <button onClick={() => setEditing(true)}>Edit assignment</button>
    <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
    <Canvas />
    {editing && <ScriptEditor focusNodeId="assign-choice" focusScriptId="assign-choice-script" onClose={() => setEditing(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "script-select-value-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

export const publishedScriptSelectValue = publishedSelectDefault;
