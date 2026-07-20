import assert from "node:assert/strict";
import { test } from "node:test";
import { assetDisplayKind, assetExtensionLabel, isVisualAsset } from "../lib/asset-display";

test("CSS, scripts, JSON and fonts are not displayed or inserted as images", () => {
  for (const [name, mimeType, expected] of [
    ["main.css", "text/css", "css"],
    ["app.js", "text/javascript", "javascript"],
    ["client.mjs", "application/javascript", "javascript"],
    ["app.woff2", "font/woff2", "font"],
    ["data.json", "application/json", "json"],
    ["readme.txt", "text/plain", "document"],
    ["bundle.zip", "application/zip", "archive"],
    ["file.unknown", "application/octet-stream", "file"],
  ] as const) {
    assert.equal(assetDisplayKind({ name, mimeType }), expected, name);
    assert.equal(isVisualAsset({ name, mimeType }), false, name);
  }
});

test("visual formats still have media previews, including legacy assets without MIME", () => {
  for (const [name, mimeType, expected] of [
    ["image.svg", "image/svg+xml", "image"],
    ["photo.png", undefined, "image"],
    ["song.mp3", "", "audio"],
    ["clip.webm", "video/webm", "video"],
  ] as const) {
    assert.equal(assetDisplayKind({ name, mimeType }), expected);
    assert.equal(isVisualAsset({ name, mimeType }), true);
  }
  assert.equal(assetExtensionLabel({ name: "bundle.woff2" }), "WOFF2");
  assert.equal(assetExtensionLabel({ name: "script.js" }), "JS");
  assert.equal(assetExtensionLabel({ name: "longfilename", mimeType: "text/css" }), "CSS");
});
