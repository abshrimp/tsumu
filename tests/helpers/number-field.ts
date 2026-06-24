import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際の数値欄を、保存値と外部更新を確かめられる小さな画面で使う。 */
export async function numberFieldBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { NumField } from "./components/controls";
window.numberFieldWrites = [];
function Example() {
  const [value, setValue] = useState("100px");
  window.setNumberFieldValue = setValue;
  return <>
    <NumField value={value} min={0} max={3000} units={["px", "rem"]} pre="W"
      convert={(n, from, to) => from === to ? n : to === "rem" ? n / 16 : n * 16}
      onChange={(next) => {
        window.numberFieldWrites.push(next);
        setValue(next ?? "100px");
      }} />
    <output id="stored">{value}</output>
    <button id="outside">Outside</button>
  </>;
}
createRoot(document.getElementById("app")).render(<Example />);
`,
      loader: "tsx", sourcefile: "number-field-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** 書き込み先の切り替えを、実際のインスペクタとストアで確かめる。 */
export async function inspectorNumberBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import RightPanel from "./components/RightPanel";
import { useEditor } from "./lib/store";
import { makeText } from "./lib/presets";
const doc = structuredClone(useEditor.getState().doc);
const pageId = doc.pageOrder[0];
doc.pageOrder = [pageId];
doc.pages = { [pageId]: { ...doc.pages[pageId], children: ["a", "b"] } };
doc.nodes = {
  a: { ...makeText("A"), id: "a", styles: {
    base: { default: { fontSize: "40px" }, hover: { fontSize: "30px" } },
    sm: { default: { fontSize: "20px" } },
  } },
  b: { ...makeText("B", { fontSize: "20px" }), id: "b" },
};
useEditor.getState().replaceDoc(doc);
useEditor.getState().select("a");
useEditor.getState().setRightTab("style");
window.numericInspector = useEditor;
createRoot(document.getElementById("app")).render(<RightPanel />);
`,
      loader: "tsx", sourcefile: "number-inspector-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
