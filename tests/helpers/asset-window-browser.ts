import { build } from "esbuild";
import { resolve } from "node:path";

export async function assetWindowBundle() {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
let AssetsTab;
let DialogHost;
import { useEditor } from "./lib/store";
import { largeAssetLibrary } from "./tests/helpers/large-asset-library";
useEditor.getState().replaceDoc(largeAssetLibrary(5000, 0));
window.assetEditor = useEditor;
function App() {
  const [open, setOpen] = useState(true);
  window.setAssetPanelOpen = setOpen;
  return <><button id="before">Before</button><div id="asset-host" style={{width: 274, height: 700, display: "flex"}}>
    {open && <AssetsTab />}</div><button id="after">After</button><DialogHost /></>;
}
void loadLocale().then(async () => {
  ({ AssetsTab } = await import("./components/left-panel/AssetsTab"));
    ({ default: DialogHost } = await import("./components/DialogHost"));
  createRoot(document.getElementById("app")).render(<React.StrictMode><App /></React.StrictMode>);
});
`, loader: "tsx", sourcefile: "asset-window-browser.tsx", resolveDir: resolve(".") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
