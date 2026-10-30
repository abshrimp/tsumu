import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  encryptNetlifyToken,
  decryptNetlifyToken,
  netlifyOAuthUrl,
  bindNetlifyTeam,
  type NetlifyTeam,
} from "../lib/netlify-account";
import type { Db } from "../lib/db";

test("Netlify authorization URL uses a one-time state and the exact registered callback", () => {
  const previous = {
    client: process.env.NETLIFY_OAUTH_CLIENT_ID,
    redirect: process.env.NETLIFY_OAUTH_REDIRECT_URI,
    encryption: process.env.NETLIFY_TOKEN_ENCRYPTION_KEY,
  };
  try {
    process.env.NETLIFY_OAUTH_CLIENT_ID = "registered-client-123456";
    process.env.NETLIFY_OAUTH_REDIRECT_URI = "https://tsumu.example.test/netlify/callback";
    process.env.NETLIFY_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const state = "5b72aa34-161b-4ce0-94a8-4b72727691ae";
    const url = new URL(netlifyOAuthUrl(state));
    assert.equal(url.origin, "https://app.netlify.com");
    assert.equal(url.pathname, "/authorize");
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(url.searchParams.get("response_type"), "token");
    assert.equal(url.searchParams.get("redirect_uri"), "https://tsumu.example.test/netlify/callback");
    assert.throws(() => netlifyOAuthUrl("attacker"));
  } finally {
    if (previous.client === undefined) delete process.env.NETLIFY_OAUTH_CLIENT_ID;
    else process.env.NETLIFY_OAUTH_CLIENT_ID = previous.client;
    if (previous.redirect === undefined) delete process.env.NETLIFY_OAUTH_REDIRECT_URI;
    else process.env.NETLIFY_OAUTH_REDIRECT_URI = previous.redirect;
    if (previous.encryption === undefined) delete process.env.NETLIFY_TOKEN_ENCRYPTION_KEY;
    else process.env.NETLIFY_TOKEN_ENCRYPTION_KEY = previous.encryption;
  }
});

test("Netlify tokens are sealed with AES-GCM and bound to a particular Tsumu email", async () => {
  const previous = process.env.NETLIFY_TOKEN_ENCRYPTION_KEY;
  process.env.NETLIFY_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const token = "opaque-oauth-access-token-" + randomBytes(12).toString("hex");
    const first = await encryptNetlifyToken(token, "owner@example.test");
    const second = await encryptNetlifyToken(token, "owner@example.test");
    assert.notEqual(first, second);
    assert.equal(first.includes(token), false);
    assert.equal(await decryptNetlifyToken(first, "owner@example.test"), token);
    await assert.rejects(decryptNetlifyToken(first, "different@example.test"));
    await assert.rejects(decryptNetlifyToken(first.slice(0, -4) + "AAAA", "owner@example.test"));
    await assert.rejects(encryptNetlifyToken("too short", "owner@example.test"));
  } finally {
    if (previous === undefined) delete process.env.NETLIFY_TOKEN_ENCRYPTION_KEY;
    else process.env.NETLIFY_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("Netlify team changes cannot reassign existing published projects across owners", async () => {
  const teamA: NetlifyTeam = { id: "team-uuid-12345678", slug: "account-a", name: "A" };
  const teamB: NetlifyTeam = { id: "team-uuid-87654321", slug: "account-b", name: "B" };
  const binding = {
    site_id: "abc1234567", owner_email: "owner@example.test",
    team_id: teamA.id, team_slug: teamA.slug,
    production_site_id: "site-uuid-12345678", preview_site_id: null,
    production_url: "https://example.netlify.app", preview_url: null,
  };
  const sqlCalls: string[] = [];
  const db: Db = {
    backend: "d1",
    async execute(stmt) {
      const sql = typeof stmt === "string" ? stmt : stmt.sql;
      sqlCalls.push(sql);
      return { rows: sql.startsWith("SELECT site_id") ? [binding] : [], rowsAffected: 0 };
    },
    async batch() { throw new Error("Unexpected batch"); },
  };
  await assert.rejects(bindNetlifyTeam(db, binding.site_id, "other@example.test", teamA),
    /already been deployed/);
  await assert.rejects(bindNetlifyTeam(db, binding.site_id, "owner@example.test", teamB),
    /already been deployed/);
  assert.equal(sqlCalls.some((sql) => sql.startsWith("INSERT")), false);
});
