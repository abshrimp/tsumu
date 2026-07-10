import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldDefaults, fieldStateValues, fieldValuePatch } from "../lib/fields";
import { previewDynamicRadioDoc, publishedDynamicRadio } from "./helpers/preview-dynamic-radio";

for (const source of ["query", "data"] as const) {
  test(`preview radio item scripts use resolved ${source} labels for selection and clearing`, () => {
    const fields = Object.values(previewDynamicRadioDoc(source).nodes).filter((node) => node.type === "field");
    for (const labels of [{ smallLabel: "S", mediumLabel: "M" }, { smallLabel: "Small & new", mediumLabel: "Medium" }]) {
      const vars = source === "query" ? labels : { response: labels };
      let values = fieldDefaults(fields, vars);
      assert.deepEqual(values, { size: labels.mediumLabel });
      const set = (id: string, value: string) => {
        const patch = fieldValuePatch(fields, id, value, values, vars);
        assert.notEqual(patch, null);
        values = { ...values, ...patch };
        return fieldStateValues(fields, values, vars);
      };
      assert.equal(set("medium", "false").medium, "false", "clear the resolved initial selection");
      assert.deepEqual(values, { size: "" });
      assert.equal(set("small", "true").small, "true");
      assert.deepEqual(values, { size: labels.smallLabel });
      assert.equal(set("medium", "false").small, "true", "clearing a different item preserves selection");
      assert.equal(set("small", "off").small, "false");
      assert.deepEqual(values, { size: "" });
      assert.equal(set("size", labels.mediumLabel).medium, "true", "group assignments keep working");
      assert.equal(set("size", "")["size.index"], "");
      assert.equal(set("large", "yes").large, "true", "literal labels keep working");
      assert.equal(values.size, "L");
      assert.equal(set("large", "0").large, "false");
      assert.equal(values.size, "");
    }
  });

  test(`the actual exported page resolves ${source} radio labels identically`, async () => {
    const { html } = await publishedDynamicRadio(source);
    assert.match(html, /type="radio" name="size" value="S"/);
    assert.match(html, /type="radio" name="size" checked="" value="M"|type="radio" name="size" value="M" checked=""/);
    assert.doesNotMatch(html, /value="\{(?:response\.)?(?:small|medium)Label\}"/);
  });
}
