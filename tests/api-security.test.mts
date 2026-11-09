import { describe, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { addAllowedEmail, allowedEmails, getAccountRole, isAccountRole, isEmailAllowed, listAllowedAccounts, removeAllowedEmail, updateAllowedAccountRole } from "../lib/allowlist";
import { fileURLToPath, urlToHttpOptions } from "node:url";
import { transformSync } from "./helpers/bundle";
import { isValidEmail } from "../lib/email";
import { anonymousAllowed, anonymousHostAllowed, isLoopbackHost } from "../lib/anonymous";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited } from "../lib/api-json";
import { parseActivityUser, type ActivityUser } from "../lib/activity";
import { parseAiRequest, readAiRequest } from "../lib/ai/request";
import { AI_STREAM_TYPE, readAiResponse, type AiProgress } from "../lib/ai/progress";
import { type runAi } from "../lib/ai/run";
import { authCallbacks } from "../lib/auth-policy";
import { isCrossSiteWrite } from "../lib/csrf";
import { NextRequest, NextResponse } from "next/server";
import { PassThrough } from "node:stream";
import { type Rewrite, type Redirect } from "next/dist/lib/load-custom-routes";
import { type FsOutput } from "next/dist/server/lib/router-utils/filesystem";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import { type Page, type SiteDoc } from "../lib/types";
import { assertPublicUrl, BlockedUrlError, fetchPublic, isPrivateHost, readTextLimited, TooLargeError } from "../lib/safe-fetch";
import { activeContentNames, isOwnClip, parseClipPayload } from "../lib/clip-transfer";
import { normalizeSiteInput } from "../lib/site-model";
import { githubClient } from "../lib/github";
import { makeBox } from "../lib/presets";
import { getDbFromBinding } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";

describe("account-roles", () => {
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

test("sole site owners cannot be deleted from allowed accounts until ownership is shared", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-sole-owner-"));
  const original = { TSUMU_DATA_DIR: process.env.TSUMU_DATA_DIR, ALLOWED_EMAILS: process.env.ALLOWED_EMAILS };
  process.env.TSUMU_DATA_DIR = dir;
  process.env.ALLOWED_EMAILS = "admin@example.com";
  try {
    await addAllowedEmail("creator@example.com", "editor");
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "owned-site", {
      name: "Owned", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
    }, "creator@example.com");
    assert.equal(await removeAllowedEmail("creator@example.com"), "sole-owner");
    assert.equal(await isEmailAllowed("creator@example.com"), true);

    await db.execute({
      sql: "INSERT INTO site_members(site_id,email,role) VALUES('owned-site','admin@example.com','owner')",
      args: [],
    });
    assert.equal(await removeAllowedEmail("creator@example.com"), true);
    assert.equal(await isEmailAllowed("creator@example.com"), false);
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
});

describe("api-auth-runtime", () => {
describe("api-auth-runtime", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const apiDir = join(root, "app/api");

  function routes(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? routes(path) :
        entry.isFile() && entry.name === "route.ts" ? [path] : [];
    });
  }

  class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(body), init);
    }
  }

  /** 実際のルートのハンドラーを読み込み、サーバーとの境界だけを、拒否されたセッションに置き換える。 */
  function deniedRoute(path: string, status: number) {
    const code = transformSync(readFileSync(path, "utf8"), {
      loader: "ts", format: "cjs", target: "es2022",
    }).code;
    const module = { exports: {} as Record<string, unknown> };
    let checks = 0;
    const shared: Record<string, unknown> = {
      NextResponse, isValidEmail, envVar: () => undefined,
      requireAuth: async () => {
        checks++;
        return NextResponse.json({ error: "Access denied" }, { status });
      },
      serverTr: async () => (s: string) => s,
      verifyAssetToken: async () => false,
      authConfigured: () => status !== 503,
      auth: async () => {
        checks++;
        return null;
      },
    };
    new Function("require", "module", "exports", code)(
      (_id: string) => new Proxy({}, {
        get: (_target, field: string | symbol) =>
          typeof field === "string" ? shared[field] : undefined,
      }),
      module, module.exports,
    );
    return {
      handlers: module.exports,
      get checks() { return checks; },
    };
  }

  test("all API handlers reject unauthenticated sessions before reading or writing data", async () => {
    let verified = 0;
    for (const file of routes(apiDir)) {
      const name = relative(apiDir, file).replaceAll("\\", "/");
      if (name === "auth/[...nextauth]/route.ts") continue; // ログインと OAuth のコールバックは公開されている
      const route = deniedRoute(file, 401);
      const methods = Object.keys(route.handlers).filter(m => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m));
      assert.ok(methods.length > 0, name + " must expose an HTTP method");
      for (const method of methods) {
        const handler = route.handlers[method] as (request: Request, context: unknown) => Promise<Response>;
        const endpoint = "/api/" + name.slice(0, -"/route.ts".length).replace("[id]", "site");
        const request = new Request("https://editor.example.test" + endpoint, { method });
        const context = { params: Promise.resolve({ id: "site" }) };
        const response = await handler(request, context);
        assert.equal(response.status, 401, name + " " + method + " must deny an unsigned user");
        verified++;
      }
      assert.ok(route.checks > 0, name + " must actually check current auth state");
    }
    assert.ok(verified >= 30, "unexpectedly missing API methods");
  });

  test("routes deny an unconfigured auth provider when anonymous mode is disabled", async () => {
    let verified = 0;
    for (const file of routes(apiDir)) {
      const name = relative(apiDir, file).replaceAll("\\", "/");
      if (name === "auth/[...nextauth]/route.ts") continue;
      const route = deniedRoute(file, 503);
      const method = route.handlers.GET ? "GET" : route.handlers.POST ? "POST" : "PATCH";
      const handler = route.handlers[method] as (request: Request, context: unknown) => Promise<Response>;
      const endpoint = "/api/" + name.slice(0, -"/route.ts".length).replace("[id]", "site");
      const response = await handler(
        new Request("https://editor.example.test" + endpoint, { method }),
        { params: Promise.resolve({ id: "site" }) },
      );
      assert.equal(response.status, 503, name + " must reject an unavailable auth provider");
      verified++;
    }
    assert.ok(verified >= 17);
  });
});

describe("anonymous", () => {
  function withEnv(env: Record<string, string | undefined>, run: () => void) {
    const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    try {
      for (const [k, v] of Object.entries(env)) set(k, v);
      run();
    } finally {
      for (const [k, v] of Object.entries(prev)) set(k, v);
    }
  }

  test("ログインなしで開けるのは npm run dev か ALLOW_ANONYMOUS=true のときだけ", () => {
    withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: undefined }, () => assert.equal(anonymousAllowed(), false));
    withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: "1" }, () => assert.equal(anonymousAllowed(), false));
    withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: "true" }, () => assert.equal(anonymousAllowed(), true));
    withEnv({ NODE_ENV: "development", ALLOW_ANONYMOUS: undefined }, () => assert.equal(anonymousAllowed(), true));
  });

  test("設定なしの npm run dev は localhost 宛てだけを受け付ける（DNS rebinding 対策）", () => {
    for (const host of ["localhost:3000", "LOCALHOST", "app.localhost:3000", "127.0.0.1:3000", "127.1.2.3", "[::1]:3000"]) {
      assert.equal(isLoopbackHost(host), true, host);
    }
    for (const host of ["attacker.example:3000", "localhost.attacker.example", "127.0.0.1.nip.io", "127.0.0.256", "192.168.1.5:3000", "[::2]"]) {
      assert.equal(isLoopbackHost(host), false, host);
    }
    withEnv({ NODE_ENV: "development", ALLOW_ANONYMOUS: undefined }, () => {
      assert.equal(anonymousHostAllowed("localhost:3000"), true);
      assert.equal(anonymousHostAllowed("attacker.example:3000"), false);
      assert.equal(anonymousHostAllowed(null), false);
    });
    // 明示したログインなしや、本番のビルドでは Host を制限しない（デモを公開するため）。
    withEnv({ NODE_ENV: "development", ALLOW_ANONYMOUS: "true" }, () => assert.equal(anonymousHostAllowed("192.168.1.5:3000"), true));
    withEnv({ NODE_ENV: "production", ALLOW_ANONYMOUS: "true" }, () => assert.equal(anonymousHostAllowed("demo.example"), true));
  });
});

describe("api-auth-coverage", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const apiDir = join(root, "app/api");

  function routes(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? routes(path) : entry.isFile() && entry.name === "route.ts" ? [path] : [];
    });
  }

  test("every API route has a declared authorization boundary", () => {
    const found = routes(apiDir);
    assert.ok(found.length >= 18, "unexpectedly missing route files");
    for (const path of found) {
      const name = relative(root, path).replaceAll("\\", "/");
      const source = readFileSync(path, "utf8");
      if (name === "app/api/auth/[...nextauth]/route.ts") {
        assert.match(source, /authConfigured\s*\(/, name);
        assert.match(source, /handlers\.(?:GET|POST)/, name);
      } else if (name === "app/api/allowed-users/route.ts") {
        assert.match(source, /requireMe\s*\(/, name);
        assert.match(source, /authConfigured\s*\(/, name);
        assert.match(source, /await auth\s*\(/, name);
      } else {
        assert.match(source, /requireAuth\s*\(/, name);
      }
      if (name === "app/api/assets/file/route.ts") {
        assert.match(source, /verifyAssetToken\s*\(/, name);
      }
    }
  });

  test("HTTP and WebSocket public entrypoints keep separate CSRF/origin checks", () => {
    const proxy = readFileSync(join(root, "proxy.ts"), "utf8");
    const worker = readFileSync(join(root, "custom-worker.ts"), "utf8");
    assert.match(proxy, /pathname\.startsWith\("\/api\/"\)\s*&&\s*isCrossSiteWrite\s*\(/);
    assert.match(worker, /request\.headers\.get\("Origin"\)\s*!==\s*url\.origin/);
  });
});

describe("allowed-accounts-lifecycle", () => {
  function fixture() {
    const path = resolve("components/AllowedAccounts.tsx"), require = createRequire(path);
    const cells: any[] = [], cleanups: any[] = [], calls: any[] = [], confirmations: any[] = [];
    let cursor = 0;
    const react = {
      useState(initial: any) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], (v: any) => { cells[i] = typeof v === "function" ? v(cells[i]) : v; }]; },
      useRef(initial: any) { const i = cursor++; return cells[i] ??= { current: initial }; },
      useEffect(effect: any) { const i = cursor++; if (!(i in cells)) { cells[i] = true; cleanups.push(effect()); } },
    };
    const users = { me: "me@example.com", fixed: [], extra: [{ email: "other@example.com", role: "viewer" }] };
    const fetch = (url: string, init?: any) => {
      if (!init) return Promise.resolve({ ok: true, json: async () => users });
      return new Promise(resolve => calls.push({ url, init, resolve: () => resolve({ ok: true, json: async () => users }) }));
    };
    const mod = { exports: {} as any };
    const code = transformSync(readFileSync(path, "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", "fetch", code)((id: string) => id === "react" ? react :
      id === "../lib/dialog" ? { showConfirm: () => new Promise(resolve => confirmations.push(resolve)) } :
      id === "../lib/i18n" ? { tr: (v: string) => v } : require(id), mod, mod.exports, fetch);
    const flatten = (v: any): any[] => Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === "object" ? [v, ...flatten(v.props?.children)] : [];
    const render = () => { cursor = 0; const items = flatten(mod.exports.default()); return {
      input: items.find(e => e.type === "input"), add: items.find(e => e.type === "button" && e.props.children === "Add"),
      remove: items.find(e => e.type === "button" && e.props["aria-label"] === "Remove sign-in access"),
    }; };
    const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    return { calls, confirmations, render, settle, unmount: () => cleanups.forEach(fn => fn?.()) };
  }
  test("dismissed account settings cannot revoke a login after its confirmation resolves", async () => {
    const f = fixture(); f.render(); await f.settle();
    f.render().remove.props.onClick(); f.unmount(); f.confirmations[0](true); await f.settle();
    assert.equal(f.calls.length, 0);
  });
  test("pending revocation owns the operation before its confirmation, including stale callbacks", async () => {
    const f = fixture(); f.render(); await f.settle();
    const row = f.render().remove; row.props.onClick(); row.props.onClick();
    assert.equal(f.confirmations.length, 1);
    f.confirmations[0](false); await f.settle();
    assert.equal(f.render().remove.props.disabled, false);
  });
  test("account additions preserve text typed while the preceding request is pending", async () => {
    const f = fixture(); f.render(); await f.settle();
    f.render().input.props.onChange({ target: { value: "first@example.com" } });
    const add = f.render().add; add.props.onClick(); add.props.onClick();
    assert.equal(f.calls.length, 1);
    f.render().input.props.onChange({ target: { value: "next@example.com" } });
    f.calls[0].resolve(); await f.settle();
    assert.equal(f.render().input.props.value, "next@example.com");
    assert.equal(f.render().add.props.disabled, false);
  });
});

describe("allowed-users-errors", () => {
  function fixture(failRefresh: boolean) {
    class NextResponse extends Response {
      static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
    }
    const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/allowed-users/route.ts", import.meta.url), "utf8"))
      .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
    let changed = false;
    const emails = new Set<string>();
    const injected = {
      NextResponse, isValidEmail, JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited, envVar: () => undefined, dbUnavailable: () => { throw new Error("Unexpected unavailable"); },
      serverTr: async () => (value: string) => value,
      allowedEmails: () => ["owner@example.com"], auth: async () => ({ user: { email: "owner@example.com" } }), authConfigured: () => true,
      dbConfigured: () => true, userMessage: (_error: unknown, fallback: string) => fallback,
      getAccountRole: async () => "editor", isAccountRole: (role: unknown) => role === "editor" || role === "viewer",
      listAllowedAccounts: async () => { if (changed && failRefresh) throw new Error("Temporary database read failure"); return [...emails].map((email) => ({ email, role: "editor" })); },
      updateAllowedAccountRole: async () => false,
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
        method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "editor@example.com", role: "editor" }) } : {}),
      });
      const response = await api[method](req);
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, method === "POST" ? "Couldn't save" : "Couldn't delete");
      assert.equal(emails.has("editor@example.com"), method === "POST", "the mutation already completed before refresh failed");
    });
    test(`${method} still returns the updated account list when refresh succeeds`, async () => {
      const { api, emails } = fixture(false);
      if (method === "DELETE") emails.add("editor@example.com");
      const response = await api[method](new Request("https://example.test/api/allowed-users?email=editor%40example.com", {
        method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "editor@example.com", role: "editor" }) } : {}),
      }));
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).extra, method === "POST" ? [{ email: "editor@example.com", role: "editor" }] : []);
    });
  }


  test("DELETE rejects duplicate email selectors before attempting any mutation", async () => {
    const { api, emails } = fixture(false);
    emails.add("editor@example.com");
    const response = await api.DELETE(new Request(
      "https://example.test/api/allowed-users?email=editor%40example.com&email=owner%40example.com",
      { method: "DELETE" },
    ));
    assert.equal(response.status, 400);
    assert.equal(emails.has("editor@example.com"), true);
  });
});

