import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際の右パネルとストアを、外部サービスを使わず確認する。 */
export async function htmlImportBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";

import { useEditor } from "./lib/store";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: RightPanel } = await import("./components/RightPanel");
useEditor.getState().replaceDoc({ siteName: "HTML import", assets: {}, nodes: {}, pageOrder: ["p", "q"], pages: Object.fromEntries(["p", "q"].map(id => [id, { id, name: id, slug: id, title: "", description: "", children: [], rawHtml: "<p>Original</p>" }])) });
useEditor.getState().select(null);
useEditor.getState().setRightTab("style");
window.htmlEditor = useEditor;
const root = createRoot(document.getElementById("app"));
window.unmountHtmlEditor = () => root.unmount();
root.render(<React.StrictMode><RightPanel /></React.StrictMode>);

});
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "html-import-browser.tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
