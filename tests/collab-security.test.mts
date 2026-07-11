import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { addAllowedEmail, removeAllowedEmail } from "../lib/allowlist";
import { nodeDatabase } from "../lib/node-storage";
import { getDb, getDbFromBinding } from "../lib/db";
import { readCurrentDoc, saveCurrentDoc, saveDocPatch } from "../lib/doc-storage";
import { createDocPatch } from "../lib/doc-patch";
import { createInitialDoc } from "../lib/presets";
import { insertSite } from "../lib/sites";
import { publishDocUpdate } from "../lib/collab-events";

// 実際のハンドラを実行し、Cloudflare のホスト環境・Next のリクエストコンテキストだけを置き換える。
function loadHandler(path: string, mocks: Record<string, unknown>): any {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const source = readFileSync(url, "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports;
}

async function withAllowlist(run: () => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-collab-auth-"));
  const previous = { TSUMU_DATA_DIR: process.env.TSUMU_DATA_DIR, ALLOWED_EMAILS: process.env.ALLOWED_EMAILS };
  process.env.TSUMU_DATA_DIR = dir;
  process.env.ALLOWED_EMAILS = "owner@example.com";
  try {
    await addAllowedEmail("editor@example.com");
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function socket(email: string, delta = false) {
  return {
    messages: [] as string[], closed: false,
    deserializeAttachment: () => ({ clientId: email, siteId: "s1", delta, user: { email } }),
    send(raw: string) { this.messages.push(raw); },
    close(code: number) { assert.equal(code, 1008); this.closed = true; },
  };
}

test("each broadcast reads the allowlist once and refreshes it before the next broadcast", async () => {
  let emails = ["first@example.com", "second@example.com"];
  let reads = 0;
  const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
    "cloudflare:workers": { DurableObject: class {
      constructor(public ctx: unknown, public env: unknown) {}
    } },
    "./.open-next/worker.js": {},
    "./lib/db": { getDbFromBinding: async () => ({ execute: async () => {
      reads++;
      return { rows: emails.map((email) => ({ email })) };
    } }) },
  });
  const first = socket("first@example.com");
  const second = socket("second@example.com");
  const room = new CollaborationRoom({ getWebSockets: () => [first, second] }, {
    DB: {}, ALLOWED_EMAILS: "", AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
  });
  const broadcast = () => room.fetch(new Request("https://room/broadcast", {
    method: "POST", body: '{"type":"doc-updated"}',
  }));
  await broadcast();
  assert.equal(reads, 1);
  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 1);
  emails = ["second@example.com"];
  await broadcast();
  assert.equal(reads, 2);
  assert.equal(first.closed, true);
  assert.equal(first.messages.length, 1, "revoked recipients must not receive another update");
  assert.equal(second.messages.length, 2);
});

test("WebSocket patch saves notify new clients with a delta and legacy clients with a snapshot", async () => {
  await withAllowlist(async () => {
    const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class {
        constructor(public ctx: unknown, public env: unknown) {}
      } },
      "./.open-next/worker.js": {},
    });
    const db = await getDb();
    await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const base = createInitialDoc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = { ...base, siteName: "Changed through a patch" };
    const patch = createDocPatch(base, next)!;
    const sender = socket("owner@example.com", true);
    const modern = socket("editor@example.com", true);
    const legacy = socket("editor@example.com");
    const room = new CollaborationRoom({ getWebSockets: () => [sender, modern, legacy] }, {
      DB: nodeDatabase(), ALLOWED_EMAILS: "owner@example.com",
      AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
    });
    await room.webSocketMessage(sender, JSON.stringify({ type: "patch", requestId: "p1", base: "1", patch }));
    assert.equal(JSON.parse(sender.messages[0]).type, "saved");
    const delta = JSON.parse(modern.messages[0]);
    assert.equal(delta.type, "doc-patched");
    assert.deepEqual(delta.patch, patch);
    assert.equal(delta.doc, undefined);
    assert.equal(delta.base, "1");
    assert.deepEqual(JSON.parse(legacy.messages[0]).doc, next);
    await room.webSocketMessage(sender, JSON.stringify({ type: "patch", requestId: "p2", base: "1", patch }));
    assert.equal(JSON.parse(sender.messages[1]).type, "conflict");
    assert.equal(modern.messages.length, 1, "rejected patches must not be broadcast");
  });
});

