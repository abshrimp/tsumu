import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function scriptDataPickerDoc(): SiteDoc {
  return { siteName: "Data choices", assets: {}, nodes: {}, pageOrder: ["p"], pages: {
    p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: [], pageScripts: [{
      id: "s", trigger: "load", pos: { x: 32, y: 32 }, steps: [
        { id: "fetch", kind: "fetch", as: "data", url: "https://example.test/data", sample: {
          name: "Product", price: 12, code: "001", available: false, empty: null,
          detail: { title: "Nested" }, tags: ["red", "blue"], rows: [{ title: "First" }],
        } },
        { id: "value", kind: "set-var", value: "Legacy {data.name}", into: "chosen" },
        { id: "copy", kind: "copy", value: "" },
        { id: "calc", kind: "calc", expr: "", into: "total" },
        { id: "dynamic", kind: "store-load", key: "dynamic", into: "later" },
      ],
    }] },
  } };
}
export async function scriptDataPickerBundle() {
  return (await build({ stdin: { contents: `
import React from "react";
import {createRoot} from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import {useEditor} from "./lib/store";
import {generateProject} from "./lib/generator";
useEditor.getState().replaceDoc(${JSON.stringify(scriptDataPickerDoc())});
window.dataPickerStore=useEditor;
window.dataPickerProject=()=>generateProject(useEditor.getState().doc);
window.fetch=()=>{throw new Error("No network expected in data picker fixture");};
createRoot(document.getElementById("app")).render(<ScriptEditor onClose={()=>{}}/>);
`, loader: "tsx", sourcefile: "script-data-picker-browser.tsx", resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
