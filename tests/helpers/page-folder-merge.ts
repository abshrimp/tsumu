import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function pageFolderFixture(): SiteDoc {
  return {
    siteName: "Page folders", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", folderId: "first", children: ["a"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", folderId: "second", children: ["b"] },
    },
    nodes: { a: { ...makeBox(), id: "a" }, b: { ...makeBox(), id: "b" } },
    pageFolders: [{ id: "first", name: "First" }, { id: "second", name: "Second" }, { id: "third", name: "Third" }],
  };
}

/** 実際のページ一覧を操作し、同時編集の受信と履歴を検証する。 */
export async function pageFolderBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { PagesTab } from "./components/left-panel/PagesTab";
import { useEditor } from "./lib/store";
import { mergeDocs } from "./lib/merge";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
const base = ${JSON.stringify(pageFolderFixture())};
useEditor.getState().replaceDoc(structuredClone(base));
useEditor.getState().setActivePage("p");
window.folderEditor = useEditor;
window.folderBase = base;
window.receiveFolderDoc = (remote) => {
  const state = useEditor.getState();
  state.applyRemoteDoc(mergeDocs(base, state.doc, remote));
};
const root = createRoot(document.getElementById("app"));
root.render(<React.StrictMode><div style={{ width: 300, height: 600 }}><PagesTab /></div></React.StrictMode>);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "page-folder-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
