import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";

function load(path: string, mocks: Record<string, unknown>): any {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), {
    loader: path.endsWith(".tsx") ? "tsx" : "ts", format: "cjs", target: "es2022", jsx: "automatic",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports;
}

function fixture({ cookie = true, allowed = false, configured = true, anonymous = false } = {}) {
  class NextResponse extends Response {
    static next() { return new NextResponse(null, { headers: { "x-middleware-next": "1" } }); }
    static redirect(url: URL) { return new NextResponse(null, { status: 307, headers: { location: url.href } }); }
    static json(body: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(body), init); }
  }
  let cookieChecks = 0;
  let permissionChecks = 0;
  const session = { user: { email: "editor@example.com" } };
  const auth = {
    authConfigured: () => configured,
    middlewareAuth: async () => { cookieChecks++; return cookie ? session : null; },
    auth: async () => { permissionChecks++; return cookie && allowed ? session : null; },
  };
  const serverTr = async () => (s: string) => s;
  const middleware = load("../middleware.ts", {
    "next/server": { NextResponse }, "./auth": auth,
    "./lib/lang": { langOfRequest: () => "en" },
    "./lib/anonymous": { anonymousAllowed: () => anonymous },
  }).default;
  const redirect = (destination: string) => { throw new Error(`redirect:${destination}`); };
  const login = load("../app/login/page.tsx", {
    "../../auth": auth, "next/navigation": { redirect },
    "../../lib/i18n-server": { serverTr },
  }).default;
  const { requireAuth } = load("../lib/server.ts", {
    "next/server": { NextResponse }, "../auth": auth,
    "./i18n-server": { serverTr }, "./anonymous": { anonymousAllowed: () => anonymous },
  });
  const request = (path: string, method = "GET", headers: Record<string, string> = {}) => middleware({
    nextUrl: new URL(`https://editor.example${path}`), method, headers: new Headers(headers),
  });
  return {
    request, requireAuth,
    login: (error?: string) => login({ searchParams: Promise.resolve({ error }) }),
    get cookieChecks() { return cookieChecks; },
    get permissionChecks() { return permissionChecks; },
  };
}

test("a revoked user with an unexpired cookie can reach login after an API 401", async () => {
  const f = fixture();
  // ホームは、/api/sites が 401 を返すと /login へ移動する。
  // 古い Cookie は middleware の検証を通るが、API での現在の権限の確認で拒否される。
  assert.equal((await f.request("/")).status, 200);
  assert.equal((await f.requireAuth()).status, 401);
  const loginResponse = await f.request("/login");
  assert.equal(loginResponse.headers.get("location"), null, "must not bounce back to Home and loop");
  assert.equal(loginResponse.headers.get("x-middleware-next"), "1");
  assert.ok(await f.login(), "the Google sign-in form must remain accessible");
  assert.equal(f.permissionChecks, 2);
});

test("currently authorized users redirect from login only after the live server check", async () => {
  const f = fixture({ allowed: true });
  assert.equal((await f.request("/login")).headers.get("location"), null);
  assert.equal(f.cookieChecks, 0, "login routing should not depend on stale cookie-only permission");
  await assert.rejects(f.login(), /redirect:\//);
  assert.equal(f.permissionChecks, 1);
  assert.equal(await f.requireAuth(), null);
});

test("signed-out users still see login and protected pages/API requests remain blocked", async () => {
  const f = fixture({ cookie: false });
  assert.equal((await f.request("/")).headers.get("location"), "https://editor.example/login");
  assert.equal((await f.request("/api/sites")).status, 401);
  assert.equal((await f.request("/login")).status, 200);
  assert.ok(await f.login());
  assert.equal((await f.requireAuth()).status, 401);
});

test("login routing retains anonymous/setup behavior and cross-site write protection", async () => {
  assert.equal((await fixture({ configured: false }).request("/login")).status, 503);
  assert.equal((await fixture({ configured: false, anonymous: true }).request("/login")).headers.get("location"), "https://editor.example/");
  assert.equal((await fixture({ allowed: true }).request("/api/sites", "POST", { "sec-fetch-site": "cross-site" })).status, 403);
});


test("revoked sessions can see both access-denied and generic login errors", async () => {
  const text = (element: any): string => {
    if (element == null || typeof element === "boolean") return "";
    if (typeof element === "string" || typeof element === "number") return String(element);
    if (Array.isArray(element)) return element.map(text).join("");
    return text(element.props?.children);
  };
  for (const [error, expected] of [
    ["AccessDenied", "This Google account doesn't have access yet. Ask an administrator to add it."],
    ["OAuthCallbackError", "Couldn't sign in. Wait a moment and try again."],
  ]) {
    const f = fixture();
    assert.equal((await f.request(`/login?error=${error}`)).headers.get("location"), null);
    assert.ok(text(await f.login(error)).includes(expected));
  }
});
