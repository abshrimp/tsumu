import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectorNumberBundle, numberFieldBundle } from "./helpers/number-field";

test("numeric control regression fixture bundles the real component for browser tests", async () => {
  const bundle = await numberFieldBundle();
  assert.match(bundle, /setNumberFieldValue/);
  assert.match(bundle, /numberFieldWrites/);
  assert.match(bundle, /function NumField/);
});


test("numeric target regression fixture bundles the real inspector and store", async () => {
  const bundle = await inspectorNumberBundle();
  assert.match(bundle, /numericInspector/);
  assert.match(bundle, /function RightPanel/);
});
