import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import { emptyListDoc, publishedEmptyList } from "./empty-list-preview";
import type { SiteDoc } from "../../lib/types";
export const nestedScopeItems = [
  { name: "First", tags: [{ label: "red" }, { label: "blue" }] },
  { name: "Second", tags: [{ label: "green" }, { label: "yellow" }] },
];
export function nestedScopeDoc(): SiteDoc {
  const doc = emptyListDoc(nestedScopeItems);
  doc.nodes.card.children = ["name", "tags"];
  delete doc.nodes.tag;
  doc.nodes.tags = { ...makeBox(), id: "tags", type: "list", list: { from: "tags" }, children: ["row"] };
  doc.nodes.row = { ...makeBox(), id: "row", children: ["hide", "show", "detail"] };
  doc.nodes.detail = { ...makeText("Detail {name}:{label}"), id: "detail", attrId: "detail" };
  for (const kind of ["hide", "show"] as const) doc.nodes[kind] = {
    ...makeText(`${kind} {label}`), id: kind, attrId: kind, semantic: "button", scripts: [{
      id: `${kind}-script`, trigger: "click", pos: { x: 20, y: 20 }, steps: [{ id: `${kind}-detail`, kind, target: "detail" }],
    }],
  };
  return doc;
}
export async function nestedScopeBundle(doc = nestedScopeDoc()) {
  return (await build({ stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
window.nestedScopeStore = useEditor;
function Example() {
  const mode = useEditor(s => s.mode);
  return <><button onClick={() => useEditor.getState().setMode(mode === "preview" ? "design" : "preview")}>Toggle preview</button><Canvas /></>;
}
createRoot(document.getElementById("app")).render(<Example />);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "nested-script-scope-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
export const publishedNestedScope = (doc = nestedScopeDoc()) => publishedEmptyList(doc, nestedScopeItems);
