import assert from "node:assert/strict";
import { test } from "node:test";
import {
  netlifyOAuthConfig, netlifyAccount, createNetlifyProject,
  verifyNetlifySite, deployNetlifyZip,
} from "../lib/netlify-publish";

function withConfig(run: () => void) {
  const names = ["PUBLISH_PROVIDER", "NETLIFY_OAUTH_CLIENT_ID", "NETLIFY_OAUTH_REDIRECT_URI"];
  const prior = Object.fromEntries(names.map(key => [key, process.env[key]]));
  try {
    process.env.PUBLISH_PROVIDER = "netlify";
    process.env.NETLIFY_OAUTH_CLIENT_ID = "registered-netlify-client-123456";
    process.env.NETLIFY_OAUTH_REDIRECT_URI = "https://tsumu.ebii.net/netlify/callback";
    run();
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
}

test("Netlify OAuth configuration never requires a Tsumu account, shared token, or encryption key", () => {
  withConfig(() => {
    assert.deepEqual(netlifyOAuthConfig(), {
      clientId: "registered-netlify-client-123456",
      redirectUri: "https://tsumu.ebii.net/netlify/callback",
    });
    process.env.NETLIFY_OAUTH_REDIRECT_URI = "https://attacker.test/other";
    assert.throws(netlifyOAuthConfig);
  });
});

test("Netlify client credential is scoped to the user-selected team", async () => {
  const original = globalThis.fetch;
  let created = false;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.equal(init?.headers instanceof Headers ? init.headers.get("Authorization") :
      (init?.headers as Record<string, string>)?.Authorization, "Bearer browser-token-1234567890");
    if (path.endsWith("/user")) return Response.json({ id: "user-12345678", email: "visitor@example.test" });
    if (path.endsWith("/accounts")) return Response.json([
      { id: "team-12345678", slug: "visitor-team", name: "Visitor's Team" },
    ]);
    if (path.endsWith("/visitor-team/sites")) {
      created = true;
      assert.equal(init?.method, "POST");
      return Response.json({
        id: "site-12345678", account_id: "team-12345678",
        ssl_url: "https://visitor-site.netlify.app",
      });
    }
    throw new Error("Unexpected Netlify API request: " + path);
  };
  try {
    const user = await netlifyAccount("browser-token-1234567890");
    assert.equal(user.teams[0].slug, "visitor-team");
    const project = await createNetlifyProject(
      "browser-token-1234567890", "local123456", "production", "visitor-team",
    );
    assert.equal(project.id, "site-12345678");
    assert.equal(project.teamId, "team-12345678");
    assert.equal(created, true);
    await assert.rejects(createNetlifyProject(
      "browser-token-1234567890", "local123456", "production", "different-team",
    ), /permission/);
  } finally { globalThis.fetch = original; }
});

test("Netlify never deploys files to a project outside the chosen team", async () => {
  const original = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/sites/site-12345678")) {
      return Response.json({
        id: "site-12345678", account_id: "other-team-87654321",
      });
    }
    uploads++;
    return Response.json({ id: "deploy-12345678" });
  };
  try {
    await assert.rejects(verifyNetlifySite(
      "browser-token-1234567890", "site-12345678", "team-12345678",
    ), /does not belong/);
    await assert.rejects(deployNetlifyZip(
      "browser-token-1234567890", "site-12345678", "team-12345678",
      new ArrayBuffer(8),
    ), /does not belong/);
    assert.equal(uploads, 0);
  } finally { globalThis.fetch = original; }
});

test("Netlify account APIs never accept arbitrary URL paths or an invalid token", async () => {
  const { netlifyApi } = await import("../lib/netlify-publish");
  await assert.rejects(netlifyApi("short", "/sites"), /Invalid Netlify access token/);
  await assert.rejects(netlifyApi("browser-token-1234567890", "//attacker.test"), /Invalid Netlify API path/);
});
