import assert from "node:assert/strict";
import { test } from "node:test";
import { Script as JsScript } from "node:vm";
import { scriptsFile } from "../lib/script-runtime";
import type { ScriptStep, SiteDoc } from "../lib/types";

const steps: ScriptStep[] = [
  { id: "assign", kind: "set-var", into: "x", value: "1" },
  { id: "insert", kind: "set-list-item", list: "items", key: "", value: "1" },
  { id: "delete", kind: "remove-list-item", list: "items", mode: "value", value: "1" },
  { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
];

for (const step of steps) test(`published nested ${step.kind} includes only its required variable operations`, () => {
  const doc: SiteDoc = {
    siteName: "", assets: {}, pageOrder: ["p"], nodes: {}, pages: { p: {
      id: "p", name: "", slug: "", description: "", title: "", children: [], pageScripts: [{
        id: "s", trigger: "click", pos: { x: 0, y: 0 },
        steps: [{ id: "repeat", kind: "repeat", times: 1, then: [step] }],
      }],
    } },
  };
  const code = scriptsFile(doc);
  assert.doesNotThrow(() => new JsScript(code));
  for (const other of steps) assert.equal(code.includes(`case "${other.kind}":`), step.kind === other.kind);
  assert.equal(code.includes("var evalRecipe ="), step.kind === "transform");
  assert.equal(code.includes("var removeItem ="), step.kind === "remove-list-item");
});
