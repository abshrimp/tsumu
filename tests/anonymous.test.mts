import assert from "node:assert/strict";
import { test } from "node:test";
import { anonymousAllowed } from "../lib/anonymous";

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    for (const [k, v] of Object.entries(env)) set(k, v);
    run();
  } finally {
    for (const [k, v] of Object.entries(prev)) set(k, v);
  }
}

test("ログインなしで開けるのは npm run dev か ALLOW_ANONYMOUS=true のときだけ", () => {
  withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: undefined }, () => assert.equal(anonymousAllowed(), false));
  withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: "1" }, () => assert.equal(anonymousAllowed(), false));
  withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: "true" }, () => assert.equal(anonymousAllowed(), true));
  withEnv({ NODE_ENV: "development", ALLOW_ANONYMOUS: undefined }, () => assert.equal(anonymousAllowed(), true));
});
