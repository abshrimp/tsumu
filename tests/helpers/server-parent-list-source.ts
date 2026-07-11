import { build } from "esbuild";
import { resolve } from "node:path";
import { clientNestedDoc } from "./client-nested-lists";

export const serverSourceItems = [
  { name: "First", tags: [{ label: "red", unused: "PRIVATE_SERVER_SENTINEL" }, { label: "blue" }], unused: "PRIVATE_SERVER_SENTINEL" },
  { name: "Second", tags: [{ label: "green" }, { label: "yellow" }], unused: "PRIVATE_SERVER_SENTINEL" },
];
export function serverSourceDoc(component = false) {
  const doc = clientNestedDoc(component);
  (doc.pages.p.pageScripts![0].steps[0] as { sample: unknown }).sample = serverSourceItems;
  doc.pages.p.pageScripts![0].steps = doc.pages.p.pageScripts![0].steps.filter(s => s.id !== 'tags-alias');
  doc.pages.p.pageScripts![0].steps.push({ id: 'items-alias', kind: 'set-var', value: '{response}', into: 'items' });
  doc.nodes.reload.scripts![0].steps = [{ id: 'reload-step', kind: 'split', source: 'global,other', sep: ',', into: 'tags' }];
  return doc;
}

/** 本物の設定・スクリプト入力で、配信前の親とブラウザの配列を同じ名前にする。 */
export async function serverSourceBundle(component = false) {
  const doc = serverSourceDoc(component);
  doc.nodes.tags.list!.from = '';
  (doc.nodes.reload.scripts![0].steps[0] as { source: string }).source = '';
  return (await build({ stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import SettingsPanel from "./components/SettingsPanel";
import ScriptEditor from "./components/ScriptEditor";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
useEditor.getState().setActivePage("p"); useEditor.getState().select("tags");
window.serverSourceStore = useEditor;
function Example() {
 const [edit, setEdit] = useState(false), mode = useEditor(s => s.mode), selected = useEditor(s => s.selection);
 return <><button onClick={() => setEdit(true)}>Edit loading</button>
 <button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button>
 <button onClick={() => useEditor.getState().undo()}>Undo</button><button onClick={() => useEditor.getState().redo()}>Redo</button>
 <button onClick={() => useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)))}>Reload saved</button>
 <aside>{selected && <SettingsPanel nodeId={selected} />}</aside><Canvas />
 {edit && <ScriptEditor focusNodeId="reload" focusScriptId="reload-script" onClose={() => setEdit(false)} />}</>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve('.'), sourcefile: 'server-parent-source-browser.tsx', loader: 'tsx' }, loader: { '.css': 'text' },
 bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
 })).outputFiles[0].text;
}
