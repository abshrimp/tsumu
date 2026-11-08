import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { HTML_ZIP_LIMITS, inspectHtmlZip, readZipEntryLimited } from "../lib/html-zip-guard";
import { readHtmlZip } from "../lib/html-zip";

async function reopen(zip: JSZip): Promise<JSZip> {
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return JSZip.loadAsync(bytes);
}

test("HTML ZIP inspection accepts ordinary nested pages and static assets", async () => {
  const zip = await reopen(new JSZip()
    .file("site/index.html", "<main>Home</main>")
    .file("site/about.html", "<main>About</main>")
    .file("site/styles.css", "body{margin:0}")
    .file("site/photo.png", new Uint8Array([1, 2, 3])));
  const result = inspectHtmlZip(zip);
  assert.equal(result.htmlEntry.name, "site/index.html");
  assert.deepEqual(result.htmlEntries.map((e) => e.name),
    ["site/index.html", "site/about.html"]);
  assert.deepEqual(result.assetEntries.map((e) => e.name),
    ["site/styles.css", "site/photo.png"]);
});

test("HTML ZIP rejects traversal paths before any file is extracted", async () => {
  const zip = await reopen(new JSZip()
    .file("index.html", "<main>Safe</main>")
    .file("../outside.js", "bad"));
  assert.throws(() => inspectHtmlZip(zip), /安全でないファイルパス/);
});

test("HTML ZIP rejects case-folded path collisions", async () => {
  const zip = await reopen(new JSZip()
    .file("index.html", "<main>Safe</main>")
    .file("assets/logo.svg", "<svg/>")
    .file("assets/LOGO.svg", "<svg/>"));
  assert.throws(() => inspectHtmlZip(zip), /重複したファイルパス/);
});

test("HTML ZIP rejects advertised oversize assets before uploading", async () => {
  const zip = await reopen(new JSZip()
    .file("index.html", "<main>Safe</main>")
    .file("huge.bin", new Uint8Array(HTML_ZIP_LIMITS.assetBytes + 1)));
  assert.throws(() => inspectHtmlZip(zip), /アセットが大きすぎ/);
});

test("HTML ZIP rejects aggregate expansion and implausible metadata", async () => {
  const input = new JSZip().file("index.html", "<main>Safe</main>");
  for (let i = 0; i < 13; i++) input.file("asset-" + i + ".bin", "x");
  const zip = await reopen(input);
  for (let i = 0; i < 13; i++) {
    const entry = zip.file("asset-" + i + ".bin") as JSZip.JSZipObject & {
      _data: { uncompressedSize: number };
    };
    entry._data.uncompressedSize = HTML_ZIP_LIMITS.assetBytes;
  }
  assert.throws(() => inspectHtmlZip(zip), /展開後のデータが大きすぎ/);

  const entry = zip.file("asset-0.bin") as JSZip.JSZipObject & {
    _data: { uncompressedSize?: number };
  };
  delete entry._data.uncompressedSize;
  assert.throws(() => inspectHtmlZip(zip), /ファイルサイズが正しく/);
});

test("streamed decompression rejects real expansion beyond the advertised limit", async () => {
  const original = new Uint8Array(256 * 1024).fill(65);
  const zip = await reopen(new JSZip().file("index.html", "ok").file("payload.bin", original));
  const entry = zip.file("payload.bin")!;
  await assert.rejects(readZipEntryLimited(entry, 1024), /展開後のデータが大きすぎ/);
  assert.deepEqual(await readZipEntryLimited(entry, original.length), original);
});

test("HTML ZIP rejects more than 200 files", async () => {
  const input = new JSZip().file("index.html", "safe");
  for (let i = 0; i < HTML_ZIP_LIMITS.entries; i++) input.file("assets/" + i + ".txt", "x");
  const zip = await reopen(input);
  assert.throws(() => inspectHtmlZip(zip), /200個まで/);
});

test("raw HTML ZIP import rejects oversized HTML without starting uploads", async () => {
  const input = new JSZip()
    .file("index.html", "x".repeat(HTML_ZIP_LIMITS.htmlBytes + 1))
    .file("asset.js", "export {}");
  const bytes = await input.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const originalFetch = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async () => { uploads++; throw new Error("Unexpected upload"); };
  try {
    await assert.rejects(readHtmlZip(bytes), /HTMLが大きすぎ/);
    assert.equal(uploads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("raw HTML ZIP import validates all stylesheets before uploading other assets", async () => {
  const input = new JSZip()
    .file("index.html", "<link rel=\"stylesheet\" href=\"bad.css\">")
    .file("first.js", "export {}")
    .file("bad.css", new Uint8Array([0xff, 0xfe, 0xfd]));
  const bytes = await input.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const originalFetch = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async () => { uploads++; throw new Error("Unexpected upload"); };
  try {
    await assert.rejects(readHtmlZip(bytes), /UTF-8/);
    assert.equal(uploads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ZIPs with duplicate physical names cannot hide a record in JSZip's normalized file map", async () => {
  const zip = new JSZip().file("index.html", "<main></main>").file("a.txt", "one").file("b.txt", "two");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  // Both names now have the same bytes in the local headers and central directory.
  const duplicated = Buffer.from(Buffer.from(bytes).toString("latin1").replaceAll("b.txt", "a.txt"), "latin1");
  await assert.rejects(readHtmlZip(duplicated), /重複/);
});
