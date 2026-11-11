import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Read the authored translation source: the test runner intentionally replaces
// locale modules with stripped dictionaries for its other test suites.
const locale = readFileSync("lib/locales/ja.ts", "utf8");
const definition = (key: string, translated: string) =>
  locale.includes(JSON.stringify(key) + ": " + JSON.stringify(translated));

test("JSON controls call a key an 項目 without changing the storage-key terminology", () => {
  for (const [key, text] of [
    ["Key (blank to append)", "項目（空欄なら末尾）"],
    ["Field name", "項目"],
    ["Field name to read", "取り出す項目"],
    ["Set {value} at key {key} of list {list}", "リスト{list}の項目{key}に{value}を入れる"],
    ["Has a key", "項目が存在する"],
    ["Key", "キー"],
  ]) assert.equal(definition(key, text), true, key);
});

test("list labels distinguish array elements from dictionary items", () => {
  assert.equal(definition("List · {length} elements", "リスト・{length}要素"), true);
  assert.equal(definition("list_length_items_variant_1\u0004List · {length} items", "リスト・{length}項目"), true);
  // Identifiers in previously saved scripts are preserved.
  assert.equal(locale.includes("{ループ.キー}"), true);
});
