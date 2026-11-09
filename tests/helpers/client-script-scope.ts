import { makeText } from '../../lib/presets';
import { clientNestedDoc } from './client-nested-lists';

export function clientScriptFixture(component = false, items: any[] = [
  { name: 'Data {label}', tags: [{ label: 'red' }] },
  { name: 'Second', tags: [{ label: 'green' }] },
]) {
  const doc = clientNestedDoc(component);
  (doc.pages.p.pageScripts![0].steps[0] as any).preview = { sample: items };
  doc.pages.p.pageScripts![0].steps.push(
    { id: 'name', kind: 'set-var', value: '{response.0.name}', into: 'name' },
    { id: 'private', kind: 'set-var', value: 'UNUSED_SERVER_PRIVATE', into: 'private' },
  );
  doc.nodes.act = { ...makeText('Act'), id: 'act', attrId: 'act', semantic: 'button', scripts: [{
    id: 'act-script', trigger: 'click', pos: { x: 0, y: 0 }, steps: [
      { id: 'selected', kind: 'set-var', value: 'Selected {name}', into: 'chosen' },
      { id: 'raw', kind: 'set-var', value: '{tags}', into: 'rawChosen' },
    ],
  }] };
  doc.nodes.row.children.push('act');
  for (const [id, value] of [['result', '{chosen}'], ['raw-result', '{rawChosen.0.label}']]) {
    doc.nodes[id] = { ...makeText(value), id, attrId: id }; doc.pages.p.children.push(id);
  }
  return { doc, items };
}


/** 実際の編集画面で値を変更し、履歴・再読込を通した文書を書き出す。 */
export async function clientScriptBundle(doc: import('../../lib/types').SiteDoc) {
  const { build } = await import('esbuild');
  const { resolve } = await import('node:path');
  return (await build({ stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
useEditor.getState().setActivePage("p");
window.clientScriptStore = useEditor;
function Example() {
  const [edit, setEdit] = useState(false);
  return <><button onClick={() => setEdit(true)}>Edit action</button>
    <button onClick={() => useEditor.getState().undo()}>Undo</button>
    <button onClick={() => useEditor.getState().redo()}>Redo</button>
    <button onClick={() => useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)))}>Reload saved</button>
    <Canvas />
    {edit && <ScriptEditor focusNodeId="act" focusScriptId="act-script" onClose={() => setEdit(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve('.'), sourcefile: 'client-script-scope-browser.tsx', loader: 'tsx' },
    loader: { '.css': 'text' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  })).outputFiles[0].text;
}
