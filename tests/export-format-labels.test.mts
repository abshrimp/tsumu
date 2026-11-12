import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPORT_FRAMEWORK_OPTIONS } from "../lib/export-formats";
import { LOCALES } from "../lib/locales";

// 動的な形式の表示名は、静的な i18n の点検では見えない。
test("all export format labels are English source text with Japanese translations", async () => {
  const ja = await LOCALES.ja!();
  for (const { label } of EXPORT_FRAMEWORK_OPTIONS) {
    assert.doesNotMatch(label, /[぀-ヿ㐀-鿿]/, label);
  }
  assert.equal(ja["Single HTML"], "単一のHTML");
});
