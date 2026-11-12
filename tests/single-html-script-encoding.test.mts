import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { parse } from "parse5";
import { singleHtmlResources, EXPORT_BASE } from "../lib/generator/single-html-resources";
import { toSingleHtmlProject } from "../lib/generator/single-html";

const empty = { files: {}, binaries: {}, remoteAssets: {} };
const scriptUrl = "https://cdn.example/legacy.js";
const latinScript = Buffer.from('globalThis.answer = "caf\xe9 \x80";', "latin1");
const expected = "café €";
const response = (bytes: Uint8Array, type: string) => new Response(bytes, { headers: { "Content-Type": type } });
const noRequest = async () => { throw new Error("Unexpected network request"); };

function scriptAttributes(html: string): Record<string, string> {
  const scripts: any[] = [];
  const visit = (node: any) => { if (node.tagName === "script") scripts.push(node); node.childNodes?.forEach(visit); };
  visit(parse(html));
  assert.equal(scripts.length, 1);
  return Object.fromEntries(scripts[0].attrs.map((attr: any) => [attr.name, attr.value]));
}

async function embedded(bytes: Uint8Array, type: string, attributes = "") {
  const result = await toSingleHtmlProject({ ...empty, files: {
    "index.html": `<meta charset="utf-8"><script src="${scriptUrl}" ${attributes}></script>`,
  } }, async () => response(bytes, type));
  const attrs = scriptAttributes(result.files["index.html"]);
  const fetched = await fetch(attrs.src);
  return { attrs, bytes: new Uint8Array(await fetched.arrayBuffer()), type: fetched.headers.get("content-type")! };
}

// HTML の classic script のデコードの順序: BOM → 応答の charset → 要素や文書の文字コード。
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-script
function execute(bytes: Uint8Array, contentType: string, fallback = "utf-8"): unknown {
  let decoder = new TextDecoder(fallback);
  const charset = /;charset=([^;]+)/i.exec(contentType)?.[1];
  if (charset) { try { decoder = new TextDecoder(charset); } catch { /* 無効なラベルはフォールバックを使う。 */ } }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) decoder = new TextDecoder();
  if (bytes[0] === 0xff && bytes[1] === 0xfe) decoder = new TextDecoder("utf-16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) decoder = new TextDecoder("utf-16be");
  const context: { answer?: unknown } = {};
  runInNewContext(decoder.decode(bytes), context);
  return context.answer;
}

for (const [type, label] of [
  ["text/javascript; charset=windows-1252", "windows-1252"],
  ['application/javascript; CHARSET = "ISO-8859-1"', "ISO-8859-1"],
  ['text/javascript; note="ignore; charset=utf-8"; charset=windows-1252', "windows-1252"],
  ['text/javascript; charset=" windows-1252 "; charset=utf-8', "windows-1252"],
  ['text/javascript; charset="windows\\-1252"', "windows-1252"],
]) {
  test(`classic scripts preserve HTTP charset and executable strings: ${type}`, async () => {
    const result = await embedded(latinScript, type, 'charset="utf-8" defer async');
    assert.ok(result.attrs.src.includes(`;charset=${label};base64,`));
    assert.deepEqual(result.bytes, new Uint8Array(latinScript));
    assert.equal(execute(result.bytes, result.type), expected);
    assert.equal(execute(result.bytes, "text/javascript"), "caf� �");
    assert.equal(result.attrs.charset, "utf-8");
    assert.ok(Object.hasOwn(result.attrs, "defer"));
    assert.ok(Object.hasOwn(result.attrs, "async"));
  });
}

test("classic scripts preserve Shift_JIS source text", async () => {
  const bytes = Buffer.concat([Buffer.from('globalThis.answer = "'), Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]), Buffer.from('";')]);
  const result = await embedded(bytes, "text/javascript; charset=Shift_JIS");
  assert.equal(execute(result.bytes, result.type), "日本語");
});

for (const type of ["text/javascript", "text/javascript; charset=unknown-encoding"]) {
  test(`missing or invalid HTTP charset retains the script element fallback: ${type}`, async () => {
    const result = await embedded(latinScript, type, 'charset="windows-1252"');
    assert.equal(result.attrs.charset, "windows-1252");
    assert.equal(execute(result.bytes, result.type, result.attrs.charset), expected);
  });
}

for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
  test(`classic ${encoding} BOM still overrides the retained HTTP charset`, async () => {
    const source = `globalThis.answer = "${expected}";`;
    const bytes = encoding === "utf-8" ? Buffer.from(source) : Buffer.from(source, "utf16le");
    if (encoding === "utf-16be") bytes.swap16();
    const bom = Buffer.from(encoding === "utf-8" ? [0xef, 0xbb, 0xbf] : encoding === "utf-16le" ? [0xff, 0xfe] : [0xfe, 0xff]);
    const original = Buffer.concat([bom, bytes]);
    const result = await embedded(original, "text/javascript; charset=windows-1252");
    assert.deepEqual(result.bytes, new Uint8Array(original));
    assert.equal(execute(result.bytes, result.type), expected);
  });
}

