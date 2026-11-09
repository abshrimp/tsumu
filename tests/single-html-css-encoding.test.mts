import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parse } from "parse5";
import { singleHtmlResources } from "../lib/generator/single-html-resources";
import { toSingleHtmlProject } from "../lib/generator/single-html";

const empty = { files: {}, binaries: {}, remoteAssets: {} };
const sheetUrl = new URL("https://cdn.example/main.css");
const latinCss = Buffer.from('.caf\xe9::before{content:"\x80"}', "latin1");
const expectedCss = '.café::before{content:"€"}';
const utf8Css = Buffer.from(expectedCss);
const cssResponse = (bytes: Uint8Array, type = "text/css") => new Response(bytes, { headers: { "Content-Type": type } });
const decode = async (bytes: Uint8Array, type = "text/css") => {
  const resources = singleHtmlResources(empty, async () => cssResponse(bytes, type), false);
  return resources.stylesheet(sheetUrl, new Set());
};
function cssDataUrls(text: string) {
  return [...text.matchAll(/data:text\/css(?:;charset=utf-8)?;base64,([a-z0-9+/=]+)/gi)].map(match => ({
    url: match[0], bytes: Buffer.from(match[1], "base64"),
  }));
}

for (const type of [
  "text/css; charset=windows-1252",
  'text/css; CHARSET = "ISO-8859-1"',
  'text/css; note="ignore; charset=utf-8"; charset=windows-1252',
  'text/css; charset="windows-1252"; charset=utf-8',
]) {
  test(`external CSS honors HTTP encoding: ${type}`, async () => {
    assert.equal(latinCss.toString("hex"), "2e636166e93a3a6265666f72657b636f6e74656e743a2280227d");
    assert.equal(await decode(latinCss, type), expectedCss);
  });
}

test("HTTP CSS charset takes precedence over @charset and invalid HTTP labels fall back", async () => {
  const prefix = '@charset "utf-8";';
  assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss]), "text/css; charset=windows-1252"), prefix + expectedCss);
  const legacyPrefix = '@charset "windows-1252";';
  assert.equal(await decode(Buffer.concat([Buffer.from(legacyPrefix), latinCss]), "text/css; charset=not-an-encoding"), legacyPrefix + expectedCss);
});

for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
  test(`CSS ${encoding} BOM overrides HTTP charset and @charset`, async () => {
    const text = '@charset "windows-1252";' + expectedCss;
    const bytes = encoding === "utf-8" ? Buffer.from(text) : Buffer.from(text, "utf16le");
    if (encoding === "utf-16be") bytes.swap16();
    const bom = Buffer.from(encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
    assert.equal(await decode(Buffer.concat([bom, bytes]), "text/css; charset=windows-1252"), text);
  });
}

for (const label of ["windows-1252", "ISO-8859-1", " latin1 "]) {
  test(`CSS detects a strict leading @charset ${label}`, async () => {
    const prefix = `@charset "${label}";`;
    assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss])), prefix + expectedCss);
  });
}

for (const prefix of [
  '\n@charset "windows-1252";',
  '/* comment */@charset "windows-1252";',
  '@CHARSET "windows-1252";',
  "@charset 'windows-1252';",
  '@charset  "windows-1252";',
  '@charset\t"windows-1252";',
  '@charset "windows-1252" ;',
  '@charset "windows-1252"',
  '@charset "not-an-encoding";',
  '@charset "windows-1252\x80";',
]) {
  test(`nonstandard CSS encoding declaration is not sniffed: ${JSON.stringify(prefix)}`, async () => {
    const bytes = Buffer.concat([Buffer.from(prefix), utf8Css]);
    assert.equal(await decode(bytes), prefix + expectedCss);
  });
}

test("CSS encoding sniff is bounded to the first 1024 bytes, including the semicolon", async () => {
  const prefix = '@charset "' + " ".repeat(1000) + 'windows-1252";';
  assert.equal(Buffer.byteLength(prefix), 1024);
  assert.equal(await decode(Buffer.concat([Buffer.from(prefix), latinCss])), prefix + expectedCss);
  const tooLong = '@charset "' + " ".repeat(1001) + 'windows-1252";';
  assert.equal(await decode(Buffer.concat([Buffer.from(tooLong), utf8Css])), tooLong + expectedCss);
});

