import assert from "node:assert/strict";
import { test } from "node:test";
import { anonymousAllowed, anonymousHostAllowed, isLoopbackHost } from "../lib/anonymous";

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

test("設定なしの npm run dev は localhost 宛てだけを受け付ける（DNS rebinding 対策）", () => {
  for (const host of ["localhost:3000", "LOCALHOST", "app.localhost:3000", "127.0.0.1:3000", "127.1.2.3", "[::1]:3000"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
  for (const host of ["attacker.example:3000", "localhost.attacker.example", "127.0.0.1.nip.io", "127.0.0.256", "192.168.1.5:3000", "[::2]"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
  withEnv({ NODE_ENV: "development", ALLOW_ANONYMOUS: undefined }, () => {
    assert.equal(anonymousHostAllowed("localhost:3000"), true);
    assert.equal(anonymousHostAllowed("attacker.example:3000"), false);
    assert.equal(anonymousHostAllowed(null), false);
  });
  // 明示したログインなしや、本番のビルドでは Host を制限しない（デモを公開するため）。
  withEnv({ NODE_ENV: "development", ALLOW_ANONYMOUS: "true" }, () => assert.equal(anonymousHostAllowed("192.168.1.5:3000"), true));
  withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: "true" }, () => assert.equal(anonymousHostAllowed("demo.example"), true));
});
