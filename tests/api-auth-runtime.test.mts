import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { isValidEmail } from "../lib/email";

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
