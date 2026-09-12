import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function commitFieldsDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Commit fields", assets: {}, nodes: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Original page", slug: "", title: "Original title", description: "Original description", children: [] } },
  };
}

/** 実際の確定する入力欄で、入力・確定・外からの更新・呼び出し側のイベントを確かめる。 */
export async function commitFieldsBundle() {
  return (await build({
    stdin: { contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import { isEnterKey } from "./lib/keys";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { CommitInput, CommitTextarea } = await import("./components/controls");
window.commitFields = { writes: [], events: [] };
function Example() {
  const [value, setValue] = useState("Original value");
  const [flags, setFlags] = useState({});
  window.commitFields.setValue = setValue;
  window.commitFields.setFlags = setFlags;
  const props = {
    value, ...flags,
    onInput: () => window.commitFields.events.push("input"),
    onChange: () => window.commitFields.events.push("change"),
    onFocus: () => window.commitFields.events.push("focus"),
    onCompositionStart: () => window.commitFields.events.push("compositionstart"),
    onCompositionEnd: () => window.commitFields.events.push("compositionend"),
    onCommit: value => {
      window.commitFields.writes.push(value);
      setValue(value.trim() || "Original value");
    },
  };
  return <>
    <CommitInput id="single" {...props} onKeyDown={e => {
      window.commitFields.events.push("keydown");
      if (isEnterKey(e)) e.currentTarget.blur();
    }} />
    <CommitTextarea id="multi" {...props} />
    <output id="stored">{value}</output>
    <button id="outside">Outside</button>
  </>;
}
createRoot(document.getElementById("app")).render(<React.StrictMode><Example /></React.StrictMode>);

});
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "commit-fields-browser.tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}

/** ページの設定の実際のコンポーネントとストアで、元に戻す・やり直すと、共同編集の履歴を確かめる。 */
export async function commitPageFieldsBundle() {
  return (await build({
    stdin: { contents: `
import React from "react";
import { createRoot } from "react-dom/client";

import { useEditor } from "./lib/store";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { default: PagePanel } = await import("./components/PagePanel");
useEditor.getState().replaceDoc(${JSON.stringify(commitFieldsDoc())});
window.commitPageEditor = useEditor;
createRoot(document.getElementById("app")).render(<React.StrictMode><PagePanel /></React.StrictMode>);

});
`, resolveDir: resolve("."), loader: "tsx", sourcefile: "commit-page-fields-browser.tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
