import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function canvasMoveDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Canvas movement", assets: {}, pageOrder: ["p", "q"],
    nodes: Object.fromEntries(["a", "b", "c"].map((id) => [id, {
      ...makeBox(id.toUpperCase(), { height: "100px", backgroundColor: "#ddeeff", marginBottom: "12px" }), id,
    }])),
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b", "c"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
    },
  };
}

/** 実際の Canvas・ストア・CSS を使い、ドラッグの中断と履歴を確かめる。 */
export async function canvasMoveBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import { useEditor } from "./lib/store";
import css from "./app/globals.css";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: Canvas } = await import("./components/Canvas");
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(canvasMoveDoc())});
useEditor.getState().setActivePage("p");
useEditor.getState().setCustomWidth(600);
useEditor.getState().setZoom(1);
window.canvasMoveEditor = useEditor;
function Fixture() {
  const [open, setOpen] = useState(true);
  window.showCanvas = setOpen;
  return <div style={{ display: "flex", height: "100vh" }}>{open && <Canvas />}</div>;
}
createRoot(document.getElementById("app")).render(<React.StrictMode><Fixture /></React.StrictMode>);

});
`, loader: "tsx", sourcefile: "canvas-move-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
