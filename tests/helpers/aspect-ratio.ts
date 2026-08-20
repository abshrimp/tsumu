import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function aspectRatioDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Aspect-ratio editing", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: ["c"] },
    },
    nodes: Object.fromEntries(["a", "b", "c"].map((id) => [id, {
      ...makeBox(id, { width: "240px", aspectRatio: "16 / 9" }), id,
    }])),
  };
}

/** 実際のインスペクタとストアで、共同編集などによる書き込み先の変更を確認する。 */
export async function aspectRatioBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import RightPanel from "./components/RightPanel";
import { useEditor } from "./lib/store";
import { removeBreakpoint } from "./lib/breakpoints";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(aspectRatioDoc())});
useEditor.getState().setActivePage("p");
useEditor.getState().select("a");
useEditor.getState().setRightTab("style");
useEditor.getState().setBreakpoint("sm");
useEditor.getState().setZoom(1);
window.ratioEditor = useEditor;
window.removeRemoteBreakpoint = () => {
  const remote = structuredClone(useEditor.getState().doc);
  removeBreakpoint(remote, "sm");
  useEditor.getState().applyRemoteDoc(remote);
};
createRoot(document.getElementById("app")).render(<React.StrictMode>
  <div style={{display: "flex", height: "100vh"}}><Canvas /><RightPanel /></div>
</React.StrictMode>);
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "aspect-ratio-browser.tsx" },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
