import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBox } from "../lib/presets";
import { indexFieldTargets } from "../components/script-editor/field-index";
import type { DocNode, FieldContent } from "../lib/types";

function node(id: string, attrId: string, field?: FieldContent): DocNode {
  return {
    ...makeBox(),
    id,
    attrId,
    ...(field ? { type: "field" as const, field } : {}),
  };
}

test("field index preserves first matching IDs and select choices", () => {
  const nodes = {
    box: node("box", "duplicate"),
    duplicate: node("duplicate", "duplicate", { kind: "select", options: ["ignored"] }),
    select: node("select", "choice", { kind: "select", options: ["First", "", "Second"] }),
  };
  const tree = [{ id: "box" }, { id: "duplicate" }, { id: "select" }];
  const indexed = indexFieldTargets({ nodes }, tree);

  assert.equal(indexed.byAttr.get("duplicate"), null);
  assert.deepEqual(indexed.byAttr.get("choice"), {
    kind: "select", bool: false, choices: ["First", "Second"],
  });
  assert.equal(indexed.byAttr.get("missing"), undefined);
});

test("field index distinguishes radio items from groups and deduplicates labels", () => {
  const nodes = {
    group: node("group", "fruit", { kind: "radio", group: "fruit", label: "Apple" }),
    item: node("item", "apple-button", { kind: "radio", group: "fruit", label: "Banana" }),
    duplicateLabel: node("duplicateLabel", "banana-button", { kind: "radio", group: "fruit", label: "Banana" }),
    checkbox: node("checkbox", "agree", { kind: "checkbox" }),
  };
  const indexed = indexFieldTargets({ nodes }, Object.keys(nodes).map((id) => ({ id })));

  assert.deepEqual(indexed.byAttr.get("fruit"), {
    kind: "radio", bool: false, choices: ["Apple", "Banana"],
  });
  assert.deepEqual(indexed.byNode.get("item"), {
    kind: "radio", bool: true, choices: [],
  });
  assert.deepEqual(indexed.byAttr.get("agree"), {
    kind: "checkbox", bool: true, choices: [],
  });
});
