import { build } from "esbuild";
import { resolve } from "node:path";

/** 実際のポータル、ダイアログの Promise、翻訳、CSS を使う。サーバーは要らない。 */
export async function dialogFocusBundle() {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DialogHost from "./components/DialogHost";
import { showAlert, showConfirm, showPrompt } from "./lib/dialog";
import { loadLocale } from "./lib/i18n";
import css from "./app/globals.css";
const style = document.createElement("style"); style.textContent = css; document.head.append(style);
function Fixture() {
  const [results, setResults] = useState([]);
  const record = result => setResults(items => [...items, result]);
  return <>
    <button id="confirm" onClick={() => void showConfirm("Continue editing?", { danger: true }).then(record)}>Confirm</button>
    <button id="prompt" onClick={() => void showPrompt("Type DELETE", { expect: "DELETE" }).then(record)}>Prompt</button>
    <button id="alert" onClick={() => void showAlert("Saved").then(() => record("acknowledged"))}>Alert</button>
    <button id="queue" onClick={() => {
      void showConfirm("First?").then(record);
      void showAlert("Second").then(() => record("second"));
    }}>Queue</button>
    <input aria-label="Background name" defaultValue="unchanged" />
    <output id="results">{JSON.stringify(results)}</output>
    <DialogHost />
  </>;
}
void loadLocale().then(() => createRoot(document.getElementById("app")).render(<React.StrictMode><Fixture /></React.StrictMode>));
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "dialog-focus-browser.tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "text" }, define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
