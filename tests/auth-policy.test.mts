import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authCallbacks } from "../lib/auth-policy";
import { addAllowedEmail, isEmailAllowed, removeAllowedEmail } from "../lib/allowlist";

test("Google sign-in requires a verified profile email and checks live sessions against the allowlist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-auth-"));
  const previous = { ALLOWED_EMAILS: process.env.ALLOWED_EMAILS, TSUMU_DATA_DIR: process.env.TSUMU_DATA_DIR };
  process.env.ALLOWED_EMAILS = " Owner@Example.com ";
  process.env.TSUMU_DATA_DIR = dir;
  const signIn = (profile: unknown, email = "owner@example.com") => authCallbacks.signIn({
    profile, user: { id: "u", email }, account: null,
  } as Parameters<typeof authCallbacks.signIn>[0]);
  const session = (email?: string) => authCallbacks.jwt({ token: { email } } as Parameters<typeof authCallbacks.jwt>[0]);
  try {
    assert.equal(await signIn({ email: "OWNER@example.com", email_verified: true }), true);
    for (const verified of [false, undefined, "true", 1]) {
      assert.equal(await signIn({ email: "owner@example.com", email_verified: verified }), false);
    }
    assert.equal(await signIn(undefined), false, "user.email cannot replace a verified Google profile");
    assert.equal(await signIn({ email: "stranger@example.com", email_verified: true }), false);
    assert.deepEqual(await session("owner@example.com"), { email: "owner@example.com" });
    assert.equal(await session(), null);
    await addAllowedEmail("editor@example.com");
    assert.equal(await signIn({ email: "editor@example.com", email_verified: true }), true);
    assert.deepEqual(await session("editor@example.com"), { email: "editor@example.com" });
    await removeAllowedEmail("editor@example.com");
    assert.equal(await session("editor@example.com"), null, "an unexpired session is revoked on its next use");
    assert.equal(await signIn({ email: "editor@example.com", email_verified: true }), false);
    process.env.ALLOWED_EMAILS = "";
    assert.equal(await session("owner@example.com"), null, "fixed-list changes also invalidate existing sessions");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("connection permission checks fail closed when the allowlist is unavailable", async () => {
  const unavailable = async (): Promise<string[]> => { throw new Error("offline"); };
  assert.equal(await isEmailAllowed("editor@example.com", [], unavailable), false);
  assert.equal(await isEmailAllowed("owner@example.com", ["owner@example.com"], unavailable), true);
  assert.equal(await isEmailAllowed(undefined, [], async () => []), false);
});
