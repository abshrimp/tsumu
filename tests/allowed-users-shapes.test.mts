import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { JsonBodyTooLargeError, readJsonLimited } from "../lib/api-json";

function fixture() {
  class NextResponse extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(value), init);
    }
  }
  const inserted: string[] = [];
  const src = readFileSync(new URL("../app/api/allowed-users/route.ts", import.meta.url), "utf8");
  const code = transformSync(src, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const module = { exports: {} as Record<string, any> };
  const injected: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../auth": {
      authConfigured: () => true,
      auth: async () => ({ user: { email: "owner@example.com" } }),
      allowedEmails: () => ["owner@example.com"],
    },
    "../../../lib/i18n-server": { serverTr: async () => (s: string) => s },
    "../../../lib/unavailable": { dbUnavailable: async () => NextResponse.json({}, { status: 503 }) },
    "../../../lib/db": { dbConfigured: () => true },
    "../../../lib/api-json": { JsonBodyTooLargeError, readJsonLimited },
    "../../../lib/errors": { userMessage: (_e: unknown, fallback: string) => fallback },
    "../../../lib/allowlist": {
      addAllowedEmail: async (email: string) => { inserted.push(email); },
      listAllowedEmails: async () => inserted,
      removeAllowedEmail: async () => false,
    },
  };
  new Function("require", "module", "exports", code)(
    (id: string) => injected[id], module, module.exports,
  );
  const POST = module.exports.POST as (req: Request) => Promise<Response>;
  const send = (value: unknown) => POST(new Request("https://editor.example.test/api/allowed-users", {
    method: "POST", body: JSON.stringify(value),
  }));
  return { send, inserted };
}

test("account allowlist API rejects unexpected JSON field types without writes", async () => {
  const f = fixture();
  for (const value of [
    null, [], {}, { email: null }, { email: 1 }, { email: true },
    { email: ["attacker@example.com"] }, { email: { address: "attacker@example.com" } },
  ]) {
    assert.equal((await f.send(value)).status, 400, JSON.stringify(value));
  }
  assert.deepEqual(f.inserted, []);
});

test("account allowlist API still accepts a normalized string email address", async () => {
  const f = fixture();
  const response = await f.send({ email: " Editor@Example.com " });
  assert.equal(response.status, 200);
  assert.deepEqual(f.inserted, ["editor@example.com"]);
});