describe("allowed-users-shapes", () => {
  function fixture(identity: unknown = "owner@example.com") {
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
        auth: async () => ({ user: { email: identity } }),
      },
      "../../../lib/i18n-server": { serverTr: async () => (s: string) => s },
      "../../../lib/unavailable": { dbUnavailable: async () => NextResponse.json({}, { status: 503 }) },
      "../../../lib/email": { isValidEmail },
      "../../../lib/db": { dbConfigured: () => true },
      "../../../lib/env": { envVar: () => undefined },
      "../../../lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited },
      "../../../lib/errors": { userMessage: (_e: unknown, fallback: string) => fallback },
      "../../../lib/allowlist": {
        allowedEmails: () => ["owner@example.com"],
        addAllowedEmail: async (email: string) => { inserted.push(email); },
        listAllowedAccounts: async () => inserted.map((email) => ({ email, role: "editor" })),
        getAccountRole: async () => "editor",
        isAccountRole: (role: unknown) => role === "editor" || role === "viewer",
        updateAllowedAccountRole: async () => false,
        removeAllowedEmail: async () => false,
      },
    };
    new Function("require", "module", "exports", code)(
      (id: string) => injected[id], module, module.exports,
    );
    const POST = module.exports.POST as (req: Request) => Promise<Response>;
    const PATCH = module.exports.PATCH as (req: Request) => Promise<Response>;
    const DELETE = module.exports.DELETE as (req: Request) => Promise<Response>;
    const GET = module.exports.GET as () => Promise<Response>;
    const send = (value: unknown, contentType = "application/json") => POST(new Request("https://editor.example.test/api/allowed-users", {
      method: "POST", body: JSON.stringify(value),
      headers: { "Content-Type": contentType },
    }));
    const patch = (value: unknown) => PATCH(new Request("https://editor.example.test/api/allowed-users", {
      method: "PATCH", body: JSON.stringify(value),
      headers: { "Content-Type": "application/json" },
    }));
    const del = (email: string) => DELETE(new Request(`https://editor.example.test/api/allowed-users?email=${encodeURIComponent(email)}`, {
      method: "DELETE",
    }));
    return {
      send, patch, del, get: () => GET(), inserted,
      setRemoveResult(result: boolean | "sole-owner") {
        (injected["../../../lib/allowlist"] as Record<string, unknown>).removeAllowedEmail = async () => result;
      },
    };
  }

  test("account allowlist API rejects unexpected JSON field types without writes", async () => {
    const f = fixture();
    for (const value of [
      null, [], {}, { email: null }, { email: 1 }, { email: true },
      { email: ["attacker@example.com"] }, { email: { address: "attacker@example.com" } },
      { email: "attacker@example.com", role: null }, { email: "attacker@example.com", role: "owner" },
    ]) {
      assert.equal((await f.send(value)).status, 400, JSON.stringify(value));
    }
    assert.deepEqual(f.inserted, []);
  });

  test("account allowlist API still accepts a normalized string email address", async () => {
    const f = fixture();
    const response = await f.send({ email: " Editor@Example.com ", role: "viewer" });
    assert.equal(response.status, 200);
    assert.deepEqual(f.inserted, ["editor@example.com"]);
  });


  test("account allowlist API rejects oversized JSON before changing permissions", async () => {
    const f = fixture();
    const response = await f.send({ email: "attacker@example.com", role: "editor", padding: "x".repeat(32 * 1024) });
    assert.equal(response.status, 413);
    assert.deepEqual(f.inserted, []);
  });

  test("account management rejects sessions without a valid email identity", async () => {
    for (const identity of [null, "", "  ", 123, {}, []]) {
      const f = fixture(identity);
      const get = await f.get();
      assert.equal(get.status, 401, `GET with ${JSON.stringify(identity)}`);
      const post = await f.send({ email: "editor@example.com", role: "editor" });
      assert.equal(post.status, 401, `POST with ${JSON.stringify(identity)}`);
      assert.deepEqual(f.inserted, []);
    }
  });


  test("account management rejects text/plain POST even if the bytes are JSON", async () => {
    const f = fixture();
    const response = await f.send({ email: "editor@example.com", role: "editor" }, "text/plain");
    assert.equal(response.status, 415);
    assert.deepEqual(f.inserted, []);
  });

  test("dynamic editor accounts not in ALLOWED_EMAILS cannot manage allowed accounts", async () => {
    const f = fixture("dynamic-editor@example.com");
    assert.equal((await f.get()).status, 403);
    assert.equal((await f.send({ email: "another@example.com", role: "editor" })).status, 403);
    assert.equal((await f.patch({ email: "another@example.com", role: "viewer" })).status, 403);
    assert.equal((await f.del("another@example.com")).status, 403);
    assert.deepEqual(f.inserted, []);
  });

  test("DELETE returns 409 when removing the sole owner of a site", async () => {
    const f = fixture("owner@example.com");
    f.setRemoveResult("sole-owner");
    const res = await f.del("creator@example.com");
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "A site must always have at least one owner");
  });
});
});

describe("api-author-identity", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), init);
  }
}

function load(path: string, imports: Record<string, unknown>) {
  const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? imports[key] : undefined }),
    module, module.exports,
  );
  return module.exports;
}

const identity = { email: "editor@example.test", name: "Editor", image: null };
function fixture(mode: "signed-in" | "anonymous" | "denied") {
  let authCalls = 0;
  let saves = 0;
  const authors: (ActivityUser | null)[] = [];
  const shared: Record<string, unknown> = {
    NextResponse, parseActivityUser, readJsonLimited, readJsonObjectLimited, jsonErrorStatus, JsonBodyTooLargeError, JsonContentTypeError,
    envVar: () => undefined,
    serverTr: async () => (value: string) => value,
    authConfigured: () => mode !== "anonymous",
    allowedEmails: () => [],
    getAccountRole: async () => "editor",
    requireSiteAccess: async () => null,
    anonymousAllowed: () => mode === "anonymous",
    auth: async () => {
      authCalls++;
      // 2回目の参照では、別のセッションや期限切れのセッションが返ることがある。
      // 投稿者には、このリクエストを認可した利用者を使わなければならない。
      return mode === "signed-in" && authCalls === 1
        ? { user: { email: "Editor@example.test", name: " Editor " } } : null;
    },
    dbConfigured: () => true,
    collabRoomAvailable: () => false,
    getDb: async () => ({ backend: "sqlite" }),
    assetStore: () => null,
    siteIdOf: async () => "site",
    getSite: async () => ({ id: "site" }),
    validateDocValue: () => null,
    isDocPatch: (value: unknown) => Array.isArray(value),
    extractAssetReferences: () => [],
    siteOwnsAssets: async () => true,
    recordActivity: async (_db: unknown, _site: string, _kind: string, user: ActivityUser | null) => { authors.push(user); },
    notifyDocUpdated: () => {},
  };
  for (const name of ["saveSiteDocumentWithTarget", "patchSiteDocumentWithTarget"]) {
    shared[name] = async () => {
      saves++;
      return { result: { kind: "saved", rev: "2", savedAt: 123 }, roomKey: null };
    };
  }
  Object.assign(shared, load("../lib/server.ts", shared));
  return {
    doc: load("../app/api/doc/route.ts", shared),
    status: load("../app/api/status/route.ts", shared),
    authors,
    get authCalls() { return authCalls; },
    get saves() { return saves; },
  };
}

for (const method of ["PUT", "PATCH", "status"] as const) {
  for (const mode of ["signed-in", "anonymous", "denied"] as const) {
    test(`${method} uses one authorization result for ${mode} identity`, async () => {
      const f = fixture(mode);
      const response = method === "status" ? await f.status.GET() : await f.doc[method](new Request(
        "https://editor.example.test/api/doc?site=site&base=1", {
          method, headers: { "Content-Type": "application/json" },
          body: JSON.stringify(method === "PATCH" ? [] : {}),
        },
      ));
      assert.equal(response.status, mode === "denied" ? 401 : 200);
      assert.equal(f.authCalls, mode === "anonymous" ? 0 : 1);
      if (mode === "denied") {
        assert.equal(f.saves, 0);
        assert.deepEqual(f.authors, []);
      } else if (method === "status") {
        assert.deepEqual((await response.json()).user, mode === "signed-in" ? identity : null);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      } else {
        assert.equal(f.saves, 1);
        assert.deepEqual(f.authors, [mode === "signed-in" ? identity : null]);
      }
    });
  }
}
});

describe("api-json-endpoints", () => {
class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

function load(path: string, mocks: Record<string, unknown>) {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  });
  const module = { exports: {} as { POST: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  return module.exports.POST;
}

const inputs = {
  "fetch-json": { url: "https://remote.example.test/data" },
  ai: {
    messages: [{ role: "user", text: "Change the page" }],
    context: {
      doc: {
        siteName: "Test", pageOrder: ["home"], assets: {}, nodes: {},
        pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: [] } },
      },
      target: { pageId: "home" },
    },
  },
} as const;