test("HTTP PATCH enforces revision checks and publishes only the delta", async () => {
  await withAllowlist(async () => {
    const updates: any[] = [];
    const { PATCH } = loadHandler("../app/api/doc/route.ts", {
      "../../../lib/server": { requireAuth: async () => null, sessionUser: async () => ({ email: "owner@example.com" }) },
      "../../../lib/i18n-server": { serverTr: async () => (value: string) => value },
      "../../../lib/site-server": { siteIdOf: async () => "s1" },
      "../../../lib/collab": { notifyDocUpdated: (_site: string, message: any) => updates.push(message) },
    });
    const db = await getDb();
    await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const base = createInitialDoc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = { ...base, siteName: "HTTP delta" };
    const patch = createDocPatch(base, next)!;
    const request = (query: string, body = patch) => new Request(`https://editor.example/api/doc?site=s1${query}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-Collab-Client-Id": "client1" }, body: JSON.stringify(body),
    });
    assert.equal((await PATCH(request(""))).status, 400);
    assert.equal((await PATCH(request("&base=1", [{ path: ["pages"], remove: true }]))).status, 400);
    assert.equal((await PATCH(request("&base=1"))).status, 200);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].type, "doc-patched");
    assert.equal(updates[0].doc, undefined);
    assert.equal(updates[0].senderId, "client1");
    assert.equal((await PATCH(request("&base=1"))).status, 409);
    assert.equal(updates.length, 1);
    assert.deepEqual(JSON.parse((await readCurrentDoc(db, "s1"))!.body), next);
  });
});

test("SSE negotiates delta notifications and keeps legacy clients synchronized", async () => {
  await withAllowlist(async () => {
    const { GET } = loadHandler("../app/api/collab/events/route.ts", {
      "../../../../lib/server": { requireAuth: async () => null, sessionUser: async () => ({ email: "editor@example.com" }) },
      "../../../../auth": { authConfigured: () => true },
      "../../../../lib/site-server": { siteIdOf: async () => "s1" },
      "../../../../lib/collab": { collabRoomAvailable: () => false },
    });
    const db = await getDb();
    await insertSite(db, "s1", { name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    const base = createInitialDoc();
    await saveCurrentDoc(db, "s1", JSON.stringify(base), null);
    const next = { ...base, siteName: "SSE delta" };
    const patch = createDocPatch(base, next)!;
    await saveDocPatch(db, "s1", patch, "1");
    const abort = new AbortController();
    const modern = (await GET(new Request("https://editor.example/api/collab/events?site=s1&delta=1", { signal: abort.signal }))).body.getReader();
    const legacy = (await GET(new Request("https://editor.example/api/collab/events?site=s1", { signal: abort.signal }))).body.getReader();
    try {
      await Promise.all([modern.read(), legacy.read()]);
      publishDocUpdate("s1", { type: "doc-patched", base: "1", rev: "2", savedAt: 1, patch });
      const decode = (data: Uint8Array) => JSON.parse(new TextDecoder().decode(data).slice(6).trim());
      assert.equal(decode((await modern.read()).value).type, "doc-patched");
      const snapshot = decode((await legacy.read()).value);
      assert.equal(snapshot.type, "doc-updated");
      assert.deepEqual(snapshot.doc, next);
    } finally {
      abort.abort();
      await Promise.all([modern.cancel(), legacy.cancel()]);
    }
  });
});

test("open WebSockets lose read, write and broadcast access when their account is removed", async () => {
  await withAllowlist(async () => {
    const { CollaborationRoom } = loadHandler("../custom-worker.ts", {
      "cloudflare:workers": { DurableObject: class {
        constructor(public ctx: unknown, public env: unknown) {}
      } },
      "./.open-next/worker.js": {},
    });
    const editor = socket("editor@example.com");
    const owner = socket("owner@example.com");
    const room = new CollaborationRoom({ getWebSockets: () => [editor, owner] }, {
      DB: nodeDatabase(), ALLOWED_EMAILS: "owner@example.com",
      AUTH_SECRET: "test", AUTH_GOOGLE_ID: "test", AUTH_GOOGLE_SECRET: "test",
    });
    await room.webSocketMessage(editor, "ping");
    assert.deepEqual(editor.messages, ["pong"]);
    editor.messages = [];
    await insertSite(await getDb(), "s1", {
      name: "s1", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null,
    });
    await removeAllowedEmail("editor@example.com");
    await room.webSocketMessage(editor, JSON.stringify({ type: "save", requestId: "save1", doc: createInitialDoc(), base: null }));
    assert.equal(await readCurrentDoc(await getDb(), "s1"), null, "revoked sockets cannot save");
    await room.webSocketMessage(editor, JSON.stringify({ type: "load", requestId: "load1" }));
    await room.webSocketMessage(owner, JSON.stringify({ type: "save", requestId: "save2", doc: createInitialDoc(), base: null }));
    assert.ok(await readCurrentDoc(await getDbFromBinding(nodeDatabase()!), "s1"));
    assert.equal(JSON.parse(owner.messages[0]).type, "saved");
    await room.fetch(new Request("https://room/broadcast", { method: "POST", body: '{"type":"doc-updated"}' }));
    assert.equal(owner.messages.length, 2, "allowed recipients still receive updates");
    assert.equal(editor.closed, true);
    assert.deepEqual(editor.messages, [], "revoked recipients cannot load or receive either broadcast path");
  });
});

test("an open SSE stream closes without leaking the next document after revocation", async () => {
  await withAllowlist(async () => {
    const { GET } = loadHandler("../app/api/collab/events/route.ts", {
      "../../../../lib/server": { requireAuth: async () => null, sessionUser: async () => ({ email: "editor@example.com" }) },
      "../../../../auth": { authConfigured: () => true },
      "../../../../lib/site-server": { siteIdOf: async () => "s1" },
      "../../../../lib/collab": { collabRoomAvailable: () => false },
    });
    const abort = new AbortController();
    const response = await GET(new Request("https://editor.example/api/collab/events?site=s1", { signal: abort.signal }));
    const reader = response.body.getReader();
    try {
      assert.equal(new TextDecoder().decode((await reader.read()).value), ": connected\n\n");
      await removeAllowedEmail("editor@example.com");
      publishDocUpdate("s1", { type: "doc-updated", doc: createInitialDoc(), rev: "1", savedAt: 1 });
      assert.equal((await reader.read()).done, true);
    } finally {
      abort.abort();
      await reader.cancel();
    }
  });
});
