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
    .file("site/docs/index.html", "<main>Docs</main>")
    .file("site/index.html", "<main>Home</main>")
    .file("site/about.html", "<main>About</main>")
    .file("site/styles.css", "body{margin:0}")
    .file("site/photo.png", new Uint8Array([1, 2, 3])));
  const result = inspectHtmlZip(zip);
  assert.equal(result.htmlEntry.name, "site/index.html");
  assert.deepEqual(result.htmlEntries.map((e) => e.name),
    ["site/docs/index.html", "site/index.html", "site/about.html"]);
  assert.deepEqual(result.assetEntries.map((e) => e.name),
    ["site/styles.css", "site/photo.png"]);
});

test("HTML ZIP rejects traversal paths before any file is extracted", async () => {
  const zip = await reopen(new JSZip()
    .file("index.html", "<main>Safe</main>")
    .file("../outside.js", "bad"));
  assert.throws(() => inspectHtmlZip(zip), /unsafe path/);
});

test("HTML ZIP rejects case-folded path collisions", async () => {
  const zip = await reopen(new JSZip()
    .file("index.html", "<main>Safe</main>")
    .file("assets/logo.svg", "<svg/>")
    .file("assets/LOGO.svg", "<svg/>"));
  assert.throws(() => inspectHtmlZip(zip), /duplicate file paths/);
});

test("HTML ZIP rejects advertised oversize assets before uploading", async () => {
  const zip = await reopen(new JSZip()
    .file("index.html", "<main>Safe</main>")
    .file("huge.bin", new Uint8Array(HTML_ZIP_LIMITS.assetBytes + 1)));
  assert.throws(() => inspectHtmlZip(zip), /asset in the ZIP is too large/);
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
  assert.throws(() => inspectHtmlZip(zip), /expands beyond the size limit/);

  const entry = zip.file("asset-0.bin") as JSZip.JSZipObject & {
    _data: { uncompressedSize?: number };
  };
  delete entry._data.uncompressedSize;
  assert.throws(() => inspectHtmlZip(zip), /invalid size/);
});

test("streamed decompression rejects real expansion beyond the advertised limit", async () => {
  const original = new Uint8Array(256 * 1024).fill(65);
  const zip = await reopen(new JSZip().file("index.html", "ok").file("payload.bin", original));
  const entry = zip.file("payload.bin")!;
  await assert.rejects(readZipEntryLimited(entry, 1024), /expands beyond the size limit/);
  assert.deepEqual(await readZipEntryLimited(entry, original.length), original);
});

test("HTML ZIP enforces both file and directory record limits", async () => {
  const input = new JSZip().file("index.html", "safe");
  for (let i = 0; i < HTML_ZIP_LIMITS.entries; i++) input.file("assets/" + i + ".txt", "x");
  const zip = await reopen(input);
  assert.throws(() => inspectHtmlZip(zip), /up to 200 files/);
  const directories = new JSZip().file("index.html", "home");
  for (let i = 0; i < HTML_ZIP_LIMITS.entries * 4; i++) directories.folder("folder-" + i);
  const opened = await reopen(directories);
  assert.throws(() => inspectHtmlZip(opened), /too many files/);
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
    await assert.rejects(readHtmlZip(bytes), /HTML file in the ZIP is too large/);
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
  // これで、ローカルヘッダーとセントラルディレクトリの両方で、2つの名前が同じバイト列になる。
  const duplicated = Buffer.from(Buffer.from(bytes).toString("latin1").replaceAll("b.txt", "a.txt"), "latin1");
  await assert.rejects(readHtmlZip(duplicated), /duplicate file paths/);
});

test("failure after an upload removes exactly the new archive asset", async () => {
  const zip = new JSZip().file("index.html", "<html></html>").file("first.js", "x").file("second.js", "y");
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const before = globalThis.fetch;
  const deleted: string[] = [];
  let posts = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (init?.method === "DELETE") {
        deleted.push(new URL(String(url), "https://editor.test").searchParams.get("path")!);
        return new Response();
      }
      return ++posts === 1 ? Response.json({ path: "assets/first", name: "first.js" }) :
        Response.json({ error: "upload failed" }, { status: 500 });
    };
    await assert.rejects(readHtmlZip(bytes), /upload failed/);
    assert.equal(posts, 2);
    assert.deepEqual(deleted, ["assets/first"]);
  } finally { globalThis.fetch = before; }
});

