import assert from "node:assert/strict";
import { test } from "node:test";
import { langOfRequest, parseAcceptLanguage } from "../lib/lang";

test("request language excludes explicitly refused and invalid preferences", () => {
  assert.deepEqual(parseAcceptLanguage("fr, ja;q=0, en;q=0.5"), ["fr", "en"]);
  assert.equal(langOfRequest(new Request("https://example.test", { headers: { "accept-language": "fr, ja;q=0" } })), "en");
  assert.deepEqual(parseAcceptLanguage("ja;q=broken, en;q=0.5"), ["en"]);
  assert.deepEqual(parseAcceptLanguage("ja;q=-1, en;q=0.5"), ["en"]);
  assert.deepEqual(parseAcceptLanguage("ja;q=2, en;q=0.5"), ["en"]);
});

test("request language retains positive preference order and explicit cookie", () => {
  assert.deepEqual(parseAcceptLanguage("en;q=0.8, ja;q=0.8, fr;q=0.9"), ["fr", "en", "ja"]);
  assert.equal(langOfRequest(new Request("https://example.test", { headers: { "accept-language": "en-US;q=0.7, ja;q=0.8" } })), "ja");
  assert.equal(langOfRequest(new Request("https://example.test", { headers: { cookie: "tsumu-lang=ja", "accept-language": "en, ja;q=0" } })), "ja");
});
