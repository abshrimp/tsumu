import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCALES } from "../lib/locales";

test("Japanese help search terms retain their contextual translations", async () => {
  const ja = await LOCALES.ja!();
  for (const [label, expected, term] of [
    ["Link", "リンク", "link"],
    ["Fetch data", "データ取得", "fetch data"],
    ["Paragraph", "文章", "text"],
  ]) {
    assert.equal(ja[label], expected);
    assert.equal(ja["help_search\u0004" + term], expected);
  }
});
