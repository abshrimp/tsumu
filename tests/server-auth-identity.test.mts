import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { parseActivityUser, type ActivityUser } from "../lib/activity";

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
    "./activity": { parseActivityUser },
    "./db": {},
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (id: string) => Object.hasOwn(injected, id) ? injected[id] : require(id),
    module, module.exports,
  );
  return module.exports.requireAuth as {
    (): Promise<Response | null>;
    (mode: "user"): Promise<Response | ActivityUser | null>;
  };
}

test("API authentication fails closed when the session has no verified email identity", async () => {
  for (const session of [
    null, {}, { user: null }, { user: {} },
    { user: { email: null } }, { user: { email: "" } },
    { user: { email: "   " } }, { user: { email: 42 } },
    { user: { email: "missing-domain" } }, { user: { email: "a".repeat(255) + "@example.com" } },
  ]) {
    const response = await requireAuthFixture(session)();
    assert.equal(response?.status, 401, JSON.stringify(session));
    const user = await requireAuthFixture(session)("user");
    assert.ok(user instanceof Response);
    assert.equal(user.status, 401);
  }
  assert.equal(await requireAuthFixture({ user: { email: "editor@example.com" } })(), null);
});

test("explicit anonymous access still works only with authentication unconfigured", async () => {
  assert.equal((await requireAuthFixture(null, false, false)())?.status, 503);
  assert.equal(await requireAuthFixture(null, false, true)(), null);
});

test("author-sensitive requests get the authorized user or explicitly allowed anonymous access", async () => {
  const session = { user: { email: "Editor@example.com", name: "Editor" } };
  assert.deepEqual(await requireAuthFixture(session)("user"), {
    email: "editor@example.com", name: "Editor", image: null,
  });
  const expired = await requireAuthFixture(null, true, true)("user");
  assert.ok(expired instanceof Response);
  assert.equal(expired.status, 401);
  assert.equal(await requireAuthFixture(null, false, true)("user"), null);
});

test("the complete verified email survives author checks and collaboration serialization", async () => {
  const domain = ["a".repeat(63), "b".repeat(63), "c".repeat(61)].join(".");
  const email = "x".repeat(64) + "@" + domain;
  assert.equal(email.length, 254);
  const user = await requireAuthFixture({ user: { email } })("user");
  assert.ok(user && !(user instanceof Response));
  assert.equal(user.email, email);
  assert.deepEqual(parseActivityUser(JSON.parse(JSON.stringify(user))), user);
});
