import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dbConfigured } from "../lib/db";
import { assetStore } from "../lib/kv";

test("browser-local mode disables server-side database and KV storage", () => {
  const old = process.env.TSUMU_STORAGE_MODE;
  try {
    process.env.TSUMU_STORAGE_MODE = "local";
    assert.equal(dbConfigured(), false);
    assert.equal(assetStore(), null);
  } finally {
    if (old === undefined) delete process.env.TSUMU_STORAGE_MODE;
    else process.env.TSUMU_STORAGE_MODE = old;
  }
});

test("direct WebSocket collaboration and scheduled KV garbage collection respect local mode", () => {
  const source = readFileSync(new URL("../custom-worker.ts", import.meta.url), "utf8");
  assert.match(source, /if \(env\.TSUMU_STORAGE_MODE === "local"\)\s*return;/);
  assert.match(source, /if \(env\.TSUMU_STORAGE_MODE === "local"\)\s*\{\s*return new Response\("Collaboration requires server-backed site storage", \{ status: 503 \}\);/);
});
