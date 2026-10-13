import assert from "node:assert/strict";
import { test } from "node:test";
import { GOOGLE_FONT_CATALOG, GOOGLE_FONT_CATEGORIES, SUGGESTED_GOOGLE_FONTS, searchGoogleFonts } from "../lib/google-font-catalog";

test("Google Fonts search covers diverse families without an API key", () => {
  assert.ok(GOOGLE_FONT_CATALOG.length > 1500);
  assert.deepEqual(searchGoogleFonts("Noto Sans JP").slice(0, 1), ["Noto Sans JP"]);
  assert.ok(searchGoogleFonts("potta", "japanese").includes("Potta One"));
  assert.ok(searchGoogleFonts("INTER")[0] === "Inter");
  assert.ok(searchGoogleFonts("", "japanese", 10).length <= 10);
  assert.ok(searchGoogleFonts("", "handwriting").length > 0);
});

test("font discovery prioritizes exact matches and category constraints", () => {
  const found = searchGoogleFonts("Roboto");
  assert.equal(found[0], "Roboto");
  assert.ok(found.length > 1);
  assert.ok(searchGoogleFonts("Roboto", "serif").every(name => /Roboto/.test(name)));
  assert.deepEqual(searchGoogleFonts("font_that_cannot_exist"), []);
  assert.deepEqual(searchGoogleFonts("", "all", 0), []);
});

test("unfiltered suggestions contain only the curated families, not alphabetical catalog filler", () => {
  const suggestions = searchGoogleFonts("");
  assert.deepEqual(suggestions, [...SUGGESTED_GOOGLE_FONTS]);
  assert.equal(suggestions.length, SUGGESTED_GOOGLE_FONTS.length);
  assert.equal(new Set(suggestions).size, suggestions.length);
  assert.deepEqual(searchGoogleFonts("", "all", 5), SUGGESTED_GOOGLE_FONTS.slice(0, 5));
  assert.ok(!suggestions.includes("ABeeZee"), "A-Z catalog entries must not appear as suggestions");
});

test("category suggestions only filter the curated list while actual searches use the full catalog", () => {
  for (const category of ["japanese", ...GOOGLE_FONT_CATEGORIES] as const) {
    const suggestions = searchGoogleFonts("", category);
    assert.ok(suggestions.length > 0, category + " should have useful suggestions");
    assert.ok(suggestions.every(name => SUGGESTED_GOOGLE_FONTS.includes(name as typeof SUGGESTED_GOOGLE_FONTS[number])));
    assert.deepEqual(searchGoogleFonts("", category, 2), suggestions.slice(0, 2));
  }
  assert.equal(searchGoogleFonts("ABeeZee")[0], "ABeeZee");
});
