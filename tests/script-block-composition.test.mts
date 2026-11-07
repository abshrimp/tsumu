import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { pagePlan, previewDataVars } from "../lib/data";
import { generateProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { scriptsFile } from "../lib/script-runtime";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import { findPaletteItems, LEGACY_ACTION_KEYS, PALETTE } from "../components/script-editor/palette";
import type { ScriptStep } from "../lib/types";

test("a small palette exposes composable blocks without deleting legacy kinds", () => {
  const regular = findPaletteItems("");
  assert.equal(PALETTE.length, 32);
  assert.equal(LEGACY_ACTION_KEYS.size, 10);
  assert.equal(regular.length, 22); // 6 event blocks + 16 actions
  assert.equal(regular.filter(item => item.cat !== "event").length, 16);
  assert.ok(regular.some(item => item.key === "transform"));
  assert.ok(regular.some(item => item.key === "filter-array"));
  assert.ok(!regular.some(item => item.key === "calc"));
  assert.ok(!regular.some(item => item.key === "sort-array"));
  assert.equal(findPaletteItems("", true).length, PALETTE.length);
  assert.ok(findPaletteItems("足し算").some(item => item.key === "calc"));
  assert.ok(findPaletteItems("フィルター解除").some(item => item.key === "unfilter-array"));
});

test("three ordinary canvas steps compose one value in sample preview and server output", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const chain: ScriptStep[] = [
    { id: "t1", kind: "transform", source: "data", into: "chosen",
      transform: { kind: "field", key: "tags" } },
    { id: "t2", kind: "transform", source: "chosen", into: "chosen",
      transform: { kind: "length" } },
    { id: "t3", kind: "transform", source: "chosen", into: "chosen",
      transform: { kind: "math", operation: "add", operand: 5 } },
  ];
  steps.splice(1, 1, ...chain);
  const plan = pagePlan(doc, "p");
  for (const step of chain) assert.ok(plan.serverIds.has(step.id));
  assert.equal(previewDataVars(doc, "p").chosen, 7);
  const files = generateProject(doc).files;
  assert.ok(files["lib/value-recipe.js"]);
  assert.match(files["lib/value-recipe.js"], /evaluateValueRecipe/);
  const page = files["app/page.tsx"];
  assert.ok(page);
  assert.match(page, /__evalValueRecipe/);
  assert.match(page, /"math"/);
  assert.doesNotThrow(() => transformSync(page, { loader: "tsx", jsx: "automatic" }));
});

test("click-handler blocks keep the full chain in exported browser scripts", () => {
  const doc = scriptDataPickerDoc();
  const node = { ...makeBox(), id: "action", attrId: "action", scripts: [{
    id: "click", trigger: "click" as const, pos: { x: 0, y: 0 },
    steps: [
      { id: "source", kind: "set-var" as const, value: "4", into: "number" },
      { id: "t1", kind: "transform" as const, source: "number", into: "number",
        transform: { kind: "parse" as const } },
      { id: "t2", kind: "transform" as const, source: "number", into: "number",
        transform: { kind: "math" as const, operation: "multiply" as const, operand: 3 } },
    ],
  }] };
  doc.nodes.action = node;
  doc.pages.p.children.push("action");
  const steps = compileScripts(node, () => "/")[0].steps;
  assert.deepEqual(steps.map(step => step.kind), ["set-var", "transform", "transform"]);
  assert.equal((steps[2].transform as {kind:string}).kind, "math");
  assert.equal(steps[2].source, "number");
  assert.equal(steps[2].into, "number");
  const browser = scriptsFile(doc);
  assert.match(browser, /case "transform"/);
  assert.doesNotThrow(() => new Function(browser));
});

test("pure transformation output remains distinct from list display filtering", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "t", kind: "transform", source: "data.tags", into: "filtered",
    transform: { kind: "filter", field: "", operation: "eq", operand: "red", operandType: "text" },
  });
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("t"));
  assert.deepEqual(previewDataVars(doc, "p").filtered, ["red"]);
  assert.deepEqual(previewDataVars(doc, "p").data, {
    name: "Product", price: 12, code: "001", available: false, empty: null,
    detail: { title: "Nested" }, tags: ["red", "blue"], rows: [{ title: "First" }],
  });
});
