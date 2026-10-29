import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), init);
  }
}

const editorOnly: Record<string, string[]> = {
  "app/api/ai/route.ts": ["POST"],
  "app/api/assets/route.ts": ["POST", "DELETE"],
  "app/api/assets/trash/route.ts": ["POST", "DELETE"],
  "app/api/comments/route.ts": ["POST"],
  "app/api/doc/route.ts": ["PUT", "PATCH"],
  "app/api/sites/route.ts": ["POST"],
  "app/api/sites/[id]/route.ts": ["PATCH", "DELETE"],
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
      assert.deepEqual(deniedModes, [path.includes("/doc/") || path.includes("/comments/") || path === "app/api/sites/route.ts" ? "editor-user" : "editor"], path + " " + method + " must authorize before accessing data");
    }
  }
});