for (const label of ["utf-16", "utf-16le", "utf-16be"]) {
  test(`ASCII @charset ${label} uses UTF-8`, async () => {
    const prefix = `@charset "${label}";`;
    assert.equal(await decode(Buffer.concat([Buffer.from(prefix), utf8Css])), prefix + expectedCss);
  });
}

test("CSS without an encoding defaults to UTF-8 and malformed bytes use replacement characters", async () => {
  assert.equal(await decode(utf8Css), expectedCss);
  assert.equal(await decode(latinCss), '.caf�::before{content:"�"}');
});

test("generated CSS strings stay UTF-8 when imported by a legacy stylesheet", async () => {
  const text = '@charset "windows-1252";' + expectedCss;
  const resources = singleHtmlResources({
    files: { "generated.css": text }, binaries: { "legacy.css": latinCss.toString("base64") }, remoteAssets: {},
  }, async () => cssResponse(Buffer.from('@import "https://export.invalid/generated.css";@import "https://export.invalid/legacy.css";'), "text/css; charset=windows-1252"), false);
  const [generated, legacy] = cssDataUrls(await resources.stylesheet(sheetUrl, new Set()));
  assert.equal(generated.bytes.toString("utf8"), text);
  assert.equal(legacy.bytes.toString("utf8"), expectedCss);
});

test("raw CSS binaries use their own @charset before the referring encoding", async () => {
  const prefix = '@charset "windows-1252";';
  const resources = singleHtmlResources({
    files: {}, binaries: { "legacy.css": Buffer.concat([Buffer.from(prefix), latinCss]).toString("base64") }, remoteAssets: {},
  }, async () => { throw new Error("Unexpected request"); }, false);
  assert.equal(await resources.stylesheet(new URL("https://export.invalid/legacy.css"), new Set()), prefix + expectedCss);
});

test("nested imports inherit the decoded parent encoding and remain UTF-8 data URLs", async () => {
  const seen: string[] = [];
  const resources = singleHtmlResources(empty, async url => {
    seen.push(url);
    if (url.endsWith("main.css")) return cssResponse(Buffer.from('@charset "windows-1252";@import "child.css";'));
    if (url.endsWith("/child.css")) return cssResponse(Buffer.concat([Buffer.from('@import "grandchild.css";'), latinCss]));
    if (url.endsWith("grandchild.css")) return cssResponse(latinCss, "text/css; charset=invalid");
    throw new Error("Unexpected request: " + url);
  }, false);
  const text = await resources.stylesheet(sheetUrl, new Set());
  const [child] = cssDataUrls(text);
  assert.ok(child);
  assert.match(child.url, /^data:text\/css;charset=utf-8;base64,/);
  assert.ok(child.bytes.toString("utf8").endsWith(expectedCss));
  const [grandchild] = cssDataUrls(child.bytes.toString("utf8"));
  assert.ok(grandchild);
  assert.match(grandchild.url, /^data:text\/css;charset=utf-8;base64,/);
  assert.deepEqual(grandchild.bytes, utf8Css);
  assert.deepEqual(seen, [sheetUrl.href, "https://cdn.example/child.css", "https://cdn.example/grandchild.css"]);
});

test("imported CSS can override its parent's encoding with HTTP, @charset or BOM", async () => {
  const cases = [
    { bytes: utf8Css, type: "text/css; charset=utf-8", expected: expectedCss },
    { bytes: Buffer.concat([Buffer.from('@charset "utf-8";'), utf8Css]), type: "text/css", expected: '@charset "utf-8";' + expectedCss },
    { bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8Css]), type: "text/css", expected: expectedCss },
  ];
  for (const fixture of cases) {
    const resources = singleHtmlResources(empty, async url => url.endsWith("main.css")
      ? cssResponse(Buffer.from('@import "child.css";'), "text/css; charset=windows-1252")
      : cssResponse(fixture.bytes, fixture.type), false);
    const [child] = cssDataUrls(await resources.stylesheet(sheetUrl, new Set()));
    assert.equal(child.bytes.toString("utf8"), fixture.expected);
  }
});

