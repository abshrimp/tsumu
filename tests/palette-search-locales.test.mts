import assert from "node:assert/strict";
import { test } from "node:test";
import { findPaletteItems, PALETTE } from "../components/script-editor/palette";
import { searchTermsFor } from "../lib/locales/search-terms";

test("palette search aliases are separate per language", () => {
  assert.ok(searchTermsFor("ja").click.includes("タップ"));
  assert.ok(searchTermsFor("ja").click.includes("tap"));
  assert.ok(searchTermsFor("ja").dialog.includes("warning"));
  assert.ok(searchTermsFor("en").click.includes("tap"));
  assert.ok(Array.from(Object.values(searchTermsFor("en")).join(" ")).every(char => char.codePointAt(0)! <= 127));
  assert.deepEqual(Object.keys(searchTermsFor("ja")).sort(), Object.keys(searchTermsFor("en")).sort());
});

test("Japanese aliases still find the same palette actions", () => {
  for (const [word, key] of [
    ["タップ", "click"], ["数値演算", "transform"], ["値で削除", "remove-list-item"],
    ["クリップボード", "copy"], ["条件分岐", "if"], ["警告", "dialog"],
    ["tap", "click"], ["REST", "fetch"], ["math", "transform"], ["warning", "dialog"],
  ] as const) {
    assert.ok(findPaletteItems(word, "ja").some(item => item.key === key), word);
  }
});

test("English searches use English aliases without Japanese-only matches", () => {
  for (const [word, key] of [
    ["tap", "click"], ["REST", "fetch"], ["disable", "set-enabled"],
    ["math", "transform"], ["clipboard", "copy"], ["forever", "repeat"], ["warning", "dialog"],
  ] as const) {
    assert.ok(findPaletteItems(word, "en").some(item => item.key === key), word);
  }
  assert.ok(!findPaletteItems("タップ", "en").some(item => item.key === "click"));
  assert.ok(!findPaletteItems("数値演算", "en").some(item => item.key === "transform"));
  assert.equal(findPaletteItems("", "en").length, PALETTE.length);
});
