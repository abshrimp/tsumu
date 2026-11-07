import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPreviewScope } from "../components/script-editor/fetch";
import { itemFieldsOf } from "../components/script-editor/arrays";
import { previewDataVars, toListItems, varGroupsAt } from "../lib/data";
import { variableChoiceSamples } from "../lib/variable-choice";
import { lookupVar } from "../lib/vars";
import { fetchScopeDoc } from "./helpers/fetch-refetch";
import { fetchPreviewInputs } from "../lib/fetch-preview";

test("test requests resolve known nested values but require unknown, null and complex URL values", () => {
  const inputs = fetchPreviewInputs("https://example.test/[slug]/{data.name}/{data.items}/{empty}/{nil}/{flag}/{zero}", {}, {
    data: { name: "001", items: [1] }, empty: "", nil: null, flag: false, zero: 0,
  });
  assert.deepEqual(inputs.map(({ name, missing }) => [name, missing]), [
    ["slug", true], ["data.name", false], ["data.items", true], ["empty", false], ["nil", true], ["flag", false], ["zero", false],
  ]);
  assert.equal(inputs[1].value, "001", "samples do not declare or coerce a type");
});

test("only active headers and bodies need values, with raw body objects and null preserved", () => {
  const options = { method: "POST" as const, headers: [{ name: "X-Key", value: "{token}" }, { name: "", value: "{unused}" }], body: '{"data":{object},"nil":{nil},"other":{unknown}}' };
  const vars = { token: "", object: { x: 1 }, nil: null };
  assert.deepEqual(fetchPreviewInputs("https://example.test", options, vars).map(({ name, missing }) => [name, missing]), [
    ["token", false], ["object", false], ["nil", false], ["unknown", true],
  ]);
  assert.deepEqual(fetchPreviewInputs("https://example.test/\\{literal}", { ...options, method: "DELETE" }, vars).map((v) => v.name), ["token"]);
});

test("temporary explicit empty and dotted overrides are accepted without changing the samples", () => {
  const samples = { data: { value: undefined } };
  assert.equal(fetchPreviewInputs("https://example.test/{data.value}", {}, samples)[0].missing, true);
  assert.equal(fetchPreviewInputs("https://example.test/{data.value}", {}, { ...samples, "data.value": "" })[0].missing, false);
  assert.equal(samples.data.value, undefined);
});


test("real list-node scope keeps nested row values instead of page values and dotted aliases", () => {
  const doc = fetchScopeDoc("node");
  const groups = varGroupsAt(doc, "p", "act");
  assert.equal(groups[0].key, "item");
  const vars = variableChoiceSamples(groups);
  assert.equal(lookupVar(vars, "details.id"), "ROW-ID");
  assert.deepEqual(lookupVar(vars, "details"), { id: "ROW-ID" });
  assert.equal(Object.hasOwn(vars, "details.id"), false, "lower-scope dotted aliases cannot bypass the local root");
});

test("real loop leaf discovery also shadows object/array roots and empty containers", () => {
  const doc = fetchScopeDoc("loop");
  const sample = previewDataVars(doc, "p").rows;
  const fields = itemFieldsOf(sample);
  const roots = Object.keys(toListItems(sample)[0]);
  assert.ok(fields.includes("details.id"));
  assert.ok(!fields.includes("details"));
  assert.ok(!fields.includes("empty"));
  const scope = fetchPreviewScope("", [{ fields, roots }]);
  const vars = variableChoiceSamples(varGroupsAt(doc, "p", scope.nodeId), scope.localNames);
  for (const name of ["details", "details.id", "empty", "tags"]) assert.equal(lookupVar(vars, name), undefined, name);
  const inputs = fetchPreviewInputs("https://example.test/{details.id}/{empty}/{tags}", { method: "POST", body: '{"raw":{details}}' }, vars);
  assert.equal(inputs.length, 4); assert.ok(inputs.every((input) => input.missing));
});
