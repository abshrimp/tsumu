import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際のキャンバス・レイヤーとアップロード処理を、通信の完了順だけ制御して確かめる。 */
export async function imageDropBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Canvas from "./components/Canvas";
import StylePanel from "./components/StylePanel";
import { LayersTab } from "./components/left-panel/LayersTab";
import { useEditor } from "./lib/store";
import { useDialogs } from "./lib/dialog";
import { makeBox } from "./lib/presets";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
const doc = { siteName: "Image drops", assets: {}, pageOrder: ["p", "q"], pages: {
  p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
  q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: ["c"] },
}, nodes: Object.fromEntries(["a", "b", "c", "root"].map((id) => [id, { ...makeBox(), id, name: id, styles: { base: { default: { minHeight: "40px", backgroundColor: "#ff0000" } } } }])),
components: { comp: { id: "comp", name: "Component", rootId: "root" } } };
useEditor.getState().replaceDoc(doc);
useEditor.getState().setActivePage("p");
useEditor.getState().select("a");
window.dropEditor = useEditor;
window.dropDialogs = useDialogs;
const root = createRoot(document.getElementById("app"));
window.unmountDropEditor = () => root.unmount();
function Fixture() {
  const [inspector, setInspector] = useState(true);
  const [canvas, setCanvas] = useState(true);
  const selection = useEditor((s) => s.selection);
  window.closeDropInspector = () => setInspector(false);
  window.closeDropCanvas = () => setCanvas(false);
  return <div style={{ display: "flex", height: "100vh" }}>
    <div style={{ width: 250, display: "flex", flexDirection: "column" }}><LayersTab /></div>
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>{canvas && <Canvas />}</div>
    {inspector && selection && <div style={{ width: 320, overflow: "auto" }}><StylePanel nodeId={selection} /></div>}
  </div>;
}
root.render(<React.StrictMode><Fixture /></React.StrictMode>);
`, loader: "tsx", sourcefile: "image-drop-browser.tsx", resolveDir: resolve("."),
    },
    loader: { ".css": "text" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
