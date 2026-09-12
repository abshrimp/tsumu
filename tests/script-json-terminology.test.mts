import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// 書かれた翻訳のソースを読む。テストの実行では、他のテストのために、言語のモジュールを
// 中身を減らした辞書に意図的に置き換えているため。
const locale = readFileSync("lib/locales/ja.ts", "utf8");
const definition = (key: string, translated: string) =>
  locale.includes(JSON.stringify(key) + ": " + JSON.stringify(translated));

test("JSON controls call a key an 項目 without changing the storage-key terminology", () => {
  for (const [key, text] of [
    ["Key (blank to append)", "項目（空欄なら末尾）"],
    ["Field name", "項目名"],
    ["Field name to read", "取り出す項目名"],
    ["Set {value} at key {key} of list {list}", "リスト{list}の項目{key}に{value}を入れる"],
    ["List item field", "リスト内の項目名"],
    ["Field name / {variable}", "項目名 / {変数}"],
    ["Has a key", "項目が存在する"],
    ["Key", "キー"],
  ]) assert.equal(definition(key, text), true, key);
});

test("list labels distinguish array elements from dictionary items", () => {
  assert.equal(definition("List · {length} elements", "リスト・{length}要素"), true);
  assert.equal(definition("list_length_items_variant_1\u0004List · {length} items", "リスト・{length}項目"), true);
  // 以前に保存したスクリプトの識別子は、そのまま保たれる。
  assert.equal(locale.includes("{ループ.キー}"), true);
});
