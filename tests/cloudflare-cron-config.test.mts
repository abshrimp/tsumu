import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import type { AssetGcDependencies } from "../lib/asset-gc";
import { test } from "node:test";
import { parseJsonc } from "../scripts/cloudflare.mjs";

test("asset GC cron triggers use Cloudflare-supported weekday syntax", () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers?.crons, [
    "0 18 * * *", // 03:00 JST daily
    "0 19 * * SUN", // 04:00 JST Monday
  ]);
});

function scheduledGc() {
  const url = new URL("../custom-worker.ts", import.meta.url);
  const require = createRequire(url);
  const calls: AssetGcDependencies[] = [];
  const db = { backend: "d1" };
  const mocks: Record<string, unknown> = {
    "cloudflare:workers": { DurableObject: class {} },
    "./.open-next/worker.js": {},
    "./document-room": {},
    "./lib/db": { getDbFromBinding: async () => db },
    "./lib/asset-gc": { runAssetGc: async (options: AssetGcDependencies) => { calls.push(options); } },
  };
  const { code } = transformSync(readFileSync(url, "utf8"), { loader: "ts", format: "cjs", target: "es2022" });
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports,
  );
  return {
    calls, db,
    async run(cron: string, listing = true) {
      const work: Promise<unknown>[] = [];
      const env = { DB: {}, DOC_STORE: {}, ASSETS_KV: listing ? { list: async () => ({}) } : {}, ASSET_GC_ENABLED: "true" };
      mod.exports.default.scheduled({ cron }, env, { waitUntil: (task: Promise<unknown>) => work.push(task) });
      await Promise.all(work);
    },
  };
}

test("configured daily and weekly cron events select their respective GC modes", async () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const h = scheduledGc();
  for (const cron of config.triggers.crons) await h.run(cron);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(call => call.discoverUntracked), [false, true]);
  for (const call of h.calls) {
    assert.equal(call.db, h.db);
    assert.equal(call.dryRun, false);
  }
});

test("only weekly reconciliation requires the KV listing capability", async () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const h = scheduledGc();
  await h.run(config.triggers.crons[1], false);
  assert.equal(h.calls.length, 0);
  await h.run(config.triggers.crons[0], false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].discoverUntracked, false);
});