test("CSS text and data URL caches distinguish shared imports in different encoding environments", async () => {
  const seen: string[] = [];
  const resources = singleHtmlResources(empty, async url => {
    seen.push(url);
    if (url.endsWith("legacy.css")) return cssResponse(Buffer.from('@import "shared.css";'), "text/css; charset=windows-1252");
    if (url.endsWith("modern.css")) return cssResponse(Buffer.from('@import "shared.css";'), "text/css; charset=utf-8");
    return cssResponse(utf8Css);
  }, false);
  const legacy = await resources.stylesheet(new URL("legacy.css", sheetUrl), new Set());
  const modern = await resources.stylesheet(new URL("modern.css", sheetUrl), new Set());
  const [legacyChild] = cssDataUrls(legacy), [modernChild] = cssDataUrls(modern);
  assert.equal(legacyChild.bytes.toString("utf8"), new TextDecoder("windows-1252").decode(utf8Css));
  assert.equal(modernChild.bytes.toString("utf8"), expectedCss);
  assert.notEqual(legacyChild.url, modernChild.url);
  assert.equal(await resources.stylesheet(new URL("legacy.css", sheetUrl), new Set()), legacy);
  assert.equal(await resources.stylesheet(new URL("modern.css", sheetUrl), new Set()), modern);
  assert.equal(seen.filter(url => url.endsWith("shared.css")).length, 1);
});

test("generated HTML preserves legacy selectors, strings and non-ASCII asset URLs after integrity verification", async () => {
  const css = Buffer.from('.caf\xe9::before{content:"\x80";background:url(caf\xe9.png)}', "latin1");
  const integrity = "sha256-" + createHash("sha256").update(css).digest("base64");
  const seen: string[] = [];
  const project = await toSingleHtmlProject({ files: {
    "index.html": `<link rel="stylesheet" href="${sheetUrl}" integrity="${integrity}"><p class="café">After</p>`,
  }, binaries: {}, remoteAssets: {} }, async url => {
    seen.push(url);
    return url.endsWith("main.css") ? cssResponse(css, "text/css; charset=windows-1252")
      : new Response(Uint8Array.of(1, 2, 3), { headers: { "Content-Type": "image/png" } });
  });
  const html = project.files["index.html"];
  assert.ok(html.includes('.café::before{content:"€";background:url(data:image/png;base64,AQID)}'));
  assert.ok(html.endsWith('<p class="café">After</p>'));
  assert.doesNotMatch(html, /�|integrity=/);
  assert.deepEqual(seen, [sheetUrl.href, "https://cdn.example/caf%C3%A9.png"]);
  assert.deepEqual(project.binaries, {});
  assert.deepEqual(project.remoteAssets, {});
});

test("retained stylesheet links explicitly encode UTF-8 despite an original legacy @charset", async () => {
  const prefix = '@charset "windows-1252";';
  const sourceCss = Buffer.concat([Buffer.from(prefix), latinCss]);
  const project = await toSingleHtmlProject({ files: {
    "index.html": `<link rel="stylesheet" title="Theme" href="${sheetUrl}"><p class="café">After</p>`,
  }, binaries: {}, remoteAssets: {} }, async () => cssResponse(sourceCss));
  const html = project.files["index.html"];
  const [embedded] = cssDataUrls(html);
  assert.ok(embedded);
  assert.match(embedded.url, /^data:text\/css;charset=utf-8;base64,/);
  assert.deepEqual(embedded.bytes, Buffer.from(prefix + expectedCss));
  const doc = parse(html);
  const nodes: any[] = [];
  const visit = (node: any) => { if (node.tagName === "link") nodes.push(node); node.childNodes?.forEach(visit); };
  visit(doc);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].attrs.find((attr: any) => attr.name === "href").value, embedded.url);
});
