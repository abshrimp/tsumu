import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPORT_FRAMEWORK_OPTIONS } from "../lib/export-formats";
import { LOCALES } from "../lib/locales";

// The labels are translated at render time with tr(option.label), which
// i18n:check can't see. Japanese labels must still have an English entry.
test("every non-ASCII export format label has an English translation", async () => {
  const en = await LOCALES.en!();
  for (const option of EXPORT_FRAMEWORK_OPTIONS) {
    if (/^[\x20-\x7e]+$/.test(option.label)) continue;
    assert.ok(Object.prototype.hasOwnProperty.call(en, option.label),
      `missing English translation for export format label "${option.label}"`);
  }
});
