import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { addAllowedEmail, removeAllowedEmail } from "../lib/allowlist";
import { nodeDatabase } from "../lib/node-storage";
import { getDb, getDbFromBinding } from "../lib/db";
import { readCurrentDoc } from "../lib/doc-storage";
import { createInitialDoc } from "../lib/presets";
import { insertSite } from "../lib/sites";
import { publishDocUpdate } from "../lib/collab-events";

// 実際のハンドラを実行し、Cloudflare のホスト環境・Next のリクエストコンテキストだけを置き換える。
function loadHandler(path: string, mocks: Record<string, unknown>): any {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const source = readFileSync(url, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
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

function socket(email: string) {
  return {
    messages: [] as string[], closed: false,
    deserializeAttachment: () => ({ clientId: email, siteId: "s1", user: { email } }),
    send(raw: string) { this.messages.push(raw); },
    close(code: number) { assert.equal(code, 1008); this.closed = true; },
  };
}

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
