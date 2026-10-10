import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAllowedEmail, allowedEmails, getAccountRole, isAccountRole,
  isEmailAllowed, listAllowedAccounts, removeAllowedEmail, updateAllowedAccountRole,
} from "../lib/allowlist";

test("account roles are stored directly and updates take effect on the next check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-roles-"));
  const original = { TSUMU_DATA_DIR: process.env.TSUMU_DATA_DIR, ALLOWED_EMAILS: process.env.ALLOWED_EMAILS };
  process.env.TSUMU_DATA_DIR = dir;
  process.env.ALLOWED_EMAILS = " Owner@Example.com ";
  try {
    assert.deepEqual(allowedEmails(), ["owner@example.com"]);
    assert.equal(await getAccountRole("owner@example.com"), "editor");
    assert.equal(await getAccountRole("unknown@example.com"), null);
    await addAllowedEmail("colleague@example.com", "viewer");
    assert.equal(await isEmailAllowed("colleague@example.com"), true, "viewers may still sign in");
    assert.equal(await getAccountRole("colleague@example.com"), "viewer");
    assert.deepEqual(await listAllowedAccounts(), [{ email: "colleague@example.com", role: "viewer" }]);
    assert.equal(await updateAllowedAccountRole("colleague@example.com", "editor"), true);
    assert.equal(await getAccountRole("colleague@example.com"), "editor");
    assert.equal(await updateAllowedAccountRole("missing@example.com", "viewer"), false);
    assert.equal(await removeAllowedEmail("colleague@example.com"), true);
    assert.equal(await getAccountRole("colleague@example.com"), null);
    assert.equal(await isEmailAllowed("colleague@example.com"), false);
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("role values fail closed and cannot be confused with emails or other input shapes", async () => {
  for (const bad of [undefined, "", false, null, {}, [], "administrator", "Editor", 1]) {
    assert.equal(isAccountRole(bad), false);
  }
  assert.equal(isAccountRole("editor"), true);
  assert.equal(isAccountRole("viewer"), true);
  assert.equal(await getAccountRole("invalid", [], async () => "editor"), null);
  assert.equal(await getAccountRole("viewer@example.com", [], async () => { throw Error("offline"); }), null);
  assert.equal(await getAccountRole("viewer@example.com", [], async () => "viewer"), "viewer");
  assert.equal(await getAccountRole("owner@example.com", ["owner@example.com"], async () => "viewer"), "editor");
});
