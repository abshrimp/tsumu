import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function varExplorerDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Variable picker", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "P", description: "", children: ["search", "target"], pageScripts: [{
        id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [{
          id: "fetch", kind: "fetch", url: "https://example.test/data", as: "product", preview: {
            fetchedAt: 1, sample: { name: "First", details: { label: "Nested" } },
          },
        }],
      }] },
      q: { id: "q", name: "Q", slug: "other", title: "Q", description: "", children: ["other"] },
    },
    nodes: Object.fromEntries(["search", "target", "other"].map(id => [id, {
      ...makeBox(), id, type: "field", attrId: id, field: { kind: "input" },
    }])),
  };
}

/** 実際の設定のパネルから変数を挿入し、保存と履歴も確かめる。取得には見本だけを使う。 */
export async function varExplorerBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
let SettingsPanel;
import { useEditor } from "./lib/store";
useEditor.getState().replaceDoc(${JSON.stringify(varExplorerDoc())});
useEditor.getState().setActivePage("p");
useEditor.getState().select("target");
window.pickerStore = useEditor;
function Example() {
  const nodeId = useEditor(s => s.selection);
  return <>
    {nodeId && <SettingsPanel nodeId={nodeId} />}
    <button id="outside">Outside</button>
  </>;
}
void loadLocale().then(async () => {
  ({ default: SettingsPanel } = await import("./components/SettingsPanel"));
  window.pickerRoot = createRoot(document.getElementById("app"));
  window.pickerRoot.render(<Example />);
});
`,
      loader: "tsx", sourcefile: "var-explorer-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
