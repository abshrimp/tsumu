import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際の Canvas・FrameStage・ストアを使い、外部データなしで幅変更を確かめる。 */
export async function frameResizeBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import { useEditor } from "./lib/store";
const doc = {
  siteName: "Frame resize", assets: {}, nodes: {}, components: {}, pageOrder: ["p", "q"],
  pages: {
    p: { id: "p", name: "Page", slug: "", title: "", description: "", children: [] },
    q: { id: "q", name: "Redirect", slug: "redirect", title: "", description: "", children: [], redirectTo: "/" },
  },
};
useEditor.getState().replaceDoc(doc);
useEditor.getState().setCustomWidth(600);
useEditor.getState().setZoom(1);
const initialDoc = useEditor.getState().doc;
const root = createRoot(document.getElementById("app"));
window.frameResize = {
  state: () => {
    const s = useEditor.getState();
    return { width: s.customWidth, breakpoint: s.breakpoint, past: s.past.length, future: s.future.length,
      sameDocument: s.doc === initialDoc };
  },
  width: (value) => useEditor.getState().setCustomWidth(value),
  zoom: (value) => useEditor.getState().setZoom(value),
  page: (value) => useEditor.getState().setActivePage(value),
  unmount: () => root.unmount(),
};
root.render(<React.StrictMode><Canvas /></React.StrictMode>);
`,
      resolveDir: resolve("."), loader: "tsx", sourcefile: "frame-resize-fixture.tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
