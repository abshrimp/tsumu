import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { hostingProjectName } from "../lib/publish-provider";
import { isPublicStaticPath, listStaticDeployments, pagesAssetHash, readStaticZip } from "../lib/static-hosting";

test("each provider isolates site projects, including Netlify previews", () => {
  const a = hostingProjectName("abc123", "netlify", "production", "tsumu");
  const b = hostingProjectName("abc124", "netlify", "production", "tsumu");
  assert.notEqual(a, b);
  assert.equal(a, "tsumu-abc123");
  assert.equal(hostingProjectName("abc123", "netlify", "test", "tsumu"), "tsumu-abc123-preview");
  assert.equal(hostingProjectName("abc123", "cloudflare", "test", "tsumu"), "tsumu-abc123");
  assert.throws(() => hostingProjectName("abc123", "netlify", "production", "../bad"));
  assert.throws(() => hostingProjectName("ABC", "netlify", "production", "tsumu"));
  assert.throws(() => hostingProjectName("a".repeat(64), "cloudflare", "production", "tsumu"));
});

test("never include editable data or environment files in public hosting payloads", () => {
  for (const path of ["_tsumu/doc.json", ".env", ".env.production", "assets/.env", "pages/Doc.json", ".git/config"]) {
    assert.equal(isPublicStaticPath(path), false, path);
  }
  assert.equal(isPublicStaticPath("index.html"), true);
  assert.equal(isPublicStaticPath("assets/logo.png"), true);
});

async function zipFor(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return zip.generateAsync({ type: "arraybuffer" });
}

test("valid static ZIP has only deployable files", async () => {
  const files = await readStaticZip(await zipFor({
    "index.html": "<html>OK</html>",
    "assets/logo.svg": "<svg></svg>",
  }));
  assert.deepEqual(files.map((file) => file.path), ["index.html", "assets/logo.svg"]);
});

test("rejects missing index, private files, path collisions and oversized archives", async () => {
  await assert.rejects(readStaticZip(await zipFor({ "about.html": "x" })), /index.html/);
  await assert.rejects(readStaticZip(await zipFor({ "index.html": "x", "_tsumu/doc.json": "{}" })), /Editable project data/);
  await assert.rejects(readStaticZip(await zipFor({ "index.html": "x", "INDEX.HTML": "y" })), /collision/i);
  await assert.rejects(readStaticZip(new ArrayBuffer(0)), /too large/i);
});

test("Cloudflare asset hashes are content- and extension-dependent", () => {
  const file = new TextEncoder().encode("static content");
  const hash = pagesAssetHash(file, "index.html");
  assert.match(hash, /^[0-9a-f]{32}$/);
  assert.equal(hash, pagesAssetHash(file, "pages/about.html"));
  assert.notEqual(hash, pagesAssetHash(file, "index.js"));
  assert.notEqual(hash, pagesAssetHash(new TextEncoder().encode("other"), "index.html"));
});

test("listStaticDeployments returns an empty list when Cloudflare Pages project does not exist yet", async () => {
  const savedAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const savedToken = process.env.CLOUDFLARE_API_TOKEN;
  const savedFetch = globalThis.fetch;
  process.env.CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  process.env.CLOUDFLARE_API_TOKEN = "cf-test-token";
  try {
    let status = 404;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false }), { status });
    assert.deepEqual(await listStaticDeployments("abc123", "production"), []);
    status = 500;
    await assert.rejects(listStaticDeployments("abc123", "production"), /HTTP 500/);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = savedAccount;
    if (savedToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = savedToken;
  }
});
