import { build } from "esbuild";
import { resolve } from "node:path";
import { createInitialDoc, makeBox } from "../../lib/presets";

export async function bodySearchModalBundle() {
  const doc = createInitialDoc();
  const first = doc.pageOrder[0];
  doc.pages[first].name = "Home";
  doc.pages[first].children = [];
  for (let index = 0; index < 120; index++) {
    const id = "search-" + index;
    doc.nodes[id] = {
      ...makeBox(), id, name: "Text " + index,
      text: { content: "Searchable item " + index + " 日本語の本文", heading: 0 },
    };
    doc.pages[first].children.push(id);
  }
  doc.pages.other = {
    id: "other", name: "Second page", slug: "second", title: "",
    description: "", children: ["special"],
  };
  doc.pageOrder.push("other");
  doc.nodes.special = {
    ...makeBox(), id: "special", name: "Target",
    text: { content: "Unique visitor text", heading: 0 },
  };

  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useEditor } from "./lib/store";
import { loadLocale } from "./lib/i18n";
useEditor.getState().replaceDoc(${JSON.stringify(doc)});
window.bodySearchStore = useEditor;
async function start() {
  await loadLocale();
  const { default: BodySearch } = await import("./components/BodySearch");
  function Fixture() {
    const [open, setOpen] = useState(true);
    window.openBodySearch = () => setOpen(true);
    return <><button id="open-search" onClick={() => setOpen(true)}>Open</button>
      {open && <BodySearch onClose={() => setOpen(false)} />}</>;
  }
  createRoot(document.getElementById("app")).render(<Fixture />);
}
void start();
`,
      loader: "tsx", sourcefile: "body-search-modal-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
