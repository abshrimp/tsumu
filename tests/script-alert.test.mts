import assert from "node:assert/strict";
import { test } from "node:test";
import { Script as JsScript } from "node:vm";
import { compileScripts } from "../lib/script";
import { scriptsFile } from "../lib/script-runtime";
import { findPaletteItems, PALETTE } from "../components/script-editor/palette";
import { createInitialDoc } from "../lib/presets";
import { pageVariableIndex, mapNodeTokens } from "../lib/data";
import type { ScriptStep } from "../lib/types";

const dialog: ScriptStep = { id: "dialog", kind: "dialog", mode: "alert", message: "こんにちは {user}" };

test("one palette block can show alert, confirm, or prompt", () => {
  const item = PALETTE.find((entry) => entry.key === "dialog");
  assert.ok(item);
  assert.equal(item.cat, "look");
  for (const query of ["アラート", "確認", "prompt", "警告"])
    assert.ok(findPaletteItems(query).some((entry) => entry.key === "dialog"), query);
  const created = item.make() as { type: "steps"; steps: ScriptStep[] };
  assert.deepEqual(created.steps, [{
    id: created.steps[0].id, kind: "dialog", mode: "alert", message: "",
  }]);
});

test("dialog compiler handles variable-containing messages and prompt defaults", () => {
  const actions: ScriptStep[] = [
    dialog,
    { id: "confirm", kind: "dialog", mode: "confirm", message: "Proceed?", into: "approved" },
    { id: "prompt", kind: "dialog", mode: "prompt", message: "Name?", into: "answer", defaultValue: "{user}" },
  ];
  const compiled = compileScripts({
    scripts: [{ id: "main", trigger: "click", pos: { x: 0, y: 0 }, steps: actions }],
  }, () => "", (value, kind) => {
    assert.equal(kind, "value");
    return "compiled:" + value;
  });
  assert.deepEqual(compiled, [{
    trigger: "click",
    steps: [
      { kind: "dialog", mode: "alert", message: "compiled:こんにちは {user}" },
      { kind: "dialog", mode: "confirm", message: "compiled:Proceed?", into: "approved" },
      { kind: "dialog", mode: "prompt", message: "compiled:Name?", defaultValue: "compiled:{user}", into: "answer" },
    ],
  }]);
});

test("prompt and confirm result variable names appear in page variable index, alert does not", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{
    id: "steps", trigger: "click", pos: { x: 0, y: 0 },
    steps: [
      { id: "a", kind: "dialog", mode: "alert", message: "Hello", into: "unused" },
      { id: "b", kind: "dialog", mode: "confirm", message: "Continue?", into: "yes" },
      { id: "c", kind: "dialog", mode: "prompt", message: "Enter", into: "text" },
    ],
  }];
  assert.deepEqual(new Set(pageVariableIndex(doc, page.id).names).has("unused"), false);
  assert.ok(pageVariableIndex(doc, page.id).names.includes("yes"));
  assert.ok(pageVariableIndex(doc, page.id).names.includes("text"));
});

test("dialog body variables are renamed in both prompt and message inputs", () => {
  const node = { text: null, image: undefined, link: null, children: [],
    scripts: [{ id: "script", trigger: "click", pos: { x: 0, y: 0 }, steps: [
      { id: "prompt", kind: "dialog", mode: "prompt", message: "Name {old}", defaultValue: "{old}" },
    ] }],
  } as unknown as import("../lib/types").DocNode;
  mapNodeTokens(node, (name) => name === "old" ? "new" : null);
  const step = node.scripts?.[0].steps[0];
  assert.ok(step && step.kind === "dialog");
  assert.equal(step.message, "Name {new}");
  assert.equal(step.defaultValue, "{new}");
});

test("published scripts include dialog runtime only when used, including nested blocks", () => {
  const doc = createInitialDoc();
  const page = doc.pages[doc.pageOrder[0]];
  page.pageScripts = [{
    id: "load", trigger: "click", pos: { x: 0, y: 0 },
    steps: [{ id: "if", kind: "if",
      cond: { subject: "value", target: "input", op: "eq", value: "yes" },
      then: [dialog],
    }],
  }];
  const code = scriptsFile(doc);
  assert.match(code, /case "dialog":/);
  assert.doesNotThrow(() => new JsScript(code));
  page.pageScripts![0].steps = [{ id: "wait", kind: "wait", seconds: 0.05 }];
  assert.doesNotMatch(scriptsFile(doc), /case "dialog":/);
});
