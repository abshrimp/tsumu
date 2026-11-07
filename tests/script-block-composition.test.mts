import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { pagePlan, previewDataVars } from "../lib/data";
import { generateProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { scriptsFile } from "../lib/script-runtime";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import { findPaletteItems, PALETTE } from "../components/script-editor/palette";
import { connectNewTransform } from "../components/script-editor/step-tree";
import type { ScriptStep } from "../lib/types";

test("every supported palette action is visible without hidden compatibility groups", () => {
  assert.equal(PALETTE.length, 22);
  assert.equal(findPaletteItems("").length, 22);
  assert.equal(PALETTE.filter(item => item.cat !== "event").length, 16);
  assert.ok(PALETTE.some(item => item.key === "transform"));
  assert.ok(PALETTE.some(item => item.key === "list-display"));
  assert.ok(findPaletteItems("値を加工").some(item => item.key === "transform"));
});

test("three ordinary blocks compose a value in preview and server generated output", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  const chain: ScriptStep[] = [
    { id: "t1", kind: "transform", source: "data", into: "chosen", transform: { kind: "field", key: "tags" } },
    { id: "t2", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "length" } },
    { id: "t3", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "math", operation: "add", operand: 5 } },
  ];
  steps.splice(1, 1, ...chain);
  const plan = pagePlan(doc, "p");
  for (const block of chain) assert.ok(plan.serverIds.has(block.id));
  assert.equal(previewDataVars(doc, "p").chosen, 7);
  const files = generateProject(doc).files;
  assert.ok(files["lib/value-recipe.ts"]);
  const server = files["app/page.tsx"];
  assert.match(server, /__evalValueRecipe/);
  assert.match(server, /"math"/);
  assert.doesNotThrow(() => transformSync(server, { loader: "tsx", jsx: "automatic" }));
});

test("comparison operands can refer to another variable", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "threshold", kind: "set-var", value: "{data.price}", into: "threshold",
  }, {
    id: "cmp", kind: "transform", source: "data.price", into: "above",
    transform: { kind: "compare", operation: "gte", operandType: "variable", operand: "threshold" },
  });
  const result = previewDataVars(doc, "p");
  assert.equal(result.threshold, 12);
  assert.equal(result.above, true);
});

test("server preview can calculate using numeric strings from another variable and edit lists", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push(
    { id: "rate", kind: "set-var", value: "1.5", into: "rate" },
    { id: "calc", kind: "transform", source: "data.price", into: "total",
      transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "rate" } },
    { id: "append", kind: "transform", source: "data.tags", into: "tags",
      transform: { kind: "append", operandType: "text", operand: "green" } },
    { id: "remove", kind: "transform", source: "tags", into: "tags",
      transform: { kind: "remove", operandType: "text", operand: "red" } },
  );
  const vars = previewDataVars(doc, "p");
  assert.equal(vars.total, 18);
  assert.deepEqual(vars.tags, ["blue", "green"]);
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("calc"));
  assert.ok(plan.serverIds.has("append"));
  assert.ok(plan.serverIds.has("remove"));
  const generated = generateProject(doc).files["app/page.tsx"];
  assert.match(generated, /"append"/);
  assert.match(generated, /"remove"/);
  assert.doesNotThrow(() => transformSync(generated, { loader: "tsx", jsx: "automatic" }));
});

test("a canvas transform chain serializes to the browser runtime without losing step order", () => {
  const doc = scriptDataPickerDoc();
  const node = { ...makeBox(), id: "action", attrId: "action", scripts: [{
    id: "click", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [
      { id: "input", kind: "set-var" as const, into: "number", value: "4" },
      { id: "parse", kind: "transform" as const, source: "number", into: "number", transform: { kind: "parse" as const } },
      { id: "math", kind: "transform" as const, source: "number", into: "number",
        transform: { kind: "math" as const, operation: "multiply" as const, operand: 3 } },
    ],
  }] };
  doc.nodes.action = node;
  doc.pages.p.children.push("action");
  const steps = compileScripts(node, () => "/")[0].steps;
  assert.deepEqual(steps.map(s => s.kind), ["set-var", "transform", "transform"]);
  assert.equal(steps[2].into, "number");
  assert.doesNotThrow(() => new Function(scriptsFile(doc)));
});

test("newly dropped processing blocks inherit the preceding output without mutation", () => {
  const doc = scriptDataPickerDoc();
  const script = { ...doc.pages.p.pageScripts![0], nodeId: null };
  const incoming: ScriptStep[] = [
    { id: "next", kind: "transform", source: "", into: "", transform: { kind: "length" } },
  ];
  const connected = connectNewTransform([script], { scriptId: script.id, list: "root", index: 2 }, incoming);
  assert.deepEqual(connected, [
    { id: "next", kind: "transform", source: "chosen", into: "chosen", transform: { kind: "length" } },
  ]);
  assert.equal((incoming[0] as Extract<ScriptStep, { kind: "transform" }>).source, "");
});

test("constant load steps are evaluated on the server without leaking unused values to browser scripts", () => {
  const doc = scriptDataPickerDoc();
  doc.pages.p.pageScripts![0].steps.push({
    id: "private", kind: "set-var", value: "UNUSED_PRIVATE_SENTINEL", into: "private",
  });
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("private"));
  assert.equal(previewDataVars(doc, "p").private, "UNUSED_PRIVATE_SENTINEL");
  const files = generateProject(doc).files;
  assert.ok(files["app/page.tsx"].includes("UNUSED_PRIVATE_SENTINEL"));
  assert.doesNotMatch(files["public/scripts.js"] ?? "", /UNUSED_PRIVATE_SENTINEL/);
});

test("fetched sample totals are preserved through aliases in composition without truncating actual data", () => {
  const doc = scriptDataPickerDoc();
  const fetch = doc.pages.p.pageScripts![0].steps[0];
  if (fetch.kind !== "fetch") throw new Error("Expected fetch fixture");
  fetch.sampleTotals = { tags: 52 };
  doc.pages.p.pageScripts![0].steps.push(
    { id: "alias", kind: "set-var", value: "{data.tags}", into: "selectedTags" },
    { id: "len", kind: "transform", source: "selectedTags", into: "total", transform: { kind: "length" } },
  );
  assert.equal(previewDataVars(doc, "p").total, 52);
  assert.equal(previewDataVars(doc, "p", {
    live: { fetch: { tags: ["x", "y", "z"] } },
  }).total, 3);
  assert.equal(previewDataVars(doc, "p", {
    live: { fetch: { tags: ["x", "y"] } },
    liveTotals: { fetch: { tags: 42 } },
  }).total, 42);
});
