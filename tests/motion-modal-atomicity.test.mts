import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { makeBox } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

const current = () => useEditor.getState();
const flatten = (node: any): any[] =>
  Array.isArray(node) ? node.flatMap(flatten) :
  node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];

function mount() {
  const doc: SiteDoc = {
    siteName: "Motion modal test", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", motions: [{
      id: "motion-1", trigger: "load", property: "all", keyframes: "fade-up",
      duration: 0.3, delay: 0, easing: "ease-out", repeat: 1, direction: "normal", fillMode: "both",
    }] } },
  };
  current().replaceDoc(doc);
  current().setActivePage("p");
  current().select("a");

  const path = resolve("components/style-panel/MotionSec.tsx");
  const require = createRequire(path);
  const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  const module = { exports: {} as any };
  const cells: unknown[] = [];
  let cursor = 0;
  function KeyframeEditorModal() { return null; }
  function EasingEditorModal() { return null; }
  function EasingCurve() { return null; }
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return {
      ...require(id),
      useState: (init: unknown) => {
        const n = cursor++;
        if (!(n in cells)) cells[n] = typeof init === "function" ? (init as () => unknown)() : init;
        return [cells[n], (v: any) => { cells[n] = typeof v === "function" ? v(cells[n]) : v; }];
      },
    };
    if (id === "../../lib/store") return {
      useEditor: (selector: (state: ReturnType<typeof useEditor.getState>) => unknown) => selector(current()),
    };
    if (id === "../MotionEditors") return { KeyframeEditorModal, EasingEditorModal, EasingCurve };
    if (id === "../controls") return { Dropdown: "Dropdown", Grp: "Grp", NumField: "NumField" };
    if (id === "./shared") return { Sec: "Sec", I: 12 };
    return require(id);
  }, module, module.exports);
  const render = () => { cursor = 0; return flatten(module.exports.MotionSec({ node: current().doc.nodes.a })); };
  const picker = () => render().find(
    (v) => v.type === "Dropdown" && v.props.options?.some((o: any) => o.value === "custom") &&
      v.props.options?.some((o: any) => o.value === "fade-up")
  );
  const modal = () => render().find((v) => v.type === KeyframeEditorModal);
  return { render, picker, modal };
}

test("selecting custom keyframes and cancelling does not modify the document or history", () => {
  const ui = mount();
  const before = structuredClone({ doc: current().doc, past: current().past, future: current().future });
  const dropdown = ui.picker();
  assert.ok(dropdown, "the actual keyframe dropdown must be rendered");
  dropdown.props.onChange("custom");
  const opened = ui.modal();
  assert.ok(opened, "custom selection must open the keyframe editor");
  assert.match(opened.props.css, /\b(?:from|0%)\s*\{/);
  assert.deepEqual({ doc: current().doc, past: current().past, future: current().future }, before);
  opened.props.onClose();
  assert.equal(ui.modal(), undefined);
  assert.deepEqual({ doc: current().doc, past: current().past, future: current().future }, before);
});

test("applying custom keyframes changes preset and CSS in a single undoable document edit", () => {
  const ui = mount();
  const before = structuredClone(current().doc);
  ui.picker().props.onChange("custom");
  const modal = ui.modal();
  assert.ok(modal);
  const css = "from { opacity: 0.25; } to { opacity: 1; }";
  modal.props.onApply(css);
  assert.equal(ui.modal(), undefined);
  assert.equal(current().doc.nodes.a.motions?.[0].keyframes, "custom");
  assert.equal(current().doc.nodes.a.motions?.[0].customKeyframes, css);
  assert.equal(current().past.length, 1);
  const after = structuredClone(current().doc);
  current().undo();
  assert.deepEqual(current().doc, before);
  current().redo();
  assert.deepEqual(current().doc, after);
});

test("reopening a custom motion edits its saved CSS without changing it on Cancel", () => {
  const ui = mount();
  ui.picker().props.onChange("custom");
  ui.modal().props.onApply("from { opacity: 0.25; }");
  const before = structuredClone({ doc: current().doc, past: current().past, future: current().future });
  const edit = ui.render().find((v) => v.type === "button" && v.props.className === "btn me-open");
  assert.ok(edit);
  edit.props.onClick();
  const modal = ui.modal();
  assert.equal(modal.props.css, "from { opacity: 0.25; }");
  modal.props.onClose();
  assert.deepEqual({ doc: current().doc, past: current().past, future: current().future }, before);
});
