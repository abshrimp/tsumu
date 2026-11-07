import assert from "node:assert/strict";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { pagePlan, previewDataVars } from "../lib/data";
import { generateProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { evaluateValueRecipe } from "../lib/script-model/recipe-runtime";
import { scriptDataPickerDoc } from "./helpers/script-data-picker";
import type { ScriptStep } from "../lib/types";

function recipeStep() {
  return {
    id: "value", kind: "set-var", value: "{data}", into: "chosen",
    recipe: { source: "data", steps: [
      { kind: "field", key: "tags" }, { kind: "length" }, { kind: "format" },
    ] },
  } as const satisfies ScriptStep;
}

test("shared recipe evaluator preserves missing and null and rejects wrong input types", () => {
  const recipe = [{ kind: "field", key: "empty" }, { kind: "fallback-nullish", text: "default" }] as const;
  assert.deepEqual(evaluateValueRecipe({ empty: null }, recipe), { kind: "value", value: "default" });
  assert.deepEqual(evaluateValueRecipe({}, recipe), { kind: "value", value: "default" });
  assert.deepEqual(evaluateValueRecipe({ empty: false }, recipe), { kind: "value", value: false });
  assert.deepEqual(evaluateValueRecipe({ empty: 0 }, recipe), { kind: "value", value: 0 });
  assert.deepEqual(evaluateValueRecipe({ tags: [1, 2] }, [{ kind: "field", key: "tags" }, { kind: "length" }]),
    { kind: "value", value: 2 });
  assert.deepEqual(evaluateValueRecipe({ tags: "wrong" }, [{ kind: "field", key: "tags" }, { kind: "length" }]),
    { kind: "error", code: "type-mismatch" });
});

test("loading a saved recipe computes the same result for editor samples and generated SSR", () => {
  const doc = scriptDataPickerDoc();
  const steps = doc.pages.p.pageScripts![0].steps;
  steps.splice(1, 1, recipeStep());
  const plan = pagePlan(doc, "p");
  assert.ok(plan.serverIds.has("value"), "server-only source is computed before rendering");
  assert.equal(previewDataVars(doc, "p").chosen, "2");
  const files = generateProject(doc).files;
  const server = files["app/page.tsx"];
  assert.ok(server);
  assert.match(server, /__evalValueRecipe/);
  assert.match(server, /"length"/);
  assert.doesNotThrow(() => transformSync(server, { loader: "tsx", jsx: "automatic" }));
});

test("client-side event script retains recipe without altering legacy set-var behavior", () => {
  const doc = scriptDataPickerDoc();
  const node = { ...makeBox(), id: "action", attrId: "action", scripts: [{
    id: "event", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [recipeStep()],
  }] };
  doc.nodes.action = node;
  doc.pages.p.children.push("action");
  const plan = pagePlan(doc, "p");
  assert.ok(plan.clientVars.has("chosen"));
  const compiled = compileScripts(node, () => "/", undefined, true);
  assert.deepEqual(compiled[0].steps[0], { kind: "set-var", into: "chosen", recipe: recipeStep().recipe });
  const js = scriptsFile(doc);
  assert.match(js, /evalRecipe/);
  assert.doesNotThrow(() => new Function(js));
  assert.doesNotThrow(() => new Function("return (" + SCRIPT_RUNTIME + ")"));
});
