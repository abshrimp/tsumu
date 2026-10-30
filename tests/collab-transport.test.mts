import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformSync } from "esbuild";

class NextResponse extends Response {
  static json(value: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(value), init);
  }
}

const source = transformSync(readFileSync(new URL("../app/api/status/route.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "cjs", target: "es2022",
}).code;

async function statusWith(db: boolean, room: boolean) {
  let roomChecks = 0;
  const imports: Record<string, unknown> = {
    NextResponse,
    requireAuth: async () => null,
    authConfigured: () => false,
    dbConfigured: () => db,
    collabRoomAvailable: () => { roomChecks++; return room; },
    assetStore: () => null,
    getAccountRole: async () => "editor",
  };
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", source)(
    () => new Proxy({}, { get: (_target, key) => typeof key === "string" ? imports[key] : undefined }),
    module, module.exports,
  );
  const response = await module.exports.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { body: await response.json(), roomChecks };
}

test("browser-only mode disables collaboration even if a room binding exists", async () => {
  const { body, roomChecks } = await statusWith(false, true);
  assert.equal(body.db, false);
  assert.equal(body.collabTransport, "none");
  assert.equal(roomChecks, 0);
});

test("Node.js and Docker use SSE when server storage exists without Durable Objects", async () => {
  const { body, roomChecks } = await statusWith(true, false);
  assert.equal(body.db, true);
  assert.equal(body.collabTransport, "sse");
  assert.equal(roomChecks, 1);
});

test("Cloudflare Workers use WebSockets when server storage and collaboration rooms exist", async () => {
  const { body, roomChecks } = await statusWith(true, true);
  assert.equal(body.db, true);
  assert.equal(body.collabTransport, "websocket");
  assert.equal(roomChecks, 1);
});
