import { build } from "esbuild";
import { resolve } from "node:path";
import type { SiteDoc } from "../../lib/types";

export function fetchRefetchDoc(): SiteDoc {
  return {
    siteName: "Fetch requests", assets: {}, nodes: {}, pageOrder: ["p"],
    pages: { p: {
      id: "p", name: "Home", slug: "", title: "Home", description: "", children: [],
      pageScripts: [{ id: "script", trigger: "load", pos: { x: 32, y: 32 }, steps: [
        { id: "fetch", kind: "fetch", as: "products", url: "https://example.test/initial", sample: [{ name: "Initial" }], fetchedAt: 1 },
        { id: "other", kind: "fetch", as: "other", url: "https://example.test/other", sample: [{ name: "Other" }], fetchedAt: 1 },
      ] }],
    } },
  };
}

/** 実際のスクリプト画面・ストア・変数の見本を使い、API の応答順だけを操作する。 */
export async function fetchRefetchBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ScriptEditor from "./components/ScriptEditor";
import { useEditor } from "./lib/store";
import { previewDataVars } from "./lib/data";
useEditor.getState().replaceDoc(${JSON.stringify(fetchRefetchDoc())});
window.refetchEditor = useEditor;
window.refetchRequests = [];
window.fetch = (url, options) => new Promise((resolve) => {
  window.refetchRequests.push({ input: JSON.parse(options.body), resolve });
});
window.finishRefetch = async (index, json, error) => {
  window.refetchRequests[index].resolve(new Response(JSON.stringify(error ? { error } : { json }), { status: error ? 502 : 200 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
function Fixture() {
  const doc = useEditor((s) => s.doc);
  const [open, setOpen] = useState(true);
  return <>
    <button id="reopen-script" onClick={() => setOpen(true)}>Reopen scripts</button>
    <output id="fetch-preview">{JSON.stringify(previewDataVars(doc, "p"))}</output>
    {open && <ScriptEditor onClose={() => setOpen(false)} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Fixture />);
`,
      loader: "tsx", sourcefile: "fetch-refetch-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
