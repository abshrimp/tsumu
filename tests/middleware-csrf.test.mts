import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { NextRequest, NextResponse } from "next/server";
import { isCrossSiteWrite } from "../lib/csrf";

const code = transformSync(readFileSync(new URL("../middleware.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs", target: "es2022",
}).code;

function fixture(configured: boolean) {
  let sessionChecks = 0;
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "./auth": {
      authConfigured: () => configured,
      middlewareAuth: async () => {
        sessionChecks++;
        return { user: { email: "editor@example.test" } };
      },
    },
    "./lib/lang": { langOfRequest: () => "en" },
    "./lib/csrf": { isCrossSiteWrite },
    "./lib/anonymous": { anonymousAllowed: () => true },
  };
  const module = { exports: {} as { default: (req: NextRequest) => Promise<Response> } };
  new Function("require", "module", "exports", code)((id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return { middleware: module.exports.default, sessionChecks: () => sessionChecks };
}

for (const configured of [true, false]) {
  test(`middleware rejects malformed CSRF headers before access checks (${configured ? "authenticated" : "anonymous"})`, async () => {
    const { middleware, sessionChecks } = fixture(configured);
    const cases: Record<string, string>[] = [
      { origin: "" },
      { "sec-fetch-site": "", origin: "https://editor.example.test" },
      { origin: "https://editor.example.test", "x-forwarded-host": "ignored@editor.example.test" },
      { origin: "https://editor.example.test", "x-forwarded-host": "editor.example.test/path" },
    ];
    for (const headers of cases) {
      const response = await middleware(new NextRequest("https://editor.example.test/api/doc", {
        method: "PUT", headers,
      }));
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(response.headers.get("x-middleware-next"), null);
    }
    assert.equal(sessionChecks(), 0, "invalid requests must stop before session checks");
  });

  test(`middleware preserves valid CSRF requests (${configured ? "authenticated" : "anonymous"})`, async () => {
    const { middleware, sessionChecks } = fixture(configured);
    const cases: Record<string, string>[] = [
      {},
      { origin: "https://editor.example.test", "sec-fetch-site": "same-origin" },
      { origin: "https://public.example.test", "x-forwarded-host": "public.example.test", "x-forwarded-proto": "https" },
    ];
    for (const headers of cases) {
      const response = await middleware(new NextRequest("https://editor.example.test/api/doc", {
        method: "PUT", headers,
      }));
      assert.equal(response.headers.get("x-middleware-next"), "1", JSON.stringify(headers));
    }
    assert.equal(sessionChecks(), configured ? 3 : 0);
  });
}
