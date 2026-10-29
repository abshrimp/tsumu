import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, describe } from "node:test";
import { transformSync } from "esbuild";
import { isValidEmail } from "../lib/email";
import { anonymousAllowed, anonymousHostAllowed, isLoopbackHost } from "../lib/anonymous";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

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
      NextResponse, isValidEmail,
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
      NextResponse, isValidEmail, JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited, dbUnavailable: () => { throw new Error("Unexpected unavailable"); },
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
      "../../../lib/api-json": { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited },
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
    const GET = module.exports.GET as () => Promise<Response>;
    const send = (value: unknown, contentType = "application/json") => POST(new Request("https://editor.example.test/api/allowed-users", {
      method: "POST", body: JSON.stringify(value),
      headers: { "Content-Type": contentType },
    }));
    return { send, get: () => GET(), inserted };
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
});
