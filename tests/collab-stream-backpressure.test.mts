import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import type { DocChangeMessage } from "../lib/collab";

function handler(authorize: () => Promise<boolean> = async () => true) {
  let listener: ((message: DocChangeMessage, raw: string) => void) | null = null;
  let unsubscribed = 0;
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: class extends Response {} },
    "../../../../lib/anonymous": { collaborationIdentityAllowed: () => true },
    "../../../../lib/server": { requireAuth: async () => ({ email: "editor@example.com" }) },
    "../../../../lib/allowlist": { isEmailAllowed: authorize },
    "../../../../auth": { authConfigured: () => true },
    "../../../../lib/site-server": { siteIdOf: async () => "site" },
    "../../../../lib/collab": { collabRoomAvailable: () => false },
    "../../../../lib/collab-events": { subscribeDocUpdates: (_: string, callback: typeof listener) => {
      listener = callback;
      return () => { listener = null; unsubscribed++; };
    } },
  };
  const source = readFileSync(new URL("../app/api/collab/events/route.ts", import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} as { GET(req: Request): Promise<Response> } };
  new Function("require", "module", "exports", code)((name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports);
  return {
    GET: module.exports.GET,
    emit: (raw: string) => listener?.({ type: "doc-patched", rev: "2", base: "1", savedAt: 1, patch: [] }, raw),
    unsubscribed: () => unsubscribed,
  };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("a stalled authorization cannot retain an unlimited queue of collaboration notifications", async t => {
  let finish!: (allowed: boolean) => void;
  let checks = 0;
  const h = handler(() => {
    checks++;
    return new Promise<boolean>(resolve => { finish = resolve; });
  });
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  for (let i = 0; i < 100; i++) h.emit(JSON.stringify({ revision: i }));
  assert.equal(h.unsubscribed(), 1, "overflow immediately removes the listener");
  await assert.rejects(reader.read(), /buffer exceeded/);
  finish(true);
  await tick();
  assert.equal(checks, 1, "discarded messages must not continue querying authorization");
});

test("an unread stream is bounded by UTF-8 bytes and releases its queued data on overflow", async t => {
  const h = handler();
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  await reader.read();
  const large = "あ".repeat(4 * 1024 * 1024); // UTF-8 では 12 MiB だが、コード単位では 4 MiB にすぎない。
  for (let i = 0; i < 6; i++) {
    h.emit(large);
    await tick();
  }
  assert.equal(h.unsubscribed(), 1);
  await assert.rejects(reader.read(), /buffer exceeded/, "overflow discards old chunks instead of draining an obsolete queue");
});

test("a consuming client keeps notification order and cancellation removes the listener once", async () => {
  const h = handler();
  const abort = new AbortController();
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), ": connected\n\n");
  for (let i = 0; i < 80; i++) {
    const raw = JSON.stringify({ revision: i });
    h.emit(raw);
    assert.equal(new TextDecoder().decode((await reader.read()).value), `data: ${raw}\n\n`);
  }
  await reader.cancel();
  abort.abort();
  assert.equal(h.unsubscribed(), 1);
});

test("aborting during authorization discards pending output", async () => {
  let finish!: (allowed: boolean) => void;
  const h = handler(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const abort = new AbortController();
  const response = await h.GET(new Request("https://editor.example/api/collab/events?site=site", { signal: abort.signal }));
  const reader = response.body!.getReader();
  h.emit('{"secret":"pending"}');
  abort.abort();
  finish(true);
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
  assert.equal(h.unsubscribed(), 1);
});
