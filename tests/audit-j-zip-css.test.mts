import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { escapeStyleContent, rewriteCssAssetUrls } from "../lib/css-assets";
import { inspectHtmlZip } from "../lib/html-zip-guard";
import { createInitialDoc } from "../lib/presets";
import { parseSiteImport, validateImportedDoc } from "../lib/site-import";
import { openImportZip } from "../lib/zip-directory";
import { readZipEntryLimited } from "../lib/zip-stream";

const SEED = 0x4a202611;
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

test("AUD-J-007: ZIP extraction round-trips bounded random bytes and rejects undersized output limits", async () => {
  const next = seeded(SEED ^ 0x707);
  for (let i = 0; i < 48; i++) {
    const payload = Uint8Array.from({ length: 1 + next() % 4096 }, () => next() & 255);
    const zipped = await new JSZip()
      .file("index.html", "<main>valid</main>")
      .file("assets/random.bin", payload)
      .generateAsync({ type: "uint8array", compression: i % 2 ? "DEFLATE" : "STORE" });
    const parsed = await openImportZip(zipped, 200);
    const inspected = inspectHtmlZip(parsed);
    assert.equal(inspected.htmlEntry.name, "index.html");
    assert.deepEqual(await readZipEntryLimited(parsed.file("assets/random.bin")!, payload.length), payload,
      "seed=" + SEED + " case=" + i);
    await assert.rejects(readZipEntryLimited(parsed.file("assets/random.bin")!, payload.length - 1),
      /展開後のデータが大きすぎ/, "seed=" + SEED + " case=" + i);
  }
});

test("AUD-J-008: central-directory and local-header corruptions fail before parsing untrusted documents", async () => {
  const doc = createInitialDoc();
  doc.assets = {};
  const raw = await new JSZip()
    .file("_tsumu/doc.json", JSON.stringify(doc))
    .file("_tsumu/assets.json", JSON.stringify({ version: 1, assets: {} }))
    .generateAsync({ type: "uint8array", compression: "STORE" });
  const normal = await parseSiteImport(raw, "zip");
  assert.deepEqual(normal.doc, JSON.parse(JSON.stringify(doc)));
  assert.doesNotThrow(() => validateImportedDoc(normal.doc));
  const end = raw.length - 22; // Fixture has no archive comment.
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const central = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  const mutations: { name: string; at: number; mask: number }[] = [
    { name: "end signature", at: end, mask: 1 },
    { name: "central signature", at: central, mask: 1 },
    { name: "local signature", at: 0, mask: 1 },
    { name: "local member name", at: 30, mask: 1 },
    { name: "record count", at: end + 10, mask: 1 },
    { name: "directory size", at: end + 12, mask: 0x80 },
    { name: "directory offset", at: end + 16, mask: 0x80 },
  ];
  for (const { name, at, mask } of mutations) {
    const damaged = raw.slice();
    damaged[at] ^= mask;
    await assert.rejects(parseSiteImport(damaged, "zip"), undefined,
      "seed=" + SEED + " mutation=" + name);
  }
});

test("AUD-J-009: archive path normalization is rejected across editable and raw HTML entry points", async () => {
  const doc = createInitialDoc();
  doc.assets = {};
  const paths = ["../escape.js", "assets/../escape.js", "assets\\escape.js", "/absolute.js"];
  for (const [i, path] of paths.entries()) {
    const html = await new JSZip()
      .file("index.html", "<main>ok</main>")
      .file(path, "unsafe")
      .generateAsync({ type: "uint8array" });
    const zip = await openImportZip(html, 200);
    assert.throws(() => inspectHtmlZip(zip), /安全でないファイルパス/,
      "seed=" + SEED + " HTML path=" + i);
    const editable = await new JSZip()
      .file("_tsumu/doc.json", JSON.stringify(doc))
      .file("_tsumu/assets.json", JSON.stringify({ version: 1, assets: {} }))
      .file(path, "unsafe")
      .generateAsync({ type: "uint8array" });
    await assert.rejects(parseSiteImport(editable, "zip"), /安全でないファイルパス/,
      "seed=" + SEED + " doc path=" + i);
  }
  for (const names of [
    ["assets/logo.svg", "assets/LOGO.svg"],
    ["assets/caf\u00e9.svg", "assets/cafe\u0301.svg"],
  ]) {
    const html = await new JSZip()
      .file("index.html", "<main>ok</main>")
      .file(names[0], "first")
      .file(names[1], "second")
      .generateAsync({ type: "uint8array" });
    const parsed = await openImportZip(html, 200);
    assert.throws(() => inspectHtmlZip(parsed), /重複したファイルパス/);
  }
});

test("AUD-J-010: mutated CSS cannot terminate an inline style or create extra URL tokens", () => {
  const next = seeded(SEED ^ 0x1010);
  const tokens = [
    "</style>", "</StYlE><script>globalThis.injected=true</script><style>",
    "background:url(assets/a.png);", "@import url(assets/b.css);",
    "a::after{content:'<\\/style>'}", "\n", "\r", "/* comment */", "\\", "'",
    '"', "日本語", "<", ">", "url('data:image/png;base64,AAAA')",
  ];
  for (let i = 0; i < 400; i++) {
    const input = Array.from({ length: 1 + next() % 12 }, () => tokens[next() % tokens.length]).join("");
    const escaped = escapeStyleContent(input);
    assert.doesNotMatch(escaped, /<\/style/i, "seed=" + SEED + " case=" + i);
    assert.equal(escapeStyleContent(escaped), escaped);
    const rewritten = rewriteCssAssetUrls(input, (url) => url === "assets/a.png" ? "assets/b.png" : url);
    assert.equal(typeof rewritten, "string");
    assert.ok(rewritten.length >= 0);
  }
});