test("archive-local script and stylesheet integrity is checked before uploading a single asset", async () => {
  for (const tag of ['<link href=assets/a.css rel=stylesheet integrity="sha512-AAAA">',
    '<script type=module src=assets/a.js integrity="sha256-AAAA"></script>']) {
    const zip = new JSZip().file("site/index.html", tag).file("site/assets/a.css", ".x{color:red}")
      .file("site/assets/a.js", "globalThis.unverified = true");
    const fetch = globalThis.fetch;
    let uploads = 0;
    globalThis.fetch = async () => { uploads++; return Response.json({ path: "assets/new" }); };
    try {
      await assert.rejects(readHtmlZip(await zip.generateAsync({ type: "uint8array" })), /integrity/i);
      assert.equal(uploads, 0);
    } finally { globalThis.fetch = fetch; }
  }
});

test("valid empty files and comments containing a ZIP signature can be imported", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const original = new JSZip().file("site/index.html", "<p>Home</p>").file("site/empty.css", "");
  original.comment = "ordinary PK\u0005\u0006" + "x".repeat(28);
  const zip = await openImportZip(await original.generateAsync({ type: "uint8array" }), 200);
  const { assetEntries } = inspectHtmlZip(zip);
  assert.equal(assetEntries[0].name, "site/empty.css");
  assert.equal((await readZipEntryLimited(assetEntries[0], 16)).length, 0);
});

test("corrupt stored bytes do not silently replace an imported document or asset", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const original = new JSZip().file("a.js", "original-payload");
  const bytes = Buffer.from(await original.generateAsync({ type: "uint8array", compression: "STORE" }));
  const start = bytes.indexOf("original-payload");
  assert.ok(start >= 0);
  bytes[start] ^= 1;
  const zip = await openImportZip(bytes, 200);
  await assert.rejects(readZipEntryLimited(zip.file("a.js")!, 100), /CRC/i);
});

test("a forged zero size cannot discard a nonempty deflated member", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const original = new JSZip().file("payload.txt", "not empty");
  const bytes = Buffer.from(await original.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  bytes.writeUInt32LE(0, 14); bytes.writeUInt32LE(0, 22);
  bytes.writeUInt32LE(0, central + 16); bytes.writeUInt32LE(0, central + 24);
  await assert.rejects(openImportZip(bytes, 200));
});

test("ZIP local and central filenames must identify the same member", async () => {
  const { openImportZip } = await import("../lib/zip-directory");
  const bytes = Buffer.from(await new JSZip().file("a.txt", "hello").generateAsync({ type: "uint8array" }));
  bytes[30] = "b".charCodeAt(0);
  await assert.rejects(openImportZip(bytes, 200), /file directory is invalid/);
});

test("true DEFLATE empty members survive validation", async () => {
  const { deflateRawSync } = await import("node:zlib");
  const { openImportZip, zipEntrySize } = await import("../lib/zip-directory");
  const bytes = Buffer.from(await new JSZip().file("empty.txt", "").generateAsync({ type: "uint8array" }));
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  const compressed = deflateRawSync(Buffer.alloc(0));
  const encoded = Buffer.concat([bytes.subarray(0, central), compressed, bytes.subarray(central)]);
  const shifted = central + compressed.length;
  encoded.writeUInt16LE(8, 8); encoded.writeUInt32LE(compressed.length, 18);
  encoded.writeUInt16LE(8, shifted + 10); encoded.writeUInt32LE(compressed.length, shifted + 20);
  encoded.writeUInt32LE(shifted, encoded.length - 6);
  const entry = (await openImportZip(encoded, 200)).file("empty.txt")!;
  assert.equal(zipEntrySize(entry), 0);
  assert.equal((await readZipEntryLimited(entry, 10)).length, 0);
});

test("corruption in a later binary member rejects the HTML ZIP before an earlier member is uploaded", async () => {
  const input = new JSZip().file("index.html", "<p>Test</p>").file("a.js", "first").file("z.bin", "later bytes");
  const bytes = Buffer.from(await input.generateAsync({ type: "uint8array", compression: "STORE" }));
  bytes[bytes.indexOf("later bytes")] ^= 1;
  const fetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async () => { writes++; return Response.json({ path: "assets/upload" }); };
  try {
    await assert.rejects(readHtmlZip(bytes), /CRC/);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = fetch; }
});
