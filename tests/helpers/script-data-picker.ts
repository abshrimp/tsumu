import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function scriptDataPickerDoc(): SiteDoc {
  return { schemaVersion: 1, siteName: "Data choices", assets: {}, nodes: {}, pageOrder: ["p"], pages: {
    p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: [], pageScripts: [{
      id: "s", trigger: "load", pos: { x: 32, y: 32 }, steps: [
        { id: "fetch", kind: "fetch", as: "data", url: "https://example.test/data", preview: { sample: {
          name: "Product", price: 12, code: "001", available: false, empty: null,
          detail: { title: "Nested" }, tags: ["red", "blue"], rows: [
            { title: "First", categories: {
              "出展カテゴリ": ["物販"], "投票カテゴリ": ["物販"], "大分類": ["かう"],
            } },
          ],
        } } },
        { id: "value", kind: "set-var", value: "Value {data.name}", into: "chosen" },
        { id: "copy", kind: "copy", value: "" },
        { id: "numeric", kind: "transform", source: "data.price", into: "total", transform: { kind: "math", operation: "add", operandType: "number", operand: 0 } },
        { id: "dynamic", kind: "store-load", key: "dynamic", into: "later" },
        { id: "category-filter", kind: "list-display", mode: "filter",
          array: "data.rows", field: "", op: "eq", value: "物販", dir: "asc" },
      ],
    }] },
  } };
}
export async function scriptDataPickerBundle() {
  return (await build({ stdin: { contents: `
import React from "react";
import {createRoot} from "react-dom/client";
import { loadLocale } from "./lib/i18n";
import {useEditor} from "./lib/store";
import {generateProject} from "./lib/generator";
useEditor.getState().replaceDoc(${JSON.stringify(scriptDataPickerDoc())});
window.dataPickerStore=useEditor;
window.dataPickerProject=()=>generateProject(useEditor.getState().doc);
window.fetch=()=>{throw new Error("No network expected in data picker fixture");};
// 実際のアプリに合わせる。最初に評価されるときに翻訳した表示名を計算する UI のモジュールを
// import する前に、言語を読み込む。
void loadLocale().then(async () => {
  const { default: ScriptEditor } = await import("./components/ScriptEditor");
  createRoot(document.getElementById("app")).render(<ScriptEditor onClose={()=>{}}/>);
});
`, loader: "tsx", sourcefile: "script-data-picker-browser.tsx", resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
