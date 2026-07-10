import { build } from "esbuild";
import { resolve } from "node:path";
import { makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function textStyleConfirmationDoc(): SiteDoc {
  return {
    siteName: "Text style confirmation", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
    },
    nodes: {
      a: { ...makeText("echo echo"), id: "a" },
      b: { ...makeText("Other text"), id: "b" },
    },
  };
}

/** 実際の選択範囲・Canvas・書式パネル・確認ダイアログで非同期の編集を確かめる。 */
export async function textStyleConfirmationBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import RightPanel from "./components/RightPanel";
import DialogHost from "./components/DialogHost";
import { useEditor } from "./lib/store";
useEditor.getState().replaceDoc(${JSON.stringify(textStyleConfirmationDoc())});
useEditor.getState().select("a");
useEditor.getState().setRightTab("style");
window.textStyleEditor = useEditor;
const root = createRoot(document.getElementById("app"));
window.hideTextStylePanel = () => root.render(<React.StrictMode><Canvas /><DialogHost /></React.StrictMode>);
root.render(<React.StrictMode><Canvas /><RightPanel /><DialogHost /></React.StrictMode>);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "text-style-confirmation-browser.tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
