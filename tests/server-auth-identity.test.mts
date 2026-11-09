import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

function requireAuthFixture(session: unknown, configured = true, anonymous = false) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  const file = new URL("../lib/server.ts", import.meta.url);
  const require = createRequire(file);
  const code = transformSync(readFileSync(file, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  const injected: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../auth": { authConfigured: () => configured, auth: async () => session },
    "./anonymous": { anonymousAllowed: () => anonymous },
    "./i18n-server": { serverTr: async () => (s: string) => s },
    "./activity": {},
    "./db": {},
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (id: string) => Object.hasOwn(injected, id) ? injected[id] : require(id),
    module, module.exports,
  );
  return module.exports.requireAuth as () => Promise<Response | null>;
}

test("API authentication fails closed when the session has no verified email identity", async () => {
  for (const session of [
    null, {}, { user: null }, { user: {} },
    { user: { email: null } }, { user: { email: "" } },
  ]) {
    const response = await requireAuthFixture(session)();
    assert.equal(response?.status, 401, JSON.stringify(session));
  }
  assert.equal(await requireAuthFixture({ user: { email: "editor@example.com" } })(), null);
});

test("explicit anonymous access still works only with authentication unconfigured", async () => {
  assert.equal((await requireAuthFixture(null, false, false)())?.status, 503);
  assert.equal(await requireAuthFixture(null, false, true)(), null);
});
