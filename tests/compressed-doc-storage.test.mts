import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import {
  decodeStoredDoc, encodeStoredDoc, StoredDocTooLargeError,
  MAX_EXPANDED_DOC_BYTES, MAX_STORED_DOC_BYTES, STORED_DOC_GZIP_LEVEL,
} from "../lib/compressed-doc-storage";

function doc() {
  return {
    siteName: "Large site 日本語",
    pageOrder: ["p"],
    pages: { p: { id: "p", slug: "", name: "Home", children: [] } },
    nodes: {},
    assets: {
      a: { id: "a", name: 'image "α".png', path: "assets/a.png", width: 3, height: 4 },
      b: { id: "b", name: "image.svg", path: "assets/b.svg", width: 2, height: 3 },
    },
    customHeadHtml: "<style>body { color: red }</style>",
  };
}

test("all document sizes are stored as a gzip level-3 v1 envelope", async () => {
  assert.equal(STORED_DOC_GZIP_LEVEL, 3);
  const raw = JSON.stringify(doc());
  const stored = await encodeStoredDoc(raw);
  const envelope = JSON.parse(stored);
  assert.deepEqual(Object.keys(envelope), ["__tsumu_compressed_v1", "assets", "payload"]);
  assert.equal(envelope.__tsumu_compressed_v1, true);
  assert.deepEqual(envelope.assets, doc().assets);
  assert.deepEqual(Buffer.from(envelope.payload, "base64").subarray(0, 2), Buffer.from([0x1f, 0x8b]));
  assert.equal(await decodeStoredDoc(stored), raw);
  assert.equal(await encodeStoredDoc(raw), stored, "gzip output must be deterministic");
});

test("6 MiB of unicode SiteDoc JSON round-trips with no loss", async () => {
  const input = doc();
  input.customHeadHtml = "こんにちは世界".repeat(400_000);
  const raw = JSON.stringify(input);
  assert.ok(Buffer.byteLength(raw, "utf8") > 6_000_000);
  const stored = await encodeStoredDoc(raw);
  assert.ok(Buffer.byteLength(stored, "utf8") < MAX_STORED_DOC_BYTES);
  assert.equal(await decodeStoredDoc(stored), raw);
});

test("asset index comparison ignores key order but rejects changed values", async () => {
  const raw = JSON.stringify(doc());
  const envelope = JSON.parse(await encodeStoredDoc(raw));
  envelope.assets = Object.fromEntries(Object.entries(envelope.assets).reverse());
  assert.equal(await decodeStoredDoc(JSON.stringify(envelope)), raw);
  envelope.assets.a.width = 12;
  await assert.rejects(decodeStoredDoc(JSON.stringify(envelope)), /index mismatch/);
});

test("old plain JSON and unknown formats are rejected without fallback", async () => {
  const raw = JSON.stringify(doc());
  await assert.rejects(decodeStoredDoc(raw), /envelope/);
  await assert.rejects(decodeStoredDoc(""), /envelope/);
  await assert.rejects(decodeStoredDoc('{"__tsumu_compressed_v2":true}'), /envelope/);
  const envelope = JSON.parse(await encodeStoredDoc(raw));
  envelope.extra = "unrecognized";
  await assert.rejects(decodeStoredDoc(JSON.stringify(envelope)), /envelope/);
});

test("invalid Base64, invalid gzip and invalid JSON cannot be accepted", async () => {
  const envelope = JSON.parse(await encodeStoredDoc(JSON.stringify(doc())));
  for (const payload of ["-abc", "abc", "AAAA=", "AQ==", "AAAA", "AQ=/"]) {
    await assert.rejects(decodeStoredDoc(JSON.stringify({ ...envelope, payload })), /payload/);
  }
  await assert.rejects(decodeStoredDoc(JSON.stringify({
    ...envelope, payload: Buffer.from("not gzip").toString("base64"),
  })), /payload/);
  await assert.rejects(decodeStoredDoc(JSON.stringify({
    ...envelope, payload: gzipSync(Buffer.from("not JSON")).toString("base64"),
  })), /Invalid JSON/);
});

test("expanded payload is bounded before JSON parsing", async () => {
  const huge = Buffer.alloc(MAX_EXPANDED_DOC_BYTES + 1, 0x20);
  const compressed = gzipSync(huge, { level: 1 });
  const raw = JSON.stringify(doc());
  const envelope = JSON.parse(await encodeStoredDoc(raw));
  envelope.payload = compressed.toString("base64");
  await assert.rejects(decodeStoredDoc(JSON.stringify(envelope)), /oversized/);
});

test("incompressible content above the D1 safety cap fails before any write", async () => {
  const input = doc();
  input.customHeadHtml = randomBytes(2_100_000).toString("base64");
  await assert.rejects(encodeStoredDoc(JSON.stringify(input)), StoredDocTooLargeError);
});

test("invalid SiteDoc JSON and oversized stored body are rejected", async () => {
  await assert.rejects(encodeStoredDoc("not JSON"), /Invalid SiteDoc JSON/);
  await assert.rejects(encodeStoredDoc("{}"), /Invalid SiteDoc/);
  await assert.rejects(decodeStoredDoc("X".repeat(MAX_STORED_DOC_BYTES + 1)), /safety limit/);
});
