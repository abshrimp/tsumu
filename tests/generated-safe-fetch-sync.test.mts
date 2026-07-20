import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";

test("generated server-side fetch policy matches the audited source exactly", () => {
  const source = readFileSync(new URL("../lib/safe-fetch.ts", import.meta.url), "utf8");
  assert.equal(
    SAFE_FETCH_SOURCE,
    source,
    "Run node --import tsx scripts/sync-fetch-runtime.mts to synchronize generated security code",
  );
});
