import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseJsonc } from "../scripts/cloudflare.mjs";

test("asset GC cron triggers use Cloudflare-supported weekday syntax", () => {
  const config = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers?.crons, [
    "0 18 * * *", // 03:00 JST daily
    "0 19 * * SUN", // 04:00 JST Monday
  ]);
});
