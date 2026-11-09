import { build } from "esbuild";
import { resolve } from "node:path";
import { scriptWorkspaceDoc } from "../tests/helpers/script-workspace";

export async function scriptBenchmarkBundle(layout: "single" | "stacks") {
  return (await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import { useEditor } from "./lib/store";
import { writeBrowserDoc, readBrowserDoc } from "./lib/browser-doc-storage";
import { exportProjectZip } from "./lib/exportZip";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
useEditor.getState().replaceDoc(${JSON.stringify(scriptWorkspaceDoc(layout))});
useEditor.getState().setActivePage("p");
window.scriptDragEditor = useEditor;
let previous = null;
let revision = 0;
window.scriptBenchmark = {
  async save() {
    const start = performance.now();
    const raw = JSON.stringify({ ...useEditor.getState().doc, siteName: "Benchmark " + ++revision });
    if (await writeBrowserDoc("script-benchmark", raw, previous) !== "saved") throw Error("Save conflict");
    const ms = performance.now() - start;
    if (await readBrowserDoc("script-benchmark") !== raw) throw Error("Save readback mismatch");
    previous = raw;
    return ms;
  },
  async export() {
    const start = performance.now();
    const missing = await exportProjectZip(useEditor.getState().doc, "nextjs");
    if (missing.length) throw Error("Missing export assets");
    return performance.now() - start;
  }
};
const start = performance.now();
createRoot(document.getElementById("app")).render(<ScriptEditor onClose={() => {}} />);
function ready() {
  if (!document.querySelector('.se-ws [data-sel-key="step:wait-0"]')) return requestAnimationFrame(ready);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.scriptBenchmark.firstRenderMs = performance.now() - start;
  }));
}
requestAnimationFrame(ready);
` },
    loader: { ".css": "text" }, bundle: true, write: false, format: "iife",
    platform: "browser", jsx: "automatic", minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  })).outputFiles[0].text;
}