function fixture(route: keyof typeof inputs, authorized = true, model?: typeof runAi) {
  let calls = 0;
  const common = {
    "next/server": { NextResponse },
    "../../../lib/i18n-server": { serverTr: async () => (value: string) => value },
    "../../../lib/server": { requireAuth: async () => authorized ? null : NextResponse.json({}, { status: 401 }) },
    "../../../lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited },
  };
  const POST = route === "fetch-json" ? load("../app/api/fetch-json/route.ts", {
    ...common,
    "../../../lib/safe-fetch": {
      BlockedUrlError: class extends Error {}, TooLargeError: class extends Error {},
      fetchPublic: async () => { calls++; return Response.json({ message: "日本語" }); },
      readTextLimited: async (res: Response) => res.text(),
    },
  }) : load("../app/api/ai/route.ts", {
    ...common,
    "../../../lib/ai/request": { parseAiRequest, readAiRequest },
    "../../../lib/ai/config": { aiConfig: () => ({ enabled: true }) },
    "../../../lib/ai/run": {
      AiApiError: class extends Error {},
      runAi: async (...args: Parameters<typeof runAi>) => {
        calls++;
        return model ? model(...args) : "Done";
      },
    },
  });
  return { POST, get calls() { return calls; }, maxBytes: (route === "ai" ? 4 : 2) * 1024 * 1024 };
}

for (const accept of [AI_STREAM_TYPE, "application/json", null]) {
  test(`AI returns the same progress stream regardless of Accept: ${accept}`, async () => {
    const events: AiProgress[] = [];
    const f = fixture("ai", true, async (_conf, _turns, _tool, _signal, onProgress) => {
      assert.ok(onProgress, "the current endpoint always enables model progress");
      onProgress({ type: "text", text: "Working", turn: 1 });
      return "Done";
    });
    const req = request("ai");
    if (accept !== null) req.headers.set("accept", accept);
    const res = await f.POST(req);
    assert.ok(res.headers.get("content-type")?.startsWith(AI_STREAM_TYPE));
    assert.deepEqual(await readAiResponse(res, event => events.push(event)), { reply: "Done", operations: [] });
    assert.deepEqual(events.map(event => event.type), ["phase", "text"]);
    assert.equal(f.calls, 1);
  });
}

test("fetch-json checks the UTF-8 byte length of the outgoing body", async () => {
  const f = fixture("fetch-json");
  const exact = "日".repeat(Math.floor((1024 * 1024) / 3)) + "a";
  const post = (body: string) => f.POST(request("fetch-json",
    JSON.stringify({ ...inputs["fetch-json"], method: "POST", body })));
  assert.equal((await post(exact)).status, 200);
  const oversized = await post(exact + "a");
  assert.equal(oversized.status, 400);
  assert.equal(f.calls, 1);
});

test("AI stream cancellation aborts the in-flight model without an Accept header", async () => {
  let aborted = false;
  const f = fixture("ai", true, async (_conf, _turns, _tool, signal) => {
    assert.ok(signal);
    return new Promise(resolve => signal.addEventListener("abort", () => {
      aborted = true;
      resolve(null);
    }, { once: true }));
  });
  const res = await f.POST(request("ai"));
  await res.body!.cancel();
  assert.equal(aborted, true);
  assert.equal(f.calls, 1);
});

test("AI provider failures use the current stream error contract", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture("ai", true, async () => { throw new Error("private provider failure details"); });
  const res = await f.POST(request("ai"));
  await assert.rejects(readAiResponse(res, () => {}), /^Error: Couldn't reach AI$/);
  assert.equal(f.calls, 1);
});

function request(route: keyof typeof inputs, body: BodyInit | null = JSON.stringify(inputs[route]), headers: HeadersInit = { "Content-Type": "application/json" }) {
  return new Request("https://editor.example.test/api/" + route, {
    method: "POST", body, headers, duplex: "half",
  } as RequestInit);
}

async function timely(pending: Promise<Response>): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("request waited for body cleanup")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

for (const route of ["fetch-json", "ai"] as const) {
  test(`${route} accepts editor JSON, case-insensitive MIME parameters and absent MIME`, async () => {
    const f = fixture(route);
    for (const mime of ["application/json", "Application/JSON; charset=utf-8", null]) {
      const req = request(route);
      if (mime === null) req.headers.delete("content-type");
      else req.headers.set("content-type", mime);
      const res = await f.POST(req);
      assert.equal(res.status, 200);
      assert.deepEqual(route === "ai" ? await readAiResponse(res, () => {}) : await res.json(), route === "ai"
        ? { reply: "Done", operations: [] } : { ok: true, json: { message: "日本語" } });
    }
    assert.equal(f.calls, 3);
  });

  test(`${route} rejects wrong MIME and malformed JSON without downstream requests`, async () => {
    const f = fixture(route);
    for (const mime of ["text/plain", "application/x-www-form-urlencoded", "application/problem+json"]) {
      assert.equal((await f.POST(request(route, JSON.stringify(inputs[route]), { "Content-Type": mime }))).status, 415);
    }
    const invalidBodies = route === "fetch-json"
      ? ["{broken", "null", "[]", "{}", '{"method":{},"url":"https://example.org"}', null]
      : ["{broken", "null", "[]", "{}", null];
    for (const value of invalidBodies) {
      assert.equal((await f.POST(request(route, value))).status, 400);
    }
    const invalidLength = request(route);
    invalidLength.headers.set("Content-Length", "invalid");
    assert.equal((await f.POST(invalidLength)).status, 400);
    assert.equal(f.calls, 0);
  });

  test(`${route} authenticates before reading or contacting downstream`, async () => {
    const f = fixture(route, false);
    const req = request(route);
    assert.equal((await f.POST(req)).status, 401);
    assert.equal(req.bodyUsed, false);
    assert.equal(f.calls, 0);
  });

  for (const declared of [false, true]) test(`${route} returns 413 for a cloned ${declared ? "declared" : "streamed"} oversized body without waiting`, async (t) => {
    const f = fixture(route);
    const original = request(route, " ".repeat(f.maxBytes + 1));
    if (declared) original.headers.set("Content-Length", String(f.maxBytes + 1));
    const clone = original.clone();
    t.after(() => { void original.body?.cancel().catch(() => {}); });
    const res = await timely(f.POST(clone));
    assert.equal(res.status, 413);
    assert.equal(clone.body!.locked, false);
    assert.equal(f.calls, 0);
  });

  test(`${route} rejects invalid UTF-8 without waiting on cancellation`, async () => {
    const f = fixture(route);
    let cancelled = false;
    const req = request(route, new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(Uint8Array.of(0xff)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }));
    assert.equal((await timely(f.POST(req))).status, 400);
    assert.equal(cancelled, true);
    assert.equal(req.body!.locked, false);
    assert.equal(f.calls, 0);
  });

  test(`${route} handles interrupted body reads without contacting downstream`, async () => {
    const f = fixture(route);
    const req = request(route, new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error("client disconnected")); },
    }));
    assert.equal((await f.POST(req)).status, 400);
    assert.equal(req.body!.locked, false);
    assert.equal(f.calls, 0);
  });
}
});

describe("api-json-limits", () => {
describe("api-json-limits", () => {
  function jsonRequest(body: string, headers: Record<string, string> = {}) {
    return new Request("https://editor.example.test/api/test", {
      method: "POST", body, headers: { "content-type": "application/json", ...headers },
    });
  }

  test("JSON limits count actual streamed bytes even with no Content-Length", async () => {
    assert.deepEqual(await readJsonLimited(jsonRequest('{"ok":true}'), 64), { ok: true });
    await assert.rejects(
      readJsonLimited(jsonRequest("{}", { "content-length": "9999" }), 64),
      JsonBodyTooLargeError,
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"text":"'));
        controller.enqueue(new TextEncoder().encode("あ".repeat(16)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const streamed = new Request("https://editor.example.test/api/test", {
      method: "POST", body, headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    await assert.rejects(readJsonLimited(streamed, 32), JsonBodyTooLargeError);
  });

  test("invalid encodings, malformed JSON, unexpected MIME and missing bodies are rejected", async () => {
    await assert.rejects(readJsonLimited(jsonRequest("{"), 1024), SyntaxError);
    await assert.rejects(readJsonLimited(jsonRequest("{}",
      { "content-type": "text/plain" }), 1024), JsonContentTypeError);
    const invalid = new Request("https://editor.example.test/api/test", {
      method: "POST", body: Uint8Array.of(0xff),
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(readJsonLimited(invalid, 1024), TypeError);
    await assert.rejects(readJsonLimited(new Request("https://editor.example.test/api/test",
      { method: "POST" }), 1024), SyntaxError);
  });

  function load(path: string, mocks: Record<string, unknown>) {
    const url = new URL(path, import.meta.url);
    const require = createRequire(url);
    const { code } = transformSync(readFileSync(url, "utf8"), {
      loader: "ts", format: "cjs", target: "es2022",
    });
    const module = { exports: {} as Record<string, any> };
    new Function("require", "module", "exports", code)(
      (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
      module, module.exports,
    );
    return module.exports;
  }

  class NextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new NextResponse(JSON.stringify(body), init);
    }
  }
  const tr = async () => (s: string) => s;

  function signingFixture(authorized = true) {
    const signed: string[] = [];
    const handler = load("../app/api/assets/sign/route.ts", {
      "next/server": { NextResponse },
      "../../../../lib/i18n-server": { serverTr: tr },
      "../../../../lib/server": { requireAuth: async () => authorized ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 }) },
      "../../../../lib/asset-token": { signAssetPaths: async (paths: string[]) => {
        const tokens = new Map<string, string>();
        for (const path of new Set(paths)) {
          signed.push(path);
          tokens.set(path, "exp=123&sig=example");
        }
        return tokens;
      } },
      "../../../../lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited, readJsonObjectLimited },
    });
    return { POST: handler.POST as (req: Request) => Promise<Response>, signed };
  }

  test("asset signing accepts a valid request and enforces authorization", async () => {
    const { POST, signed } = signingFixture();
    const good = await POST(jsonRequest('{"paths":["assets/a.png","assets/a.png"]}'));
    assert.equal(good.status, 200);
    assert.deepEqual((await good.json()).urls, {
      "assets/a.png": "/api/assets/file?path=assets%2Fa.png&exp=123&sig=example",
    });
    assert.deepEqual(signed, ["assets/a.png"]);
    const denied = signingFixture(false);
    assert.equal((await denied.POST(jsonRequest('{"paths":["assets/a.png"]}'))).status, 401);
    assert.deepEqual(denied.signed, []);
  });

  test("asset signing rejects oversized or wrongly typed request bodies before signing", async () => {
    const { POST, signed } = signingFixture();
    assert.equal((await POST(jsonRequest('{}', { "content-length": "9999999" }))).status, 413);
    assert.equal((await POST(jsonRequest("{}", { "content-type": "text/plain" }))).status, 415);
    assert.equal((await POST(jsonRequest('{"paths":["untrusted/secret"]}'))).status, 400);
    assert.equal((await POST(jsonRequest(JSON.stringify({ paths: Array(501).fill("assets/a.png") })))).status, 400);
    assert.deepEqual(signed, []);
  });
});

describe("api-json-streaming", () => {
  const encoder = new TextEncoder();

  function request(chunks: Uint8Array[], length?: string, onCancel?: () => void): Request {
    let position = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position < chunks.length) controller.enqueue(chunks[position++]);
        else controller.close();
      },
      cancel() { onCancel?.(); },
    });
    return new Request("https://example.test/api/fetch-json", {
      method: "POST",
      ...(length === undefined ? {} : { headers: { "content-length": length } }),
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  }

  test("shared JSON reader preserves UTF-8 across chunk boundaries", async () => {
    const data = { name: "日本語", nested: { list: [1, true, null] } };
    const bytes = encoder.encode(JSON.stringify(data));
    const chunks = [...bytes].map((_, i) => bytes.slice(i, i + 1));
    assert.deepEqual(await readJsonLimited(request(chunks), bytes.length), data);
    assert.deepEqual(await readJsonLimited(request([bytes], String(bytes.length)), bytes.length), data);
  });

  test("shared JSON reader rejects oversized chunked bodies before JSON parsing", async () => {
    const bytes = encoder.encode(JSON.stringify({ message: "x".repeat(5000) }));
    let cancelled = false;
    await assert.rejects(readJsonLimited(request([
      bytes.slice(0, 1000), bytes.slice(1000),
    ], undefined, () => { cancelled = true; }), 4096), RangeError);
    assert.equal(cancelled, true);
    await assert.rejects(readJsonLimited(request([bytes], String(bytes.length)), 4096), RangeError);
    await assert.rejects(readJsonLimited(request([bytes], "invalid"), 4096), SyntaxError);
  });

  test("shared JSON reader rejects invalid JSON, invalid UTF-8 and missing bodies", async () => {
    await assert.rejects(readJsonLimited(request([encoder.encode("{broken")]), 1024), SyntaxError);
    await assert.rejects(readJsonLimited(request([new Uint8Array([0xff])]), 1024), TypeError);
    const empty = new Request("https://example.test/api/ai", { method: "POST" });
    await assert.rejects(readJsonLimited(empty, 1024), /Missing JSON request body/);
  });
});

describe("api-json-lifecycle", () => {
  async function withoutCleanupWait<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("request is waiting for upstream cancellation")), 500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  for (const declared of [false, true]) {
    test(`JSON ${declared ? "declared" : "streamed"} limit rejects a cloned request without awaiting its unread sibling`, async (t) => {
      const original = new Request("https://editor.example.test/api/test", {
        method: "POST", body: '{"value":"too large"}',
        headers: {
          "Content-Type": "application/json",
          ...(declared ? { "Content-Length": "21" } : {}),
        },
      });
      const request = original.clone();
      // もう一方の読み手を待つ取り消しの処理が、エラーの応答を止めないことを確かめる。
      t.after(() => { void original.body?.cancel().catch(() => {}); });
      await assert.rejects(withoutCleanupWait(readJsonLimited(request, 4)), JsonBodyTooLargeError);
      assert.equal(request.bodyUsed, true);
      assert.equal(request.body!.locked, false);
    });
  }

  test("invalid JSON UTF-8 cancels remaining input and releases the reader without awaiting cleanup", async () => {
    let cancelled = false;
    let reason: unknown;
    const request = new Request("https://editor.example.test/api/test", {
      method: "POST", headers: { "Content-Type": "application/json" }, duplex: "half",
      body: new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(Uint8Array.of(0xff)); },
        cancel(error) { cancelled = true; reason = error; return new Promise<void>(() => {}); },
      }),
    } as RequestInit);
    await assert.rejects(withoutCleanupWait(readJsonLimited(request, 64)), TypeError);
    assert.equal(cancelled, true);
    assert.ok(reason instanceof TypeError);
    assert.equal(request.body!.locked, false);
  });

  test("JSON reads preserve original upstream errors and release successful readers", async () => {
    const good = new Request("https://editor.example.test/api/test", {
      method: "POST", body: '{"name":"日本"}', headers: { "Content-Type": "application/json" },
    });
    assert.deepEqual(await readJsonLimited(good, 64), { name: "日本" });
    assert.equal(good.body!.locked, false);
    const failure = new Error("client disconnected");
    const broken = new Request("https://editor.example.test/api/test", {
      method: "POST", headers: { "Content-Type": "application/json" }, duplex: "half",
      body: new ReadableStream({ start(controller) { controller.error(failure); } }),
    } as RequestInit);
    await assert.rejects(readJsonLimited(broken, 64), error => error === failure);
    assert.equal(broken.body!.locked, false);
  });
});
});

