import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldDefaults, fieldInitialValue, fieldStateValues } from "../lib/fields";
import { renderLeafNode } from "../components/canvas/render";
import { useEditor } from "../lib/store";
import { publishedSelectDefault, selectDefaultDoc } from "./helpers/select-default";

test("renaming the default option uses the first remaining choice without rewriting the document", () => {
  useEditor.getState().replaceDoc(selectDefaultDoc());
  const original = useEditor.getState().doc.nodes.choice;
  // 設定の欄と同じ変更。初期値は消さず、「元に戻す」で元の選択肢に戻せる。
  useEditor.getState().updateNode("choice", { field: { ...original.field!, options: ["A", "C"].map(value => ({ label:value,value })) } });
  const edited = structuredClone(useEditor.getState().doc);
  const read = () => fieldDefaults([useEditor.getState().doc.nodes.choice]).choice;
  assert.equal(read(), "A");
  assert.deepEqual(useEditor.getState().doc, edited);
  assert.equal(edited.nodes.choice.field!.defaultValue, "B");
  useEditor.getState().undo();
  assert.equal(read(), "B");
  useEditor.getState().redo();
  assert.equal(read(), "A");
});

for (const [name, options, defaultValue, vars, expected, index] of [
  ["valid default", ["A", "B"], "B", {}, "B", "2"],
  ["missing default", ["A", "B"], undefined, {}, "A", "1"],
  ["blank setting omits default", ["A", "{empty}"], "", { empty: "" }, "A", "1"],
  ["removed default", ["A", "C"], "B", {}, "A", "1"],
  ["no choices", [], "B", {}, "", "0"],
  ["resolved valid default", ["{a}", "{b}"], "{selected}", { a: "A", b: "B", selected: "B" }, "B", "2"],
  ["resolved removed default", ["{a}", "{b}"], "{selected}", { a: "A", b: "C", selected: "B" }, "A", "1"],
  ["resolved empty first choice", ["{empty}", "B"], "C", { empty: "" }, "", "1"],
  ["resolved empty default", ["A", "{empty}"], "{empty}", { empty: "" }, "", "2"],
] as const) {
  test(`select initial state matches native selection: ${name}`, () => {
    const doc = selectDefaultDoc({ options: [...options].map(value => ({label:value,value})), defaultValue });
    const node = doc.nodes.choice;
    const field = node.field!;
    assert.equal(fieldInitialValue(field, vars), expected);
    const values = fieldDefaults([node], vars);
    assert.equal(values.choice, expected);
    assert.equal(fieldStateValues([node], values, vars)["choice.index"], index);
    const leaf = renderLeafNode(node, {}, { interactive: true, vars, fieldValues: values }) as any;
    assert.equal(leaf.props.value, expected);
    const unbound = renderLeafNode({ ...node, attrId: undefined }, {}, { interactive: true, vars }) as any;
    assert.equal(unbound.props.value, expected);
  });
}

test("generated select preserves the remaining options in order", async () => {
  const { html } = await publishedSelectDefault(selectDefaultDoc({ options: ["A", "C"].map(value => ({ label:value,value })) }));
  assert.match(html, /<select[^>]*id="choice"/);
  assert.match(html, /<option[^>]*value="A"[^>]*>A<\/option><option[^>]*value="C"[^>]*>C<\/option>/);
  assert.doesNotMatch(html, /<option[^>]*>B<\/option>/);
});
