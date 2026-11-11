import assert from "node:assert/strict";
import { test } from "node:test";
import ja from "../lib/locales/ja";

test("JSON list UI uses 項目 rather than キー for item names", () => {
  assert.equal(ja["Key (blank to append)"], "項目（空欄なら末尾）");
  assert.equal(ja["Field name"], "項目");
  assert.equal(ja["Field name to read"], "取り出す項目");
  assert.equal(ja["Set {value} at key {key} of list {list}"], "リスト{list}の項目{key}に{value}を入れる");
  assert.equal(ja["Has a key"], "項目が存在する");
});

test("array counts are 要素 and dictionary counts are 項目 under the same list type", () => {
  assert.equal(ja["List · {length} elements"], "リスト・{length}要素");
  assert.equal(ja["list_length_items_variant_1\u0004List · {length} items"], "リスト・{length}項目");
  assert.equal(ja["Break out of loop"], "ループを終了する");
  // Persisted {ループ.キー} and storage identifiers are not renamed.
  assert.match(ja["Within the loop you can use {ループ.値}, {ループ.キー}, and {ループ.順番}"] ?? "", /\{ループ\.キー\}/);
  assert.equal(ja["Key"], "キー");
});
