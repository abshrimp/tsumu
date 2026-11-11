import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際の Canvas・FrameStage・ストアを使い、外部データなしで幅変更を確かめる。 */
export async function frameResizeBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";

import { useEditor } from "./lib/store";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: Canvas } = await import("./components/Canvas");
const doc = {
  siteName: "Frame resize", assets: {}, nodes: {}, components: {}, pageOrder: ["p", "q", "h"],
  pages: {
    p: { id: "p", name: "Page", slug: "", title: "", description: "", children: [] },
    q: { id: "q", name: "Redirect", slug: "redirect", title: "", description: "", children: [], redirectTo: "/" },
    h: { id: "h", name: "HTML", slug: "html", title: "", description: "", children: [], rawHtml:
      '<!doctype html><html><head><style>body{color:rgb(10,20,30)}</style></head><body><button id="run" onclick="document.getElementById(&quot;execution&quot;).textContent=&quot;clicked&quot;">Click</button><p id="execution">initial</p><script>document.getElementById("execution").textContent="script ran";</script></body></html>' },
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
  mode: (value) => useEditor.getState().setMode(value),
  unmount: () => root.unmount(),
};
root.render(<React.StrictMode><Canvas /></React.StrictMode>);

});
`,
      resolveDir: resolve("."), loader: "tsx", sourcefile: "frame-resize-fixture.tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
