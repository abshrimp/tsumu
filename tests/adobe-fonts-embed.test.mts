import assert from "node:assert/strict";
import { test } from "node:test";
import { adobeCssFamily, parseAdobeEmbed, parseAdobeKitInput } from "../lib/adobe-fonts-embed";

const adobeJapaneseSnippet = `<script>
  (function(d) {
    var config = { kitId: 'tudlnus', scriptTimeout: 3000, async: true },
      h = d.documentElement, t = setTimeout(function() {}, config.scriptTimeout),
      tk = d.createElement("script");
    tk.src = 'https://use.typekit.net/' + config.kitId + '.js';
    d.head.appendChild(tk);
  })(document);
</script>`;

test("extracts Adobe's standard Japanese dynamic-subsetting snippet without executing it", () => {
  assert.deepEqual(parseAdobeEmbed(adobeJapaneseSnippet), { kitId: "tudlnus", loading: "dynamic" });
  assert.deepEqual(parseAdobeEmbed(adobeJapaneseSnippet.replace("tudlnus", "abc1234")),
    { kitId: "abc1234", loading: "dynamic" });
  assert.deepEqual(parseAdobeEmbed(`<script src="https://use.typekit.net/abc1234.js"></script>`),
    { kitId: "abc1234", loading: "dynamic" });
});

test("extracts stylesheet embeds, including @import", () => {
  assert.deepEqual(parseAdobeEmbed('<link rel="stylesheet" href="https://use.typekit.net/abc1234.css">'),
    { kitId: "abc1234", loading: "css" });
  assert.deepEqual(parseAdobeEmbed('@import url("https://use.typekit.net/abc1234.css");'),
    { kitId: "abc1234", loading: "css" });
});

test("rejects unrelated hosts, ambiguous kits, and unsafe or malformed identifiers", () => {
  for (const text of [
    "",
    "kitId: 'abc1234'",
    "<script>var config = { kitId: 'abc1234' }; alert(1);</script>",
    '<script src="https://attacker.test/use.typekit.net/abc1234.js"></script>',
    '<script src="http://use.typekit.net/abc1234.js"></script>',
    '<script src="https://use.typekit.net/abc1234.js.evil"></script>',
    '<script src="https://use.typekit.net/abc12345.js"></script>',
    '<script src="https://use.typekit.net/abc1234.js"></script><link href="https://use.typekit.net/xyz5678.css">',
    '<script src="https://use.typekit.net/abc1234.js"></script><link href="https://use.typekit.net/abc1234.css">',
    adobeJapaneseSnippet.replace("kitId:", "otherId:"),
    adobeJapaneseSnippet.replace("use.typekit.net", "evil.test"),
    "x".repeat(30_001),
  ]) {
    assert.equal(parseAdobeEmbed(text), null, text.slice(0, 160));
  }
});

test("accepts a standalone family name or copied CSS declaration without changing the saved schema", () => {
  assert.equal(adobeCssFamily("poprumcute"), "poprumcute");
  assert.equal(adobeCssFamily('font-family: "poprumcute", sans-serif;'), "poprumcute");
  assert.equal(adobeCssFamily("font-family: 'source-han-sans-japanese'; font-weight: 400;"),
    "source-han-sans-japanese");
  assert.equal(adobeCssFamily("<style>h1 { font-family: acumin-pro, sans-serif; }</style>"), "acumin-pro");
  assert.equal(adobeCssFamily(`<link href="https://use.typekit.net/abc1234.css"><style>h1{font-family:"poprumcute"}</style>`), "poprumcute");
  for (const bad of ["", 'font-family: "Evil"; font-family: "Other";', 'font-family: "bad};body{color:red"',
    'font-family: "foo"; color: red; font-family: "bar";', 'font-family: "not closed', "font-family: ;"]) {
    assert.equal(adobeCssFamily(bad), null, bad);
  }
});

test("pasted scripts are never evaluated", () => {
  const key = "__tsumuAdobeEmbedProbe";
  delete (globalThis as Record<string, unknown>)[key];
  const snippet = `<script>globalThis.${key}=true;var kitId='abc1234';</script>`;
  assert.equal(parseAdobeEmbed(snippet), null);
  assert.equal((globalThis as Record<string, unknown>)[key], undefined);
});

test("Web Project ID or URL is enough; embedding the whole snippet is optional", () => {
  assert.deepEqual(parseAdobeKitInput(" abc1234 "), { kitId: "abc1234", loading: "css" });
  assert.deepEqual(parseAdobeKitInput("https://use.typekit.net/abc1234.css"),
    { kitId: "abc1234", loading: "css" });
  assert.deepEqual(parseAdobeKitInput("https://use.typekit.net/abc1234.js"),
    { kitId: "abc1234", loading: "dynamic" });
  assert.deepEqual(parseAdobeKitInput('<script src="https://use.typekit.net/abc1234.js"></script>'),
    { kitId: "abc1234", loading: "dynamic" });
  for (const bad of ["", "abc123", "abc12345", "https://evil.test/abc1234.js",
    "https://use.typekit.net/abc1234.js.evil", "abc1234;alert(1)", "../abc1234"]) {
    assert.equal(parseAdobeKitInput(bad), null, bad);
  }
});
