import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPORT_FRAMEWORK_OPTIONS } from "../lib/export-formats";
import { LOCALES } from "../lib/locales";

// Dynamic format labels are not visible to the static i18n checker.
test("all export format labels are English source text with Japanese translations", async () => {
  const ja = await LOCALES.ja!();
  for (const { label } of EXPORT_FRAMEWORK_OPTIONS) {
    assert.doesNotMatch(label, /[぀-ヿ㐀-鿿]/, label);
  }
  assert.equal(ja["Single HTML"], "単一のHTML");
});
