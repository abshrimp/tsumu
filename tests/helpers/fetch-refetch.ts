import { build } from "esbuild";
import { resolve } from "node:path";
import { makeBox, makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";

export function fetchRefetchDoc(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Fetch requests", assets: {}, nodes: {}, pageOrder: ["p"],
    pages: { p: {
      id: "p", name: "Home", slug: "", title: "Home", description: "", children: [],
      pageScripts: [{ id: "script", trigger: "load", pos: { x: 32, y: 32 }, steps: [
        { id: "fetch", kind: "fetch", as: "products", url: "https://example.test/initial", preview: { sample: [{ name: "Initial" }], fetchedAt: 1 } },
        { id: "other", kind: "fetch", as: "other", url: "https://example.test/other", preview: { sample: [{ name: "Other" }], fetchedAt: 1 } },
      ] }],
    } },
  };
}

/** 行・くり返しとページに同じ名前がある、実際の文書形式の見本。 */
export function fetchScopeDoc(mode: "node" | "loop"): SiteDoc {
  const doc = fetchRefetchDoc();
  const scoped = { id: "scoped", kind: "fetch" as const, as: "result", method: "POST" as const,
    url: mode === "node" ? "https://example.test/{details.id}" : "https://example.test/{details.id}/{empty}/{tags}",
    body: '{"raw":{details}}', preview: { sample: { ok: true }, fetchedAt: 1 } };
  doc.pages.p.query = "details.id=PAGE-DOTTED&empty=PAGE-EMPTY&tags=PAGE-TAGS";
  doc.pages.p.pageScripts![0].steps = [
    { id: "rows", kind: "fetch", as: "rows", url: "https://example.test/rows", preview: { sample: [
      { details: { id: "ROW-ID" }, empty: {}, tags: [] },
    ] } },
    { id: "global", kind: "fetch", as: "details", url: "https://example.test/global", preview: { sample: { id: "PAGE-ID" } } },
  ];
  if (mode === "loop") {
    doc.pages.p.pageScripts![0].steps.push({ id: "each", kind: "for-each", array: "rows", then: [
      { id: "repeat", kind: "repeat", times: 1, then: [scoped] },
    ] });
  } else {
    doc.pages.p.children = ["list"];
    doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: ["act"] };
    doc.nodes.act = { ...makeText("Act"), id: "act", semantic: "button", scripts: [{
      id: "act-script", trigger: "click", pos: { x: 32, y: 32 }, steps: [scoped],
    }] };
  }
  return doc;
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
