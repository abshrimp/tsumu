import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc, makeField } from "../lib/presets";
import { useEditor } from "../lib/store";
import { fieldDefaults, fieldStateValues } from "../lib/fields";

test("duplicating a checked radio and editing its label selects the last checked item in preview", () => {
  const doc = createInitialDoc();
  const first = makeField("radio");
  first.attrId = "first";
  first.field = { kind: "radio", group: "choice", checked: true, label: "First" };
  doc.nodes[first.id] = first;
  const page = doc.pages[doc.pageOrder[0]];
  page.children = [first.id];
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage(page.id);
  useEditor.getState().duplicateNode(first.id);
  const copyId = useEditor.getState().selection!;
  const copied = useEditor.getState().doc.nodes[copyId];
  useEditor.getState().updateNode(copyId, { field: { ...copied.field!, label: "Second" } });
  const current = useEditor.getState().doc;
  const fields = current.pages[page.id].children.map(id => current.nodes[id]);
  assert.equal(fields.filter(n => n.field?.checked).length, 2);
  const before = structuredClone(fields);
  const values = fieldDefaults(fields);
  assert.equal(values.choice, "Second");
  const states = fieldStateValues(fields, values);
  assert.equal(states["choice.index"], "2");
  assert.equal(states.first, "false");
  assert.equal(states[copied.attrId!], "true");
  assert.deepEqual(fields, before, "reading defaults must not rewrite saved checked flags");
});

test("unchecked later radios do not clear the winner and independent groups stay independent", () => {
  const radio = (id: string, group: string, checked: boolean, label: string) =>
    ({ ...makeField("radio"), id, attrId: id, field: { kind: "radio" as const, group, checked, label } });
  const fields = [
    radio("a", "choice", true, "Old"),
    radio("b", "other", true, "Other"),
    radio("c", "choice", true, "{latest}"),
    radio("d", "choice", false, "Unchecked"),
  ];
  assert.deepEqual(fieldDefaults(fields, { latest: "New" }), { choice: "New", other: "Other" });
});
