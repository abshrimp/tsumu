import { build } from "esbuild";
import { resolve } from "node:path";

let compiledMotionBundle: Promise<string> | undefined;
let compiledEasingBundle: Promise<string> | undefined;

/** 実際のモーダルと操作部品を取り付ける。この準備が持つのは、適用と取り消しの状態だけ。 */
export async function motionEditorBundle(initialCss = "0% { opacity: 0; } 50% { opacity: 0.5; } 100% { opacity: 1; }") {
  compiledMotionBundle ??= build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { KeyframeEditorModal } = await import("./components/MotionEditors");

function Fixture() {
  const [css, setCss] = useState(window.__initialMotionCss);
  const [open, setOpen] = useState(true);
  window.__resetMotion = (next) => {
    flushSync(() => { setOpen(false); setCss(next); });
    flushSync(() => setOpen(true));
  };
  return <>
    <style>{"@keyframes keyframe-test {" + css + "}"}</style>
    <div id="motion-probe" style={{ animation: "keyframe-test 100s linear paused both", position: "absolute", left: -10000, width: 10, height: 10 }} />
    <button id="reopen" onClick={() => setOpen(true)}>Open keyframes</button>
    <output id="saved">{css}</output>
    {open && <KeyframeEditorModal css={css} duration={1} easing="linear"
      onClose={() => setOpen(false)} onApply={(next) => { setCss(next); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Fixture />);

});
`,
      resolveDir: resolve("."), loader: "tsx", sourcefile: "motion-editor-fixture.tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  }).then(result => result.outputFiles[0].text);
  return `window.__initialMotionCss = ${JSON.stringify(initialCss)};\n` + await compiledMotionBundle;
}

/** 実際のイージングのモーダル。CSS を調べる仕組みで、変更せずに適用した場合と開き直した場合を比べる。 */
export async function easingEditorBundle(initial = "cubic-bezier(0.123456, 0.000001, 0.876543, 1.234567)") {
  compiledEasingBundle ??= build({
    stdin: {
      contents: `
import React, { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { loadLocale } from "./lib/i18n";
void loadLocale().then(async () => {
  const { EasingCurve, EasingEditorModal } = await import("./components/MotionEditors");

function Fixture() {
  const [value, setValue] = useState(window.__initialEasing);
  const [open, setOpen] = useState(true);
  window.__resetEasing = (next) => {
    flushSync(() => { setOpen(false); setValue(next); });
    flushSync(() => setOpen(true));
  };
  return <>
    <EasingCurve value={value} />
    <div id="easing-probe" style={{ transitionTimingFunction: value }} />
    <button id="reopen" onClick={() => setOpen(true)}>Open easing</button>
    <output id="saved">{value}</output>
    {open && <EasingEditorModal value={value} duration={1}
      onClose={() => setOpen(false)} onApply={(next) => { setValue(next); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("app")).render(<Fixture />);

});
`,
      resolveDir: resolve("."), loader: "tsx", sourcefile: "easing-editor-fixture.tsx",
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  }).then(result => result.outputFiles[0].text);
  return `window.__initialEasing = ${JSON.stringify(initial)};\n` + await compiledEasingBundle;
}
