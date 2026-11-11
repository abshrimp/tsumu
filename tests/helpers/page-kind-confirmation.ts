import { build } from "esbuild";
import { resolve } from "node:path";
import { makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function pageKindFixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Page kinds", assets: {}, pageOrder: ["p", "q"],
    pages: {
      p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a"] },
      q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
    },
    nodes: { a: { ...makeText("Original"), id: "a" } },
  };
}

/** 実際の右パネル・確認ダイアログ・ストアで共同編集との競合を確認する。 */
export async function pageKindBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
import { useEditor } from "./lib/store";
void loadLocale().then(async () => {
const { default: RightPanel } = await import("./components/RightPanel");
const { default: DialogHost } = await import("./components/DialogHost");
useEditor.getState().replaceDoc(${JSON.stringify(pageKindFixture())});
useEditor.getState().select(null);
window.pageKindEditor = useEditor;
const root = createRoot(document.getElementById("app"));
window.hidePagePanel = () => root.render(<React.StrictMode><DialogHost /></React.StrictMode>);
root.render(<React.StrictMode><RightPanel /><DialogHost /></React.StrictMode>);
});
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "page-kind-browser.tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