describe("auth-policy", () => {
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
    await addAllowedEmail("editor@example.com", "editor");
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
});

describe("csrf-origin", () => {
const request = (method: string, headers: Record<string, string> = {}, protocol = "https:") => ({
  method,
  nextUrl: { host: "editor.example.test", protocol },
  headers: new Headers(headers),
});

test("state-changing API requests reject cross-origin schemes and authorities", () => {
  for (const origin of [
    "http://editor.example.test",
    "https://evil.example.test",
    "https://editor.example.test:8443",
    "null",
    "https://editor.example.test/path",
    "https://user@editor.example.test",
  ]) {
    assert.equal(isCrossSiteWrite(request("POST", { origin })), true, origin);
  }
  assert.equal(isCrossSiteWrite(request("POST", { origin: "https://editor.example.test" })), false);
  assert.equal(isCrossSiteWrite(request("POST", { origin: "http://editor.example.test" }, "http:")), false);
});

test("Fetch Metadata does not override a contradictory Origin", () => {
  for (const site of ["same-origin", "none"]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      origin: "https://evil.example.test", "sec-fetch-site": site,
    })), true, site);
  }
  for (const site of ["cross-site", "same-site", "unknown"]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      origin: "https://editor.example.test", "sec-fetch-site": site,
    })), true, site);
  }
  assert.equal(isCrossSiteWrite(request("POST", { "sec-fetch-site": "none" })), false);
  assert.equal(isCrossSiteWrite(request("PUT", { "sec-fetch-site": "same-origin" })), false);
});

test("proxied editor writes use the externally visible scheme and host", () => {
  assert.equal(isCrossSiteWrite(request("POST", {
    host: "localhost:3000", origin: "https://editor.example.test",
    "sec-fetch-site": "same-origin",
  })), false);
  assert.equal(isCrossSiteWrite({
    method: "PATCH",
    nextUrl: { host: "127.0.0.1:3000", protocol: "http:" },
    headers: new Headers({
      host: "127.0.0.1:3000", "x-forwarded-host": "editor.example.test",
      "x-forwarded-proto": "https", origin: "https://editor.example.test",
    }),
  }), false);
  assert.equal(isCrossSiteWrite(request("POST", {
    "x-forwarded-proto": "https", "x-forwarded-host": "editor.example.test",
    origin: "http://editor.example.test",
  })), true);
  for (const protocol of ["", "ftp", "https,http"]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      "x-forwarded-proto": protocol, origin: "https://editor.example.test",
    })), true);
  }
});

test("safe methods are not treated as CSRF writes and non-browser requests work", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isCrossSiteWrite(request(method, {
      origin: "https://evil.example.test", "sec-fetch-site": "cross-site",
    })), false, method);
  }
  assert.equal(isCrossSiteWrite(request("DELETE")), false);
});

test("empty security headers are invalid, not evidence of a non-browser request", () => {
  const cases: Record<string, string>[] = [
    { origin: "" },
    { origin: "   " },
    { origin: "", "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "" },
    { "sec-fetch-site": "", origin: "https://editor.example.test" },
  ];
  for (const headers of cases) {
    assert.equal(isCrossSiteWrite(request("POST", headers)), true, JSON.stringify(headers));
  }
});

test("forwarded hosts must be authorities, not URLs that normalize to a trusted origin", () => {
  for (const host of [
    "ignored@editor.example.test",
    "editor.example.test/ignored",
    "editor.example.test?ignored",
    "editor.example.test#ignored",
    "editor.example.test\\ignored",
    "ed\titor.example.test",
  ]) {
    assert.equal(isCrossSiteWrite(request("PATCH", {
      origin: "https://editor.example.test",
      "x-forwarded-host": host,
      "x-forwarded-proto": "https",
    })), true, host);
  }
});

test("valid proxy authorities retain case, port and IPv6 normalization", () => {
  for (const [host, origin] of [
    ["EDITOR.EXAMPLE.TEST", "https://editor.example.test"],
    ["editor.example.test:443", "https://editor.example.test"],
    ["editor.example.test:8443", "https://editor.example.test:8443"],
    ["[::1]:8443", "https://[::1]:8443"],
  ]) {
    assert.equal(isCrossSiteWrite(request("POST", {
      origin, "x-forwarded-host": host, "x-forwarded-proto": "https",
    })), false, host);
  }
});
});

describe("login-routing", () => {
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
    proxyAuth: async () => { cookieChecks++; return cookie ? session : null; },
    auth: async () => { permissionChecks++; return cookie && allowed ? session : null; },
  };
  const serverTr = async () => (s: string) => s;
  const proxy = load("../proxy.ts", {
    "next/server": { NextResponse }, "./auth": auth,
    "./lib/anonymous": { anonymousAllowed: () => anonymous, anonymousHostAllowed: () => true },
  }).proxy;
  const redirect = (destination: string) => { throw new Error(`redirect:${destination}`); };
  const login = load("../app/login/page.tsx", {
    "../../auth": auth, "next/navigation": { redirect },
    "../../lib/i18n-server": { serverTr },
  }).default;
  const { requireAuth } = load("../lib/server.ts", {
    "next/server": { NextResponse }, "../auth": auth,
    "./i18n-server": { serverTr }, "./anonymous": { anonymousAllowed: () => anonymous },
  });
  const request = (path: string, method = "GET", headers: Record<string, string> = {}) => proxy({
    nextUrl: new URL(`https://editor.example${path}`), method, headers: new Headers(headers),
  });
  return {
    request, requireAuth,
    login: (error?: string, resume?: string) => login({ searchParams: Promise.resolve({ error, "resume-import": resume }) }),
    get cookieChecks() { return cookieChecks; },
    get permissionChecks() { return permissionChecks; },
  };
}

