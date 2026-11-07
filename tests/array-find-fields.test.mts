import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { previewDataVars } from "../lib/data";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { itemFieldsOf } from "../components/script-editor/arrays";
import { arrayFindFieldsDoc, literalFieldItems } from "./helpers/array-find-fields";
import { publishedComponentList } from "./helpers/component-list-export";
import { listRuntimeDom } from "./helpers/list-runtime-dom";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const cases = [
  { name: "literal dotted name wins over nested value", items: literalFieldItems, field: "meta.name", key: "A & B", expected: "Literal" },
  { name: "encoded key retains literal priority", items: literalFieldItems, field: "meta.name", key: "A%20%26%20B", expected: "Literal" },
  { name: "nested field still works when no literal key exists", items: literalFieldItems.slice(1), field: "meta.name", key: "A & B", expected: "Nested" },
  { name: "literal null must not fall through to nested value", items: [{ name: "Wrong", "meta.name": null, meta: { name: "A" } }, { name: "Right", meta: { name: "A" } }], field: "meta.name", key: "A", expected: "Right" },
  { name: "literal false and zero are not missing", items: [{ name: "Zero", "meta.name": 0 }, { name: "False", "meta.name": false }], field: "meta.name", key: "false", expected: "False" },
  { name: "nested negative array index still works", items: [{ name: "Last", tags: ["first", "last"] }], field: "tags.-1", key: "last", expected: "Last" },
  { name: "no match remains null", items: literalFieldItems, field: "meta.name", key: "absent", expected: "" },
];
for (const c of cases) {
  test(`saved preview and generated server: ${c.name}`, async () => {
    const doc = arrayFindFieldsDoc(c.items, c.field, c.key);
    const saved = JSON.stringify(doc);
    assert.equal((previewDataVars(doc, "p").chosen as any)?.name ?? "", c.expected);
    const html = await publishedComponentList(doc, "app/page.tsx", c.items);
    assert.equal(parse(html).querySelector("#result").textContent, c.expected);
    assert.equal(JSON.stringify(doc), saved);
  });
  for (const preview of [true, false]) test(`${preview ? "preview" : "exported"} browser runtime: ${c.name}`, async () => {
    const doc = arrayFindFieldsDoc(c.items, c.field, c.key, true);
    const html = await publishedComponentList(doc, "app/page.tsx", c.items);
    const runtime = listRuntimeDom(html, preview ? `(${SCRIPT_RUNTIME})(env).install(document)` : scriptsFile(doc));
    await runtime.click("act");
    assert.equal(runtime.active("#result")[0].textContent, c.expected);
    await runtime.click("act");
    assert.equal(runtime.active("#result")[0].textContent, c.expected);
    runtime.dispose();
  });
}
test("actual field selector offers the literal dotted field from the saved sample", () => {
  assert.ok(itemFieldsOf(literalFieldItems).includes("meta.name"));
});


test("real editor fixture bundles without changing saved field paths", async () => {
  const { clientScriptBundle } = await import("./helpers/client-script-scope");
  const doc = arrayFindFieldsDoc(literalFieldItems, "name", "Literal");
  const saved = JSON.stringify(doc);
  assert.match(await clientScriptBundle(doc), /function ScriptEditorInner/);
  assert.equal(JSON.stringify(doc), saved);
});
