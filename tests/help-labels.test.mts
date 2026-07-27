import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCALES } from "../lib/locales";

test("English help keywords do not replace labels used by the editor", async () => {
  const en = await LOCALES.en!();
  for (const [key, label, keyword] of [
    ["リンク", "Link", "link"], ["データ取得", "Fetch data", "fetch data"], ["文章", "Paragraph", "text"],
  ]) {
    assert.equal(en[key], label);
    assert.equal(en["ヘルプ検索\u0004" + key], keyword);
  }
});
