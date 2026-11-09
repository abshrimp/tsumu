import { readEditorCss } from "./editor-css";
import { build } from "./bundle";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import type { DocNode, FieldContent, ScriptStep, SiteDoc } from "../../lib/types";
export { publishedSelectDefault as publishedScriptInputValue } from "./select-default";

/** 有効な初期値から始め、ブラウザが書き換える値を、実際のスクリプトで代入する。 */
export function scriptInputValueDoc(field: FieldContent, requested: string, restored: string): SiteDoc {
  const actions: [string, string[]][] = [
    ["assign-input", [requested]], ["repeat-input", [requested, requested]],
    ["restore-input", [restored]], ["restore-then-assign", [restored, requested]],
  ];
  const nodes: DocNode[] = [
    { ...makeBox(), id: "entry", attrId: "entry", type: "field" as const, field, scripts: [{
      id: "changed", trigger: "change" as const, steps: [
        { id: "parse-changes", kind: "transform", source: "changes", into: "changes", transform: { kind: "parse" } }, { id: "count", kind: "transform", source: "changes", into: "changes", transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
      ],
    }] },
    ...actions.map(([id, values]) => ({ ...makeText(id), id, attrId: id, semantic: "button" as const, scripts: [{
      id: `${id}-script`, trigger: "click" as const,      steps: values.map((value, i): ScriptStep => ({ id: `${id}-set-${i}`, kind: "set-value", target: "entry", value })),
    }] })),
    { ...makeText("value=[{entry}]; changes={changes}"), id: "result", attrId: "result" },
  ];
  return {
    schemaVersion: 1, siteName: "Script input values", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "", children: nodes.map((n) => n.id), pageScripts: [{
      id: "init", trigger: "load", steps: [
        { id: "init-count", kind: "set-var", into: "changes", value: "0" },
      ],
    }] } },
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

/** 実際の ScriptEditor で動作を編集し、Canvas の入力値と参照の表示を確かめる。 */
export async function scriptInputValueBundle() {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";


import { useEditor } from "./lib/store";
const css = ${JSON.stringify(readEditorCss())};
import { loadLocale } from "./lib/i18n";
let root = null;
let initialized = false;
export async function mount(doc) {
  if (!initialized) {
    await loadLocale();
    const style = document.createElement("style"); style.textContent = css; document.head.append(style);
    initialized = true;
  }
  const { default: ScriptEditor } = await import("./components/ScriptEditor");
  const { default: Canvas } = await import("./components/Canvas");
  root?.unmount();
  useEditor.getState().setMode("design");
  useEditor.getState().select(null);
  useEditor.getState().replaceDoc(doc);
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
  root = createRoot(document.getElementById("app"));
  root.render(<Example />);
}
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "script-input-value-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", globalName: "fieldFixture", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
