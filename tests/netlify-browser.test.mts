import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishNetlifyOAuth, startNetlifyOAuth, readNetlifyAccount,
  readNetlifySite, saveNetlifySite, saveNetlifyProject, disconnectNetlifySite,
} from "../lib/browser-netlify";

function memoryStorage() {
  const contents = new Map<string, string>();
  return {
    getItem: (key: string) => contents.get(key) ?? null,
    setItem: (key: string, value: string) => { contents.set(key, value); },
    removeItem: (key: string) => { contents.delete(key); },
    clear: () => contents.clear(),
  };
}

test("Netlify OAuth state is bound to the originating tab and local site and consumed once", () => {
  const saved = {
    window: (globalThis as { window?: unknown }).window,
    localStorage: (globalThis as { localStorage?: unknown }).localStorage,
    sessionStorage: (globalThis as { sessionStorage?: unknown }).sessionStorage,
  };
  let destination = "";
  (globalThis as { window?: unknown }).window = {
    location: { origin: "https://tsumu.example.test", assign: (next: string) => { destination = next; } },
  };
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = memoryStorage();
  try {
    startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://tsumu.example.test/netlify/callback",
    });
    const authorize = new URL(destination);
    assert.equal(authorize.origin, "https://app.netlify.com");
    assert.equal(authorize.searchParams.get("response_type"), "token");
    assert.equal(authorize.searchParams.get("client_id"), "registered-client-123456");
    const state = authorize.searchParams.get("state")!;
    assert.throws(() => finishNetlifyOAuth("different", "opaque-oauth-token-1234567"), /did not match/);
    assert.equal(readNetlifyAccount(), null, "mismatched redirects must not persist tokens");
    startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://tsumu.example.test/netlify/callback",
    });
    const goodState = new URL(destination).searchParams.get("state")!;
    assert.equal(finishNetlifyOAuth(goodState, "opaque-oauth-token-1234567"), "local123456");
    assert.equal(readNetlifyAccount()?.token, "opaque-oauth-token-1234567");
    assert.throws(() => finishNetlifyOAuth(goodState, "opaque-oauth-token-1234567"), /did not match/);
    assert.throws(() => startNetlifyOAuth("local123456", {
      clientId: "registered-client-123456",
      redirectUri: "https://attacker.example/netlify/callback",
    }), /does not match/);
  } finally {
    (globalThis as { window?: unknown }).window = saved.window;
    (globalThis as { localStorage?: unknown }).localStorage = saved.localStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = saved.sessionStorage;
  }
});

test("Netlify project IDs are pinned to one browser site and never silently replaced", () => {
  const saved = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  try {
    saveNetlifySite("local123456", {
      userId: "user-12345678", teamId: "team-12345678",
      teamSlug: "own-team", production: null, test: null,
    });
    saveNetlifyProject("local123456", "production", {
      id: "site-12345678", url: "https://site.netlify.app",
    });
    assert.equal(readNetlifySite("local123456")?.production?.id, "site-12345678");
    assert.equal(readNetlifySite("another12345"), null);
    assert.throws(() => saveNetlifyProject("local123456", "production", {
      id: "site-22222222", url: "https://other.netlify.app",
    }), /already linked/);
    disconnectNetlifySite("local123456");
    assert.equal(readNetlifySite("local123456"), null);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = saved;
  }
});
