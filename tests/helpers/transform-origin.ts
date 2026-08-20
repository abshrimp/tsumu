import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function transformOriginDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Transform origins", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: ["c"] },
    },
    nodes: Object.fromEntries(["a", "b", "c"].map((id) => [id, {
      ...makeBox(id), id,
      styles: {
        base: {
          default: {
            width: "200px", height: "100px", transform: "rotate(10deg)",
            transformOrigin: id === "a" ? "top left" : "bottom right",
          },
          hover: { transformOrigin: "bottom left" },
        },
      },
    }])),
  };
}

/** 実際の書式パネル・Canvas・ストアを通して、基準点の選択と履歴を確認する。 */
export async function transformOriginBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import RightPanel from "./components/RightPanel";
import { useEditor } from "./lib/store";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(transformOriginDoc())});
useEditor.getState().setActivePage("p");
useEditor.getState().select("a");
useEditor.getState().setRightTab("style");
useEditor.getState().setZoom(1);
window.originEditor = useEditor;
createRoot(document.getElementById("app")).render(<React.StrictMode>
  <div style={{display: "flex", height: "100vh"}}><Canvas /><RightPanel /></div>
</React.StrictMode>);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "transform-origin-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