test("a revoked user with an unexpired cookie can reach login after an API 401", async () => {
  const f = fixture();
  // ホームは、/api/sites が 401 を返すと /login へ移動する。
  // 古い Cookie は proxy の検証を通るが、API での現在の権限の確認で拒否される。
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

test("an already authorized session carries only the import marker from Login to Home", async () => {
  const f = fixture({ allowed: true });
  await assert.rejects(f.login(undefined, "1"), { message: "redirect:/?resume-import=1" });
  await assert.rejects(f.login(undefined, "0"), { message: "redirect:/" });
  await assert.rejects(f.login(), { message: "redirect:/" });
});

test("signed-out users still see login and brand icons while protected pages/API requests remain blocked", async () => {
  const f = fixture({ cookie: false });
  assert.equal((await f.request("/")).headers.get("location"), "https://editor.example/login");
  assert.equal((await f.request("/api/sites")).status, 401);
  assert.equal((await f.request("/login")).status, 200);
  for (const asset of ["/icon.svg", "/apple-icon.png", "/tsumu-mark.svg", "/robots.txt"]) {
    const res = await f.request(asset);
    assert.equal(res.headers.get("location"), null, asset);
    assert.equal(res.headers.get("x-middleware-next"), "1", asset);
  }
  assert.ok(await f.login());
  assert.equal((await f.requireAuth()).status, 401);
});

test("login routing retains anonymous/setup behavior and cross-site write protection", async () => {
  const setup = fixture({ configured: false });
  for (const [lang, guide] of [["en", "user-guide.md#google-sign-in"], ["ja", "user-guide.ja.md#googleログイン"]]) {
    const response = await setup.request("/login", "GET", { "accept-language": lang });
    assert.equal(response.status, 503);
    assert.ok((await response.text()).includes(`href="https://github.com/abshrimp/tsumu/blob/main/docs/${guide}"`));
  }
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
});

describe("private-api-cache", () => {
class NextResponse extends Response {
  static json(data: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}

function load(path: string) {
  const url = new URL(path, import.meta.url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  const shared: Record<string, unknown> = {
    NextResponse, isValidEmail, envVar: () => undefined,
    requireAuth: async (mode?: "user") => mode === "user" ? { email: "user@example.test", name: "User" } : null,
    authConfigured: () => true,
    auth: async () => ({ user: { email: "user@example.test" } }),
    sessionUser: async () => ({ email: "user@example.test", name: "User" }),
    serverTr: async () => (text: string) => text,
    dbConfigured: () => true,
    collabRoomAvailable: () => false,
    getDb: async () => ({
      execute: async () => ({
        rows: [{
          day: 0, saved_at: 1, size: 16,
          asset_path: "assets/example.png", bytes: 256,
          body: '{"backup":true}',
        }],
      }),
    }),
    dbUnavailable: async () => NextResponse.json({}, { status: 503 }),
    storeUnavailable: async () => NextResponse.json({}, { status: 503 }),
    allowedEmails: () => ["user@example.test"],
    listAllowedAccounts: async () => [],
    getAccountRole: async () => "editor",
    requireSiteAccess: async () => null,
    siteRole: async () => "owner",
    assetStore: () => ({ put: async () => {} }),
    getSite: async () => ({ id: "site", name: "Site" }),
    isSiteId: () => true,
    siteIdOf: async () => "site",
    listSites: async () => [{ id: "site", name: "Site" }],
    readActivity: async () => ({ items: [] }),
    cleanupAbandonedDocuments: async () => undefined,
    usesDocumentRooms: () => false,
    validateDocBody: () => null,
    documentAssetReferences: async () => [{ path: "assets/example.png", bytes: 256 }],
    readAssetLedger: async () => null,
    parseCommentCursor: () => null,
    aiConfig: () => ({ enabled: true, provider: "anthropic", model: "example-model" }),
    listCommentPage: async () => ({ threads: [], nextCursor: null, total: 0, unresolvedCount: 0, focusedThread: null }),
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", code)(
    (id: string) => new Proxy({}, {
      get: (_target, field: string | symbol) =>
        typeof field === "string" ? shared[field] : undefined,
    }),
    module, module.exports,
  );
  return module.exports.GET as (req: Request, ctx: unknown) => Promise<Response>;
}

for (const path of [
  "../app/api/status/route.ts",
  "../app/api/sites/route.ts",
  "../app/api/sites/[id]/route.ts",
  "../app/api/comments/route.ts",
  "../app/api/activity/route.ts",
  "../app/api/assets/route.ts",
  "../app/api/doc/backups/route.ts",
  "../app/api/allowed-users/route.ts",
  "../app/api/collab/authorize/route.ts",
  "../app/api/ai/route.ts",
]) {
  test(`${path} never allows caching an authorized GET response`, async () => {
    const handler = load(path);
    const response = await handler(new Request("https://editor.example.test/api/test?site=site"), {
      params: Promise.resolve({ id: "site" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
}

test("backup body and metadata are both private and non-cacheable", async () => {
  const handler = load("../app/api/doc/backups/route.ts");
  const response = await handler(new Request("https://editor.example.test/api/doc/backups?site=site&day=0"), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { backup: true });
});
});

describe("proxy-csrf", () => {
const code = transformSync(readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs", target: "es2022",
}).code;

function fixture(configured: boolean) {
  let sessionChecks = 0;
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: NextResponse },
    "./auth": {
      authConfigured: () => configured,
      proxyAuth: async () => {
        sessionChecks++;
        return { user: { email: "editor@example.test" } };
      },
    },
    "./lib/lang": { langOfRequest: () => "en" },
    "./lib/csrf": { isCrossSiteWrite },
    "./lib/anonymous": { anonymousAllowed: () => true, anonymousHostAllowed: () => true },
  };
  const module = { exports: {} as { default: (req: NextRequest) => Promise<Response> } };
  new Function("require", "module", "exports", code)((id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return { proxy: module.exports.proxy, sessionChecks: () => sessionChecks };
}

for (const configured of [true, false]) {
  test(`proxy rejects malformed CSRF headers before access checks (${configured ? "authenticated" : "anonymous"})`, async () => {
    const { proxy, sessionChecks } = fixture(configured);
    const cases: Record<string, string>[] = [
      { origin: "" },
      { "sec-fetch-site": "", origin: "https://editor.example.test" },
      { origin: "https://editor.example.test", "x-forwarded-host": "ignored@editor.example.test" },
      { origin: "https://editor.example.test", "x-forwarded-host": "editor.example.test/path" },
    ];
    for (const headers of cases) {
      const response = await proxy(new NextRequest("https://editor.example.test/api/doc", {
        method: "PUT", headers,
      }));
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(response.headers.get("x-middleware-next"), null);
    }
    assert.equal(sessionChecks(), 0, "invalid requests must stop before session checks");
  });

  test(`proxy preserves valid CSRF requests (${configured ? "authenticated" : "anonymous"})`, async () => {
    const { proxy, sessionChecks } = fixture(configured);
    const cases: Record<string, string>[] = [
      {},
      { origin: "https://editor.example.test", "sec-fetch-site": "same-origin" },
      { origin: "https://public.example.test", "x-forwarded-host": "public.example.test", "x-forwarded-proto": "https" },
    ];
    for (const headers of cases) {
      const response = await proxy(new NextRequest("https://editor.example.test/api/doc", {
        method: "PUT", headers,
      }));
      assert.equal(response.headers.get("x-middleware-next"), "1", JSON.stringify(headers));
    }
    assert.equal(sessionChecks(), configured ? 3 : 0);
  });
}
});

describe("root-proxy-routing", () => {
const require = createRequire(import.meta.url);
const { getResolveRoutes } = require("next/dist/server/lib/router-utils/resolve-routes");
const { buildCustomRoute } = require("next/dist/server/lib/router-utils/filesystem");
const { defaultConfig } = require("next/dist/server/config-shared");
const { getRouteMatcher } = require("next/dist/shared/lib/router/utils/route-matcher");
const { getRouteRegex } = require("next/dist/shared/lib/router/utils/route-regex");
const { checkCustomRoutes } = require("next/dist/lib/load-custom-routes");
const { prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination");

type Rewrites = { beforeFiles: Rewrite[]; fallback?: Rewrite[] };
type Config = { rewrites?: () => Promise<Rewrites>; redirects?: () => Promise<Redirect[]> };

function page(id: string, slug: string, extra: Partial<Page> = {}): Page {
  return { id, slug, name: id, title: id, description: "", children: [], ...extra };
}

function fixture(pages = [page("home", "", { rewriteTo: "https://origin.example/base/" })]): SiteDoc {
  return { siteName: "Proxy test", lang: "ja", pages: Object.fromEntries(pages.map(p => [p.id, p])), pageOrder: pages.map(p => p.id), nodes: {}, assets: {} };
}

function generated(doc: SiteDoc, target: "production" | "test" = "production") {
  const before = structuredClone(doc);
  assert.deepEqual(runChecks(doc).filter(c => c.level === "error"), []);
  const project = generateProject(doc, target);
  const config: Config = new Function(project.files["next.config.mjs"].replace("export default nextConfig;", "return nextConfig;"))();
  assert.deepEqual(doc, before, "generation must not mutate the saved document");
  return { ...project, config };
}

async function rewritesOf(config: Config) {
  assert.ok(config.rewrites);
  const rewrites = await config.rewrites();
  for (const rules of [rewrites.beforeFiles, rewrites.fallback ?? []]) checkCustomRoutes(rules, "rewrite");
  return rewrites;
}

// ファイルの有無だけを代わりに用意し、一致・転送先・優先順位は、インストール済みの Next.js の本体で検証する。
// サーバーもブラウザも起動せず、外部へのリクエストも送らない。
async function resolver(config: Config, items = new Map<string, FsOutput>(), dynamicPaths: string[] = []) {
  const rewrites = config.rewrites ? await rewritesOf(config) : { beforeFiles: [] };
  const fsChecker = {
    buildId: "local-build", headers: [], onMatchHeaders: [],
    redirects: (await config.redirects?.() ?? []).map(r => buildCustomRoute("redirect", r, "")),
    rewrites: {
      beforeFiles: rewrites.beforeFiles.map(r => buildCustomRoute("rewrite", r, "")),
      afterFiles: [],
      fallback: (rewrites.fallback ?? []).map(r => buildCustomRoute("rewrite", r, "")),
    },
    getItem: async (path: string) => items.get(path) ?? null,
    getDynamicRoutes: () => dynamicPaths.map(path => ({ page: path, match: getRouteMatcher(getRouteRegex(path)) })),
    getMiddlewareMatchers: () => undefined,
    handleLocale: (pathname: string) => ({ pathname }),
  };
  const resolve = getResolveRoutes(fsChecker,
    { ...defaultConfig, experimental: { ...defaultConfig.experimental } }, () => "",
    { dev: false, minimalMode: false, dir: process.cwd(), port: 3000, hostname: "localhost" },
    undefined, undefined, undefined);
  return async (url: string) => {
    const req = new PassThrough();
    Object.assign(req, { url, method: "GET", headers: { host: "localhost" }, socket: {} });
    return resolve({ req, res: { setHeader() {} }, isUpgradeReq: false, invokedOutputs: new Set() });
  };
}

function localItems(paths: [string, FsOutput["type"]][]) {
  return new Map(paths.map(([itemPath, type]) => [itemPath, { type, itemPath }]));
}

test("a root-only proxy keeps its exact destination and adds a descendant fallback", async () => {
  for (const destination of ["https://example.com", "https://example.com/", "https://example.com/base", "https://example.com/base/", "  https://example.com/base/  "]) {
    const { files, config } = generated(fixture([page("home", "", { rewriteTo: destination })]));
    const trimmed = destination.trim();
    const rewrites = await rewritesOf(config);
    assert.deepEqual(rewrites, {
      beforeFiles: [{ source: "/", destination: trimmed }],
      fallback: [{ source: "/:proxyPath+", destination: `${trimmed.replace(/\/+$/, "")}/:proxyPath*` }],
    });
    assert.equal(files["app/page.tsx"], undefined);
    assert.equal(files["app/route.ts"], undefined);
    const match = buildCustomRoute("rewrite", rewrites.fallback![0], "").match;
    assert.equal(match("/"), false, "fallback must not claim the exact root");
    assert.deepEqual(match("/assets/site.css"), { proxyPath: ["assets", "site.css"] });
    const route = await resolver(config);
    const root = await route("/");
    assert.equal(root.parsedUrl.hostname, "example.com");
    assert.equal(root.parsedUrl.pathname || "/", new URL(trimmed).pathname);
    for (const path of ["/contact", "/assets/site.css", "/deep/nested/page"]) {
      const result = await route(`${path}?q=hello&tag=a&tag=b`);
      assert.equal(result.parsedUrl.pathname, `${new URL(trimmed).pathname.replace(/\/+$/, "")}${path}`);
      assert.deepEqual(result.parsedUrl.query, { q: "hello", tag: ["a", "b"] });
      assert.equal(result.parsedUrl.hostname, "example.com");
      assert.equal(result.finished, true);
      assert.equal(result.matchedOutput, undefined);
    }
  }
});

test("sites without published proxies still omit rewrites", async () => {
  for (const hidden of [
    page("hidden", "hidden"),
    page("hidden", "hidden", { rewriteTo: "https://hidden.example/", unpublished: true }),
    page("hidden", "", { rewriteTo: "https://hidden.example/", unpublished: true }),
  ]) {
    const { config } = generated(fixture([page("home", ""), hidden]));
    assert.equal(config.rewrites, undefined);
    const route = await resolver(config);
    const missing = await route("/missing");
    assert.equal(missing.finished, false);
    assert.ok(missing.parsedUrl.protocol == null);
  }
});

test("query and fragment destinations remain valid and exact-only for root and nonroot proxies", async () => {
  for (const slug of ["", "external"]) {
    for (const destination of ["https://example.com/?lang=ja", "https://example.com/base#intro", "https://example.com/base?lang=ja#intro", "https://example.com/base?", "https://example.com/base#"]) {
      const pages = [page("proxy", slug, { rewriteTo: destination })];
      if (slug) pages.unshift(page("home", ""));
      const { config } = generated(fixture(pages));
      const source = slug ? `/${slug}` : "/";
      assert.deepEqual(await rewritesOf(config), { beforeFiles: [{ source, destination }] });
      const route = await resolver(config);
      const exact = await route(`${source}?q=hello&lang=en`);
      assert.equal(exact.parsedUrl.pathname, new URL(destination).pathname);
      assert.deepEqual(exact.parsedUrl.query, { q: "hello", lang: destination.includes("?lang=ja") ? "ja" : "en" });
      assert.equal(exact.parsedUrl.hash || "", new URL(destination).hash);
      assert.equal(urlToHttpOptions(new URL(destination)).path!.includes("#"), false);
      const descendant = await route(`${source.replace(/\/$/, "")}/contact`);
      assert.equal(descendant.finished, false);
      assert.ok(descendant.parsedUrl.protocol == null);
    }
  }
  // クエリの後ろに単純にパスを足すと、パスではなくクエリの値が変わってしまう。
  const { parsedDestination } = prepareDestination({ destination: "https://example.com/base?lang=ja/:proxyPath*", params: { proxyPath: ["contact"] }, query: {}, appendParamsToQuery: true });
  assert.equal(parsedDestination.pathname, "/base");
  assert.equal(parsedDestination.query.lang, "ja/contact");
});

test("nonroot proxy order, descendants, and wildcard rules remain in beforeFiles", async () => {
  const doc = fixture([
    page("home", ""),
    page("shop", "shop", { rewriteTo: "https://shop.example/base/" }),
    page("nested", "shop/sale", { rewriteTo: "https://sale.example/" }),
    page("wildcard", "docs/:path*", { rewriteTo: "https://docs.example/:path*" }),
    page("dynamic", "users/[slug]", { rewriteTo: "https://users.example/:slug" }),
  ]);
  const { config } = generated(doc);
  assert.deepEqual(await rewritesOf(config), { beforeFiles: [
    { source: "/shop", destination: "https://shop.example/base/" },
    { source: "/shop/:proxyPath*", destination: "https://shop.example/base/:proxyPath*" },
    { source: "/shop/sale", destination: "https://sale.example/" },
    { source: "/shop/sale/:proxyPath*", destination: "https://sale.example/:proxyPath*" },
    { source: "/docs/:path*", destination: "https://docs.example/:path*" },
    { source: "/users/:slug", destination: "https://users.example/:slug" },
    { source: "/users/:slug/:proxyPath*", destination: "https://users.example/:slug/:proxyPath*" },
  ] });
  const route = await resolver(config);
  for (const [path, hostname, pathname] of [
    ["/shop/sale/item", "shop.example", "/base/sale/item"],
    ["/docs/a/b", "docs.example", "/a/b"],
    ["/users/alice/settings", "users.example", "/alice/settings"],
  ]) {
    const result = await route(path);
    assert.equal(result.parsedUrl.hostname, hostname);
    assert.equal(result.parsedUrl.pathname, pathname);
  }
});

for (const rootFirst of [true, false]) {
  test(`root fallback respects local routes, public files, explicit proxies, and redirects (${rootFirst ? "root first" : "root last"})`, async () => {
    const doc = fixture([
      page("home", "", { rewriteTo: "https://origin.example/base/" }),
      page("about", "about"),
      page("raw", "landing", { rawHtml: "<html><body>Local HTML</body></html>" }),
      page("blog", "blog/[slug]"),
      page("shop", "shop", { rewriteTo: "https://shop.example/" }),
      page("shopLocal", "shop/local"),
      page("old", "old", { redirectTo: "/about" }),
      page("shopOld", "shop/old", { redirectTo: "/about" }),
      page("hidden", "hidden", { unpublished: true }),
      page("hiddenProxy", "hidden-proxy", { rewriteTo: "https://hidden.example/", unpublished: true }),
    ]);
    doc.pwa = { enabled: true };
    if (!rootFirst) doc.pageOrder.push(doc.pageOrder.shift()!);
    const { config, files } = generated(doc, "test");
    for (const path of ["app/about/page.tsx", "app/landing/route.ts", "app/blog/[slug]/page.tsx", "app/shop/local/page.tsx", "app/manifest.ts", "public/sw.js", "public/pwa.js", "public/robots.txt"]) assert.ok(files[path], path);
    for (const path of ["app/page.tsx", "app/shop/page.tsx", "app/old/page.tsx", "app/hidden/page.tsx", "app/hidden-proxy/page.tsx"]) assert.equal(files[path], undefined, path);
    const rewrites = await rewritesOf(config);
    assert.deepEqual(rewrites.fallback, [{ source: "/:proxyPath+", destination: "https://origin.example/base/:proxyPath*" }]);
    assert.equal(rewrites.beforeFiles.length, 3);
    assert.equal(rewrites.beforeFiles[rootFirst ? 0 : 2].source, "/");
    // 公開のときに残る利用者が作ったファイルや、Next.js の予約されたエンドポイントも、列挙による除外なしで優先される。
    const items = localItems([
      ["/about", "appFile"], ["/landing", "appFile"], ["/blog/[slug]", "appFile"],
      ["/shop/local", "appFile"], ["/api/ping", "appFile"], ["/manifest.webmanifest", "appFile"],
      ["/assets/site.css", "publicFolder"], ["/assets/photo.png", "publicFolder"],
      ["/scripts.js", "publicFolder"], ["/sw.js", "publicFolder"], ["/pwa.js", "publicFolder"],
      ["/robots.txt", "publicFolder"], ["/user-authored.txt", "publicFolder"],
      ["/_next/static/chunks/local.js", "nextStaticFolder"], ["/_next/image", "nextImage"],
    ]);
    const route = await resolver(config, items, ["/blog/[slug]"]);
    for (const path of items.keys()) {
      if (path === "/shop/local" || path === "/blog/[slug]") continue;
      const result = await route(`${path}?v=2`);
      assert.equal(result.matchedOutput?.itemPath, path, path);
      assert.ok(result.parsedUrl.protocol == null, path);
    }
    const dynamic = await route("/blog/hello");
    assert.equal(dynamic.matchedOutput?.itemPath, "/blog/[slug]");
    assert.equal(dynamic.matchedOutput?.params.slug, "hello");
    // 存在しない Next.js のリソースは中継できるが、外部の Next.js のアプリ全体との互換性を保証するものではない。
    for (const path of ["/", "/contact", "/assets/missing.css", "/hidden", "/hidden-proxy", "/_next/static/chunks/upstream.js", "/_next/data/foreign-build/contact.json"]) {
      const result = await route(path);
      assert.equal(result.parsedUrl.hostname, "origin.example", path);
      assert.equal(result.parsedUrl.pathname, `/base${path}`, path);
      assert.equal(result.matchedOutput, undefined, path);
    }
    for (const path of ["/shop", "/shop/local", "/shop/item"]) {
      const result = await route(path);
      assert.equal(result.parsedUrl.hostname, "shop.example", path);
      assert.equal(result.parsedUrl.pathname, path.slice(5) || "/", path);
    }
    for (const path of ["/old", "/shop/old"]) {
      const result = await route(path);
      assert.equal(result.statusCode, 301, path);
      assert.equal(result.parsedUrl.pathname, "/about", path);
      assert.ok(result.parsedUrl.protocol == null, path);
    }
  });
}

test("a local dynamic catch-all added to the exported project owns descendants before the root fallback", async () => {
  // エディタは [slug] だけを許すが、書き出した Next.js のプロジェクトには catch-all も追加できる。
  const { config } = generated(fixture([page("home", "", { rewriteTo: "https://origin.example/" })]));
  const route = await resolver(config, localItems([["/[...path]", "appFile"]]), ["/[...path]"]);
  for (const path of ["/contact", "/assets/missing.css", "/deep/path"]) {
    const result = await route(path);
    assert.equal(result.matchedOutput?.itemPath, "/[...path]");
    assert.deepEqual(result.matchedOutput?.params.path, path.slice(1).split("/"));
    assert.ok(result.parsedUrl.protocol == null);
  }
  const root = await route("/");
  assert.equal(root.parsedUrl.hostname, "origin.example");
});
});

describe("security", () => {
describe("security", () => {
  test("server-side fetches refuse private, loopback and metadata hosts in every spelling", async () => {
    const blocked = [
      "http://localhost/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
      "http://0.0.0.0/", "http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.1.1/", "http://100.64.0.1/",
      "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::]/", "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/", "http://[fe80::1]/", "http://metadata.google.internal/", "http://metadata/",
      "http://printer.local/", "http://app.localhost/", "ftp://example.com/", "file:///etc/passwd",
      "http://user:pass@example.com/",
    ];
    for (const url of blocked) {
      await assert.rejects(assertPublicUrl(url), BlockedUrlError, url);
    }
    assert.equal(isPrivateHost("example.com"), false);
    assert.equal(isPrivateHost("8.8.8.8"), false);
    assert.equal(isPrivateHost("[2606:4700::1111]"), false);
  });

  test("redirects to a private host are not followed", async () => {
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as typeof fetch;
    try {
      await assert.rejects(fetchPublic("http://93.184.215.14/", {}), BlockedUrlError);
      assert.deepEqual(seen, ["http://93.184.215.14/"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("redirects cannot send credentials, custom API keys or bodies to another origin", async () => {
    const realFetch = globalThis.fetch;
    try {
      for (const location of ["https://8.8.8.8/collect", "http://93.184.215.14/collect", "https://93.184.215.14:8443/collect"]) {
        for (const init of [
          { headers: { Authorization: "Bearer secret" } },
          { headers: new Headers({ Cookie: "session=secret" }) },
          { headers: [["X-API-Key", "secret"]] },
          { method: "POST", body: "secret" },
          { method: "DELETE" },
        ] as RequestInit[]) {
          const seen: string[] = [];
          let cancelled = false;
          globalThis.fetch = (async (input: RequestInfo | URL) => {
            seen.push(String(input));
            return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
              status: 307, headers: { location },
            });
          }) as typeof fetch;
          await assert.rejects(fetchPublic("https://93.184.215.14/start", init), BlockedUrlError);
          assert.deepEqual(seen, ["https://93.184.215.14/start"]);
          assert.equal(cancelled, true);
        }
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("same-origin redirects retain credentials and public cross-origin GETs still work", async () => {
    const realFetch = globalThis.fetch;
    try {
      for (const sameOrigin of [true, false]) {
        const seen: { url: string; headers: Headers; method?: string; body?: BodyInit | null }[] = [];
        const location = sameOrigin ? "/next" : "https://8.8.8.8/next";
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          seen.push({ url: String(input), headers: new Headers(init?.headers), method: init?.method, body: init?.body });
          return seen.length === 1
            ? new Response(null, { status: 302, headers: { location } })
            : new Response("ok");
        }) as typeof fetch;
        const headers = new Headers({ Accept: "application/json" });
        if (sameOrigin) {
          headers.set("Authorization", "Bearer secret");
          headers.set("Content-Type", "application/json");
        }
        const res = await fetchPublic("https://93.184.215.14/start", {
          headers, ...(sameOrigin ? { method: "POST", body: "{}" } : {}),
        });
        assert.equal(await res.text(), "ok");
        assert.equal(seen.length, 2);
        assert.equal(seen[1].url, new URL(location, "https://93.184.215.14").href);
        assert.equal(seen[1].headers.get("authorization"), sameOrigin ? "Bearer secret" : null);
        assert.equal(seen[1].headers.get("accept"), "application/json");
        assert.equal(seen[1].headers.has("content-type"), false);
        assert.equal(seen[1].method, "GET");
        assert.equal(seen[1].body, undefined);
        assert.equal(headers.has("content-type"), sameOrigin, "caller headers stay unchanged");
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("response bodies are read only up to the limit", async () => {
    const big = new Response(new ReadableStream({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1024));
        c.close();
      },
    }));
    await assert.rejects(readTextLimited(big, 4096), TooLargeError);
    assert.equal(await readTextLimited(new Response("ok"), 4096), "ok");
  });

  test("pasted clipboard data that this editor did not write needs confirmation for HTML elements", () => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    };
    try {
      const code = { ...makeBox(), id: "c", name: "Widget", type: "code" as const, code: { html: "<img src=x onerror=alert(1)>" } };
      const raw = JSON.stringify({ v: 1, site: "evil", breakpoints: [{ id: "lg", label: "タブレット", maxWidth: 1024 }], nodes: [code], rootIds: ["c"], assets: {}, components: {}, componentNodes: [], customFonts: [], adobeFonts: [] });
      const payload = parseClipPayload(raw)!;
      assert.ok(payload);
      assert.equal(isOwnClip(raw), false);
      assert.deepEqual(activeContentNames(payload), ["Widget"]);
      // エディタがコピーしたときの控えと同じなら、信用する
      store.set("tsumu-clipboard-v1", raw);
      assert.equal(isOwnClip(raw), true);
      // 子の参照が欠けたデータや、形の崩れたデータは読まない
      assert.equal(parseClipPayload(JSON.stringify({ v: 1, nodes: [{ ...code, children: ["missing"] }], rootIds: ["c"], assets: {} })), null);
      assert.equal(parseClipPayload(JSON.stringify({ v: 1, nodes: [{ id: "x" }], rootIds: ["x"], assets: {} })), null);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  test("repository and branch names cannot walk to other GitHub API paths", () => {
    const base = { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null };
    for (const repo of ["owner/..", "../repo", "./x", "owner/."]) {
      assert.equal(normalizeSiteInput({ repo }, base).ok, false, repo);
    }
    for (const branch of ["a/../../..", "..", "a//b", "a/", "a.lock", "a/.hidden", "a@{1}"]) {
      assert.equal(normalizeSiteInput({ branch }, base).ok, false, branch);
    }
    assert.equal(normalizeSiteInput({ repo: "my.org/my.site", branch: "release/v1.2" }, base).ok, true);
  });

  test("GitHub publish client never attaches credentials to a malicious API path", async () => {
    const previousFetch = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(input));
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const tr = ((value: string) => value) as any;
      for (const repository of ["../other", "owner/..", "owner/repo?x=1"]) {
        const client = githubClient({ repo: repository, branch: "main", token: "secret", url: undefined }, tr);
        assert.throws(() => client.gh("/contents"), /Invalid GitHub API destination/);
      }
      const client = githubClient({ repo: "owner/repo", branch: "main", token: "secret", url: undefined }, tr);
      for (const suffix of ["/../../user", "//evil.test/", "/contents?path=%2e%2e", "/contents\\..\evil", "/x#fragment"]) {
        assert.throws(() => client.gh(suffix), /Invalid GitHub API destination/);
      }
      await client.gh("/git/ref/heads/release/v1");
      assert.deepEqual(sent, ["https://api.github.com/repos/owner/repo/git/ref/heads/release/v1"]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("GitHub publishing follows repository moves within the API with the original write intact", async (t) => {
    const calls: string[] = [];
    const body = JSON.stringify({ sha: "example", force: false });
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init: RequestInit) => {
      calls.push(String(input));
      assert.equal(init.redirect, "manual");
      assert.equal(init.method, "PATCH");
      assert.equal(init.body, body);
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test");
      if (calls.length === 1) {
        return new Response(null, { status: 301, headers: { location: "/repositories/123/git/refs/heads/main" } });
      }
      return Response.json({ ref: "refs/heads/main" });
    });
    const client = githubClient({ repo: "owner/renamed", branch: "main", token: "test", url: undefined }, text => text);
    const response = await client.gh("/git/refs/heads/main", { method: "PATCH", body });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://api.github.com/repos/owner/renamed/git/refs/heads/main",
      "https://api.github.com/repositories/123/git/refs/heads/main",
    ]);
  });

  test("the publish client leaves GitHub website redirects unfollowed", async (t) => {
    const request = t.mock.method(globalThis, "fetch", async () =>
      Response.redirect("https://github.com/owner/repo", 302));
    const client = githubClient({ repo: "owner/repo", branch: "main", token: "test", url: undefined }, text => text);
    await assert.rejects(client.gh("/commits"), /Invalid GitHub API redirect/);
    assert.equal(request.mock.callCount(), 1);
  });

  test("signed asset URLs are tied to the path and expire", async () => {
    const { verifyAssetToken, ASSET_TOKEN_TTL } = await import("../lib/asset-token");
    const { signAssetPath } = await import("./helpers/sign-asset-path");
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "test-secret";
    try {
      const now = 1_700_000_000_000;
      const q = new URLSearchParams((await signAssetPath("assets/a.png", now))!);
      assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), q.get("sig"), now + 1000), true);
      // 別のファイル・期限切れ・改ざんは通さない
      assert.equal(await verifyAssetToken("assets/b.png", q.get("exp"), q.get("sig"), now + 1000), false);
      assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), q.get("sig"), now + ASSET_TOKEN_TTL + 1), false);
      assert.equal(await verifyAssetToken("assets/a.png", String(now + 10 * ASSET_TOKEN_TTL), q.get("sig"), now), false);
      assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), "AAAA", now), false);
      // ログインを使っていない（鍵が無い）ときは、署名しない
      delete process.env.AUTH_SECRET;
      assert.equal(await signAssetPath("assets/a.png", now), null);
      assert.equal(await verifyAssetToken("assets/a.png", q.get("exp"), q.get("sig"), now), false);
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });

  test("document values never become code or paths outside the exported project", async () => {
    const { generateProject } = await import("../lib/generator");
    const { headHtmlToJsx } = await import("../lib/generator/head");
    const text = { ...makeBox(), id: "t", text: { content: "x", heading: 0 }, styles: { base: { default: { fontFamily: 'Evil } from "fs"; //' } } } };
    const doc = {
      siteName: "s", pageOrder: ["p", "q"], assets: {}, nodes: { t: text },
      customFonts: [{ family: 'Evil } from "fs"; //', weights: ["400"] }],
      pages: {
        p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["t"] },
        q: { id: "q", name: "Up", slug: "../../.github/workflows", title: "Up", description: "", children: [] },
      },
    };
    const { files } = generateProject(doc as never);
    assert.doesNotMatch(files["app/layout.tsx"], /from "fs"/);
    assert.ok(Object.keys(files).every((path) => !path.split("/").includes("..")), Object.keys(files).join(","));
    // head の属性名に JSX の式を書いても、属性としては出力しない
    assert.doesNotMatch(headHtmlToJsx(`<meta x-{...globalThis.y} content="a">`, ""), /globalThis/);
  });

  test("embed URLs refuse javascript/data schemes and spoofed Google Maps origins", async () => {
    const { embedSrc } = await import("../lib/embed");
    // Google マップの埋め込みを装った javascript: / data: / 外部のドメインは、そのまま iframe に渡さない
    for (const malicious of [
      "javascript:alert(1)//google.com/maps/embed",
      "data:text/html,<script>alert(1)</script>?google.com/maps/embed",
      "https://evil.example/?q=google.com/maps/embed",
      "https://user@www.google.com/maps/embed?pb=1",
    ]) {
      const out = embedSrc({ kind: "map", src: malicious });
      assert.ok(out?.startsWith("https://www.google.com/maps?q="), malicious);
    }
    assert.equal(
      embedSrc({ kind: "map", src: "https://www.google.com/maps/embed?pb=!1m18" }),
      "https://www.google.com/maps/embed?pb=!1m18"
    );
    // URL の埋め込みでは http(s) だけを許し、javascript: や data: は null にする
    assert.equal(embedSrc({ kind: "url", src: "javascript:alert(1)" }), null);
    assert.equal(embedSrc({ kind: "url", src: "data:text/html,<script>alert(1)</script>" }), null);
    assert.equal(embedSrc({ kind: "url", src: "https://example.com/widget" }), "https://example.com/widget");
  });

  test("URL interpolation and exported links refuse data:text/html, javascript: and protocol-relative redirects", async () => {
    const { interpolateUrl } = await import("../lib/vars");
    const { generateProject } = await import("../lib/generator");
    // data:text/html・data:image/svg+xml・//evil.example は、URL そのものとしては通さず、エンコードする
    for (const unsafe of [
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "//evil.example/phish",
      "javascript:alert(1)",
    ]) {
      assert.equal(interpolateUrl("{u}", { u: unsafe }), encodeURIComponent(unsafe));
    }
    assert.equal(interpolateUrl("{u}", { u: "/about" }), "/about");
    assert.equal(interpolateUrl("{u}", { u: "https://example.com/a" }), "https://example.com/a");
    assert.equal(interpolateUrl("{u}", { u: "data:image/png;base64,AAAA" }), "data:image/png;base64,AAAA");

    // 「\」と制御文字は、パスまでの部分では拒否し、クエリやフラグメントの中ではそのまま通す（生成したサイトのランタイムも同じ）
    const { safeNavigationUrl, NAVIGATION_RUNTIME } = await import("../lib/url-policy");
    const runtime = new Function(`${NAVIGATION_RUNTIME}\nreturn safeNavigationUrl;`)() as (u: string) => string;
    for (const [url, expected] of [
      ["/\\evil.example", "#"],
      ["https:\\\\evil.example", "#"],
      ["https://example.com\\@evil.example/", "#"],
      ["https://example.com/?q=C:\\new", "https://example.com/?q=C:\\new"],
      ["/docs#a\\b", "/docs#a\\b"],
      ["java\nscript:alert(1)", "#"],
      ["https://example.com/\t?q=1", "#"],
    ]) {
      assert.equal(safeNavigationUrl(url), expected, url);
      assert.equal(runtime(url), expected, url);
    }

    // 要素のリンクに javascript: や data: が入っていても、書き出したコードでは # に無害化される
    const linkNode = {
      ...makeBox(),
      id: "l1",
      text: { content: "Click", heading: 0 },
      link: { kind: "url" as const, url: "javascript:alert(1)" },
    };
    const doc = {
      siteName: "s",
      pageOrder: ["p"],
      assets: {},
      nodes: { l1: linkNode },
      pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["l1"] } },
    };
    const { files } = generateProject(doc as never);
    assert.doesNotMatch(files["app/page.tsx"], /javascript:/);
  });

  test("SSRF guards block multi-dot internal hosts, [slug] dynamic origins, and private IPv6 forms", async () => {
    const { dynamicOrigin } = await import("../lib/generator/render-helpers");
    for (const url of [
      "http://localhost../",
      "http://metadata../",
      "http://127.0.0.1./",
      "http://[2002:7f00:1::]/",
      "http://[fec0::1]/",
      "http://[0:0:0:0:0:0:0:1]/",
    ]) {
      await assert.rejects(assertPublicUrl(url), BlockedUrlError, url);
    }
    assert.equal(dynamicOrigin("http://[slug]/api"), true);
    assert.equal(dynamicOrigin("https://expected.com@[slug]/api"), true);
    assert.equal(dynamicOrigin("https://api.example.com/[slug]"), false);

    // 書き出したサイトも、同じ assertPublicUrl（lib/safe-fetch.ts の写し）で宛先を確かめる
    for (const blocked of [
      "http://localhost./",
      "http://localhost../",
      "http://127.0.0.1./",
      "http://metadata./",
      "http://db.intranet/",
      "http://:secret@example.com/",
      "http://[0:0:0:0:0:ffff:7f00:1]/",
    ]) {
      await assert.rejects(assertPublicUrl(blocked), BlockedUrlError, blocked);
    }
    assert.equal(isPrivateHost("api.example.com"), false);
  });

  test("clipboard assets and exported asset names refuse HTML files and style tag breakouts", async () => {
    const { mergeClipDeps } = await import("../lib/clip-transfer");
    const { buildAssetNames } = await import("../lib/generator/names");
    const { rawHtmlWithBodyStyles } = await import("../lib/generator/css");
    const { previewHtmlWithBodyStyles } = await import("../components/canvas/css");

    const doc = {
      siteName: "s",
      pageOrder: ["p"],
      assets: {},
      nodes: {},
      pages: {
        p: {
          id: "p",
          name: "Home",
          slug: "",
          title: "Home",
          description: "",
          children: [],
          htmlBackground: "red;</style><script>alert(1)</script>",
        },
      },
    };
    mergeClipDeps(doc as never, {
      v: 1,
      site: "evil", breakpoints: [{ id: "lg", label: "タブレット", maxWidth: 1024 }],
      nodes: [],
      rootIds: [],
      assets: {
        badHtml: { id: "badHtml", name: "evil.html", mimeType: "text/html", dataUrl: "data:text/html;base64,AAAA", width: 1, height: 1 },
        badPath: { id: "badPath", name: "a.png", mimeType: "image/png", path: "assets/../secret", width: 1, height: 1 },
        goodPng: { id: "goodPng", name: "ok.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1 },
      },
      components: {},
      componentNodes: [],
      customFonts: [], adobeFonts: [],
    });
    assert.deepEqual(Object.keys(doc.assets), ["goodPng"]);

    // 万一 doc.assets に .html の名前のアセットが入っていても、公開するファイル名に .html を使わない
    const names = buildAssetNames({
      ...doc,
      assets: { x: { id: "x", name: "page.html", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1 } },
    } as never);
    assert.equal(names.get("x"), "page.png");

    // bodyStyles や htmlBackground に </style> が含まれても、<style> タグから抜け出せない
    const rawOut = rawHtmlWithBodyStyles(doc as never, doc.pages.p as never, "<head></head><body></body>", new Map());
    assert.doesNotMatch(rawOut, /<\/style><script>/);
    const previewOut = previewHtmlWithBodyStyles(
      "<head></head><body></body>",
      { base: { default: { backgroundImage: "url(a)</style><script>alert(1)</script>" } } },
      "base"
    );
    assert.doesNotMatch(previewOut, /<\/style><script>/);
  });


  test("fetch classifies full IPv6 prefixes and reserved v4 networks", () => {
    for (const host of ["[2::1]", "[3::1]", "[2001:1ff::1]", "[2001:db8::1]", "[3fff:fff::1]",
      "198.51.100.7", "203.0.113.8", "192.88.99.4"]) {
      assert.equal(isPrivateHost(host), true, host);
    }
    for (const host of ["[2001:4860:4860::8888]", "[2606:4700::1111]"]) {
      assert.equal(isPrivateHost(host), false, host);
    }
  });

  test("canvas CSS drops unsafe motion and customCss rule breakouts", async () => {
    const { buildCanvasCss } = await import("../components/canvas/css");
    const { createInitialDoc } = await import("../lib/presets");
    const doc = createInitialDoc();
    const rootId = doc.pages[doc.pageOrder[0]].children[0];
    const node = doc.nodes[rootId];
    node.customCss = "color: red; /* unclosed; background: url(javascript:alert(1)); } .hdr { display: none !important";
    node.motions = [
      {
        id: "m1",
        trigger: "load",
        duration: 1,
        delay: 0,
        easing: "ease; } .pub-modal { opacity: 0",
        keyframes: "fade-in",
      },
      {
        id: "m2",
        trigger: "load",
        duration: 1,
        delay: 0,
        easing: "ease",
        keyframes: "custom",
        customKeyframes: "from { opacity: 0; } } .hdr { visibility: hidden; } @keyframes x { to { opacity: 1; }",
      },
      {
        id: "m3",
        trigger: "state",
        property: "opacity",
        duration: 0.2,
        delay: 0,
        easing: "ease-out",
      },
    ];
    const css = buildCanvasCss(doc, [rootId], "base", "preview", null, "default");
    assert.doesNotMatch(css, /\.pub-modal/);
    assert.doesNotMatch(css, /\.hdr/);
    assert.match(css, /color: red;/);
    assert.match(css, /transition: opacity 0\.2s ease-out 0s;/);
  });

  test("Next.js redirects and rewrites block private SSRF hosts, credentials, and backslash open-redirects", async () => {
    const { isSafeRedirectTarget, isSafeRewriteTarget } = await import("../lib/url-policy");
    const { generateProject } = await import("../lib/generator");
    const { runChecks } = await import("../lib/generator/checks");
    const { createInitialDoc } = await import("../lib/presets");

    for (const unsafeRewrite of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:3000/internal",
      "http://2130706433/",
      "http://localhost:8080/",
      "http://[::1]/",
      "http://metadata.google.internal/",
      "https://user:pass@example.com/",
      "https://example.com\\@internal/",
    ]) {
      assert.equal(isSafeRewriteTarget(unsafeRewrite), false, unsafeRewrite);
    }
    assert.equal(isSafeRewriteTarget("https://origin.example/base/:path*"), true);

    for (const unsafeRedirect of ["/\\evil.example", "//evil.example", "https://user:pass@example.com/", "javascript:alert(1)"]) {
      assert.equal(isSafeRedirectTarget(unsafeRedirect), false, unsafeRedirect);
    }
    assert.equal(isSafeRedirectTarget("/archive/:slug"), true);
    assert.equal(isSafeRedirectTarget("https://example.com/path"), true);

    const doc = createInitialDoc();
    doc.pages.ssrf = {
      id: "ssrf", name: "Proxy", slug: "proxy", title: "", description: "", children: [],
      rewriteTo: "http://169.254.169.254/latest/meta-data/",
    };
    doc.pages.badRedirect = {
      id: "badRedirect", name: "BadRedirect", slug: "go", title: "", description: "", children: [],
      redirectTo: "/\\evil.example",
    };
    doc.pageOrder.push("ssrf", "badRedirect");
    const checks = runChecks(doc);
    assert.ok(checks.some((c) => c.level === "error" && c.message.includes("Proxy")));
    assert.ok(checks.some((c) => c.level === "error" && c.message.includes("BadRedirect")));

    const out = generateProject(doc, "production");
    assert.doesNotMatch(out.files["next.config.mjs"], /169\.254\.169\.254/);
    assert.doesNotMatch(out.files["next.config.mjs"], /evil\.example/);
  });

  test("Vue SSR server enforces nosniff, sandboxes static SVGs, and never serves raw index.html template", async () => {
    const { generateExportProject } = await import("../lib/export-formats");
    const { createInitialDoc } = await import("../lib/presets");
    const doc = createInitialDoc();
    doc.pageOrder = [doc.pageOrder[0]];
    const vue = generateExportProject(doc, "vue");
    const server = vue.files["server.mjs"];
    assert.match(server, /file !== templateFile/);
    assert.match(server, /"X-Content-Type-Options": "nosniff"/);
    assert.match(server, /ext === "\.svg".*sandbox/);
    assert.match(server, /"\.webmanifest": "application\/manifest\+json"/);
  });

  test("i18n format and trNodes ignore Object.prototype keys", async () => {
    const { format, trNodes } = await import("../lib/i18n");
    assert.equal(format("Hello {constructor} {toString} {name}", { name: "Tsumu" }), "Hello {constructor} {toString} Tsumu");
    const nodes = trNodes("Run {constructor} and {cmd}", { cmd: "ok" });
    assert.equal(nodes.map((part) => (typeof part === "string" ? part : (part as { props?: { children?: unknown } }).props?.children)).join(""), "Run {constructor} and ok");
  });
});

describe("canvas-html-sandbox", () => {
  test("custom HTML iframes cannot combine scripts with the editor's same-origin privileges", () => {
    const source = readFileSync(new URL("../lib/canvas-html.ts", import.meta.url), "utf8");
    const match = /const IFRAME_SANDBOX = "([^"]+)";/.exec(source);
    assert.ok(match, "custom HTML sanitization must set an explicit iframe sandbox");
    const permissions = new Set(match[1].split(/\s+/));
    assert.ok(permissions.has("allow-scripts"), "embedded preview scripts remain supported");
    assert.ok(!permissions.has("allow-same-origin"),
      "untrusted srcdoc/same-origin iframes must not escape their sandbox");
    assert.ok(!permissions.has("allow-top-navigation"));
    assert.ok(!permissions.has("allow-top-navigation-by-user-activation"));
    assert.match(source, /node\.setAttribute\("sandbox", IFRAME_SANDBOX\)/);
    assert.match(source, /\["a", "area", "form"\]\.includes\(node\.nodeName\.toLowerCase\(\)\)/);
    assert.match(source, /node\.setAttribute\("rel", "noopener noreferrer"\)/);
    assert.match(source, /FORBID_TAGS:\s*\["base",\s*"link",\s*"meta",\s*"style"\]/);
    assert.match(source, /FORBID_ATTR:\s*\["formaction",\s*"formtarget"\]/);
    assert.match(source, /isReservedDataAttribute\(attr\.name\)/);
  });

  test("canvas embed iframes apply sandbox restrictions, reject same-origin editor framing, and sanitize ImageRef/thumbnail URLs", async () => {
    const {
      EMBED_SANDBOX_TRUSTED,
      EMBED_SANDBOX_URL,
      embedSrc,
      isSameOriginEmbed,
    } = await import("../lib/embed");
    const { imageRefSrc } = await import("../lib/generator/render-helpers");
    const { siteThumbnailImages } = await import("../lib/site-thumbnail");
    const { createInitialDoc } = await import("../lib/presets");

    for (const box of [EMBED_SANDBOX_TRUSTED, EMBED_SANDBOX_URL]) {
      const perms = new Set(box.split(/\s+/));
      assert.ok(!perms.has("allow-top-navigation"));
      assert.ok(!perms.has("allow-top-navigation-by-user-activation"));
      assert.ok(!perms.has("allow-modals"));
      assert.ok(!perms.has("allow-downloads"));
    }
    assert.equal(embedSrc({ kind: "url", src: "https://user:pass@example.com/embed" }), null);
    assert.equal(embedSrc({ kind: "url", src: "https://example.com/\nwidget" }), null);
    assert.equal(isSameOriginEmbed("https://editor.example.com/sites/a", "https://editor.example.com"), true);
    assert.equal(isSameOriginEmbed("https://widgets.example.org/embed", "https://editor.example.com"), false);

    const renderSource = readFileSync(new URL("../components/canvas/render.tsx", import.meta.url), "utf8");
    assert.match(renderSource, /sandbox:\s*node\.embed\.kind === "url" \? EMBED_SANDBOX_URL : EMBED_SANDBOX_TRUSTED/);
    assert.match(renderSource, /isSameOriginEmbed\(/);

    const emptyMap = new Map<string, string>();
    for (const unsafe of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "//evil.example/a.png"]) {
      assert.equal(imageRefSrc(emptyMap, { url: unsafe }), null, unsafe);
      const doc = createInitialDoc();
      doc.favicon = { url: unsafe };
      doc.ogImage = { url: unsafe };
      assert.deepEqual(siteThumbnailImages(doc, "site-1"), []);
    }
    assert.equal(imageRefSrc(emptyMap, { url: "https://cdn.example.com/icon.png" }), "https://cdn.example.com/icon.png");
  });

  test("siteOwnsAssets rejects cross-site asset claiming unless uploaded or already referenced", async () => {
    const { siteOwnsAssets } = await import("../lib/site-asset-access");
    const uploads = new Map<string, Set<string>>([["site-a", new Set(["assets/a-upload.png"])]]);
    const db = {
      backend: "sqlite" as const,
      async execute(input: string | { sql: string; args: (string | number | null)[] }) {
        const sql = typeof input === "string" ? input : input.sql;
        const args = typeof input === "string" ? [] : input.args;
        if (sql.includes("FROM site_asset_uploads")) {
          const siteId = String(args[0]);
          const siteSet = uploads.get(siteId) ?? new Set();
          return {
            rows: args.slice(1).filter((p) => siteSet.has(String(p))).map((p) => ({ path: String(p) })),
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
      async batch(stmts: Array<string | { sql: string; args: (string | number | null)[] }>) {
        return Promise.all(stmts.map((s) => this.execute(s)));
      },
    };

    assert.equal(await siteOwnsAssets(db, "site-a", []), true);
    assert.equal(await siteOwnsAssets(db, "site-a", ["assets/a-upload.png"]), true);
    assert.equal(await siteOwnsAssets(db, "site-a", ["assets/b-secret.png"], async () => null), false);
    assert.equal(
      await siteOwnsAssets(db, "site-a", ["assets/copied.png"], async () => JSON.stringify({ assets: { x: { path: "assets/copied.png" } } })),
      true,
    );
  });
});
});

describe("server-auth-identity", () => {
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
});

describe("viewer-write-security", () => {
class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), init);
  }
}

const editorOnly: Record<string, string[]> = {
  "app/api/ai/route.ts": ["POST"],
  "app/api/assets/route.ts": ["POST", "PATCH", "DELETE"],
  "app/api/assets/trash/route.ts": ["POST", "DELETE"],
  "app/api/comments/route.ts": ["POST"],
  "app/api/doc/route.ts": ["PUT", "PATCH"],
  "app/api/sites/route.ts": ["POST"],
  "app/api/sites/[id]/route.ts": ["PATCH", "DELETE"],
  "app/api/sites/[id]/members/route.ts": ["GET", "PUT", "DELETE"],
  "app/api/publish/route.ts": ["POST"],
  "app/api/publish/history/route.ts": ["POST"],
  "app/api/fetch-json/route.ts": ["POST"],
};

test("viewers are rejected before every document or site mutation reaches storage", async () => {
  for (const [path, methods] of Object.entries(editorOnly)) {
    const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    const code = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
    const mod = { exports: {} as Record<string, any> };
    const deniedModes: unknown[] = [];
    const shared: Record<string, unknown> = {
      NextResponse,
      requireAuth: async (mode: unknown) => {
        deniedModes.push(mode);
        if (mode === "editor" || mode === "editor-user") return NextResponse.json({ error: "View only" }, { status: 403 });
        return null;
      },
      serverTr: async () => (value: string) => value,
    };
    new Function("require", "module", "exports", code)(
      (_path: string) => new Proxy({}, {
        get: (_target, key: string | symbol) => typeof key === "string" ? shared[key] : undefined,
      }),
      mod, mod.exports,
    );
    for (const method of methods) {
      deniedModes.length = 0;
      const res = await mod.exports[method](
        new Request("https://example.test/api/site?site=s1", { method }),
        { params: Promise.resolve({ id: "s1" }) },
      );
      assert.equal(res.status, 403, path + " " + method);
      assert.deepEqual(
        deniedModes,
        [
          path.includes("/doc/") ||
          path.includes("/comments/") ||
          path.includes("/members/") ||
          path === "app/api/sites/route.ts"
            ? "editor-user"
            : "editor",
        ],
        path + " " + method + " must authorize before accessing data",
      );
    }
  }
});
});
