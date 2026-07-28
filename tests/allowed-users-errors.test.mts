import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

function fixture(failRefresh: boolean) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/allowed-users/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  let changed = false;
  const emails = new Set<string>();
  const injected = {
    NextResponse, dbUnavailable: () => { throw new Error("Unexpected unavailable"); },
    serverTr: async () => (value: string) => value,
    allowedEmails: () => ["owner@example.com"], auth: async () => ({ user: { email: "owner@example.com" } }), authConfigured: () => true,
    dbConfigured: () => true, userMessage: (_error: unknown, fallback: string) => fallback,
    listAllowedEmails: async () => { if (changed && failRefresh) throw new Error("Temporary database read failure"); return [...emails]; },
    addAllowedEmail: async (email: string) => { changed = true; emails.add(email); },
    removeAllowedEmail: async (email: string) => { changed = true; return emails.delete(email); },
  };
  const api = new Function(...Object.keys(injected), `${source}; return { POST, DELETE };`)(...Object.values(injected));
  return { api, emails };
}
for (const method of ["POST", "DELETE"] as const) {
  test(`${method} returns the documented JSON error when the post-mutation refresh fails`, async () => {
    const { api, emails } = fixture(true);
    if (method === "DELETE") emails.add("editor@example.com");
    const req = new Request("https://example.test/api/allowed-users?email=editor%40example.com", {
      method, ...(method === "POST" ? { body: JSON.stringify({ email: "editor@example.com" }) } : {}),
    });
    const response = await api[method](req);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, method === "POST" ? "保存できませんでした" : "削除できませんでした");
    assert.equal(emails.has("editor@example.com"), method === "POST", "the mutation already completed before refresh failed");
  });
  test(`${method} still returns the updated account list when refresh succeeds`, async () => {
    const { api, emails } = fixture(false);
    if (method === "DELETE") emails.add("editor@example.com");
    const response = await api[method](new Request("https://example.test/api/allowed-users?email=editor%40example.com", {
      method, ...(method === "POST" ? { body: JSON.stringify({ email: "editor@example.com" }) } : {}),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).extra, method === "POST" ? ["editor@example.com"] : []);
  });
}
