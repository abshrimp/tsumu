import { build } from "esbuild";
import { resolve } from "node:path";

/** Mount the real modal and controls; the fixture owns only Apply/Cancel state. */
export async function motionEditorBundle() {
  return (await build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { KeyframeEditorModal } from "./components/MotionEditors";
function Fixture() {
  const [css, setCss] = useState("0% { opacity: 0; } 50% { opacity: 0.5; } 100% { opacity: 1; }");
  const [open, setOpen] = useState(true);
  return <>
    <button id="reopen" onClick={() => setOpen(true)}>Open keyframes</button>
    <output id="saved">{css}</output>
    {open && <KeyframeEditorModal css={css} duration={1} easing="linear"
      onClose={() => setOpen(false)} onApply={(next) => { setCss(next); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Fixture />);
`,
      resolveDir: resolve("."), loader: "tsx", sourcefile: "motion-editor-fixture.tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
