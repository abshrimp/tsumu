import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import { createSiteBackup } from "../lib/site-backup";
import { parseSiteImport, EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH } from "../lib/site-import";

test("manual backup contains every asset byte, including unused images, fonts and embedded files", async () => {
  const doc = createInitialDoc();
  const image = new Uint8Array([0, 255, 1, 10, 27, 13]);
  const font = new Uint8Array([119, 79, 70, 50, 2, 1]);
  const inline = new Uint8Array([0, 19, 255, 17]);
  doc.assets.logo = {
    id: "logo", name: "ロゴ.png", path: "assets/logo.png", mimeType: "image/png",
    bytes: image.length, width: 1, height: 1,
  };
  doc.assets.font = {
    id: "font", name: "custom.woff2", path: "assets/custom.woff2", mimeType: "font/woff2",
    bytes: font.length, width: 0, height: 0,
  };
  doc.assets.unused = {
    id: "unused", name: "unused.bin", mimeType: "application/octet-stream",
    dataUrl: "data:application/octet-stream;base64," + Buffer.from(inline).toString("base64"),
    width: 0, height: 0,
  };
  const expected = JSON.stringify(doc);
  const responses = new Map([["assets/logo.png", image], ["assets/custom.woff2", font]]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (!url.startsWith("/api/assets/file?")) return originalFetch(input, init);
    const bytes = responses.get(new URL(url, "https://example.test").searchParams.get("path") ?? "");
    return Promise.resolve(bytes
      ? new Response(new Blob([bytes]), { headers: { "Content-Type": "application/octet-stream" } })
      : new Response(null, { status: 404 }));
  };
  try {
    const blob = await createSiteBackup(doc);
    const archiveBytes = new Uint8Array(await blob.arrayBuffer());
    const archive = await JSZip.loadAsync(archiveBytes);
    assert.ok(archive.file(EDITABLE_DOC_PATH));
    assert.ok(archive.file(EDITABLE_ASSETS_PATH));
    const parsed = await parseSiteImport(archiveBytes, "zip");
    assert.deepEqual(parsed.doc, doc);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.assets.size, 3);
    assert.deepEqual(parsed.assets.get("logo"), image);
    assert.deepEqual(parsed.assets.get("font"), font);
    assert.deepEqual(parsed.assets.get("unused"), inline);
    assert.equal(JSON.stringify(doc), expected, "backup must not modify the edited document");
    const names = Object.values(JSON.parse(await archive.file(EDITABLE_ASSETS_PATH)!.async("text")).assets);
    assert.equal(new Set(names).size, names.length, "all archive paths must be unique");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual backup refuses missing files instead of downloading a broken archive", async () => {
  const doc = createInitialDoc();
  doc.assets.missing = {
    id: "missing", name: "removed.svg", path: "assets/missing.svg",
    mimeType: "image/svg+xml", width: 10, height: 10,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));
  try {
    await assert.rejects(createSiteBackup(doc), /removed.svg/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual backup enforces per-asset size even for a misleading server response", async () => {
  const doc = createInitialDoc();
  doc.assets.large = {
    id: "large", name: "large.mp4", path: "assets/large.mp4",
    mimeType: "video/mp4", width: 0, height: 0,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array([1]), {
    headers: { "Content-Length": String(25 * 1024 * 1024 + 1) },
  }));
  try {
    await assert.rejects(createSiteBackup(doc), /large.mp4/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual backup refuses assets with no recoverable file contents", async () => {
  const doc = createInitialDoc();
  doc.assets.unavailable = {
    id: "unavailable", name: "lost.wav", mimeType: "audio/wav", width: 0, height: 0,
  };
  await assert.rejects(createSiteBackup(doc), /lost.wav/);
});