test("retaining classic script encoding preserves SRI over the original bytes", async () => {
  const integrity = "sha256-" + createHash("sha256").update(latinScript).digest("base64");
  const result = await embedded(latinScript, "text/javascript; charset=windows-1252", `integrity="${integrity}" crossorigin="anonymous"`);
  assert.equal(result.attrs.integrity, integrity);
  assert.equal(result.attrs.crossorigin, "anonymous");
  assert.equal("sha256-" + createHash("sha256").update(result.bytes).digest("base64"), integrity);
  await assert.rejects(embedded(Buffer.from("different source"), "text/javascript; charset=windows-1252", `integrity="${integrity}"`), /integrity/i);
});

test("script and ordinary asset caches do not discard the script charset in either access order", async () => {
  for (const firstScript of [false, true]) {
    let requests = 0;
    const resources = singleHtmlResources(empty, async () => { requests++; return response(latinScript, "text/javascript; charset=windows-1252"); }, false);
    const first = await resources.embed(scriptUrl + "#first", EXPORT_BASE, "", firstScript);
    const second = await resources.embed(scriptUrl + "#second", EXPORT_BASE, "", !firstScript);
    const script = firstScript ? first : second;
    const asset = firstScript ? second : first;
    assert.match(script, /^data:text\/javascript;charset=windows-1252;base64,/);
    assert.match(asset, /^data:text\/javascript;base64,/);
    assert.ok(first.endsWith("#first"));
    assert.ok(second.endsWith("#second"));
    assert.equal(await resources.embed(scriptUrl + "#first", EXPORT_BASE, "", firstScript), first);
    assert.equal(requests, 1);
  }
});

test("generated script strings declare UTF-8 while raw binaries retain the element fallback", async () => {
  const text = `globalThis.answer = "${expected}";`;
  const resources = singleHtmlResources({ files: { "generated.js": text }, binaries: { "raw.js": latinScript.toString("base64") }, remoteAssets: {} }, noRequest, false);
  const generated = await resources.embed("generated.js", EXPORT_BASE, "", true);
  assert.match(generated, /^data:text\/javascript;charset=utf-8;base64,/);
  const generatedResponse = await fetch(generated);
  assert.equal(execute(new Uint8Array(await generatedResponse.arrayBuffer()), generatedResponse.headers.get("content-type")!, "windows-1252"), expected);
  const raw = await resources.embed("raw.js", EXPORT_BASE, "", true);
  assert.match(raw, /^data:text\/javascript;base64,/);
  const rawResponse = await fetch(raw);
  assert.equal(execute(new Uint8Array(await rawResponse.arrayBuffer()), rawResponse.headers.get("content-type")!, "windows-1252"), expected);
});

test("unusable charset values cannot inject data URL parameters or markup", async () => {
  for (const charset of ['utf-8;base64,alert(1)', 'utf-8\"><script>', 'utf 8', 'utf-8\u0001', '']) {
    const result = await embedded(Buffer.from('globalThis.answer = 42;'), `text/javascript; charset="${charset.replaceAll('"', '\\"')}"`);
    assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
    assert.equal(execute(result.bytes, result.type), 42);
  }
});

test("non-ASCII whitespace does not turn an invalid HTTP label into a valid encoding", async () => {
  for (const charset of ['"\u00a0utf-8\u00a0"', '\u00a0utf-8\u00a0']) {
    const result = await embedded(latinScript, 'text/javascript; charset=' + charset, 'charset="windows-1252"');
    assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
    assert.equal(execute(result.bytes, result.type, result.attrs.charset), expected);
  }
});

test("legacy labels that TextDecoder can reject remain available to the browser", async () => {
  const result = await embedded(latinScript, "text/javascript; charset=iso-2022-cn");
  assert.match(result.attrs.src, /^data:text\/javascript;charset=iso-2022-cn;base64,/);
  assert.deepEqual(result.bytes, new Uint8Array(latinScript));
});

test("module scripts continue to use UTF-8 regardless of an HTTP charset", async () => {
  const source = `globalThis.answer = "${expected}";`;
  const result = await embedded(Buffer.from(source), "text/javascript; charset=windows-1252", 'type="module"');
  assert.equal(result.attrs.type, "module");
  assert.match(result.attrs.src, /^data:text\/javascript;base64,/);
  assert.equal(new TextDecoder().decode(result.bytes), source);
});
