import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { load, setup, original, edit } from "./helpers/document-generation-api";
import { StructuredDocumentStore, type DocumentSqlStorage } from "../lib/structured-document-store";

const fallback = "処理に失敗しました";
const marker = "PRIVATE_秘密";
const patch = [{ path: ["siteName"], value: "Changed" }];
async function fixture(t: TestContext) {
  const h = await setup(t);
  const roomKey = await h.create("source");
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const storage: DocumentSqlStorage = {
    sql: { exec(sql, ...args) {
      const stmt = sqlite.prepare(sql);
      if (stmt.columns().length) return { toArray: () => stmt.all(...args) as Record<string, unknown>[] };
      stmt.run(...args); return { toArray: () => [] };
    } },
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  const store = new StructuredDocumentStore(storage);
  store.replace(JSON.stringify(original), null);
  const remote = {
    getSnapshot: async () => store.snapshot(),
    replaceDocument: async (raw: string, base: string | null) => store.replace(raw, base),
    patchDocument: async (value: any, base: string) => store.patch(value, base),
  };
  const { CollaborationRoom } = load("../../custom-worker.ts", {
    "cloudflare:workers": { DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } },
    "./.open-next/worker.js": {}, "./document-room": {},
    "./lib/db": { getDbFromBinding: async () => h.db },
  });
  const socket = () => ({ messages: [] as string[],
    deserializeAttachment: () => ({ clientId: "synthetic", siteId: "source", roomKey }),
    send(raw: string) { this.messages.push(raw); },
    close() { assert.fail("unexpected socket close"); },
  });
  const sender = socket(), peer = socket();
  const env: any = { ALLOW_ANONYMOUS: "true", DB: {}, DOC_STORE: { idFromName: (key: string) => key, get: () => remote } };
  const room = new CollaborationRoom({ getWebSockets: () => [sender, peer] }, env);
  const send = async (input: Record<string, unknown>) => {
    const before = sender.messages.length;
    await room.webSocketMessage(sender, JSON.stringify({ requestId: "req-1", ...input }));
    assert.equal(sender.messages.length, before + 1);
    return JSON.parse(sender.messages.at(-1)!);
  };
  return { ...h, sqlite, store, remote, sender, peer, env, send };
}

for (const scenario of ["load-props", "load-entry", "patch-props", "patch-node", "patch-structural", "save-conflict", "patch-conflict", "save-backup", "patch-backup"]) {
  test(`WebSocket redacts stored JSON failures: ${scenario}`, async t => {
    const h = await fixture(t);
    const props = scenario.endsWith("props");
    if (props) h.sqlite.prepare("UPDATE document_meta SET props=?").run(marker);
    else h.sqlite.prepare("UPDATE document_entries SET body=? WHERE bucket='nodes'").run(marker);
    if (scenario.endsWith("backup")) h.sqlite.exec("UPDATE document_meta SET saved_at=1");
    const input = scenario.startsWith("load") ? { type: "load" }
      : scenario.startsWith("save") ? { type: "save", doc: edit, base: scenario.endsWith("conflict") ? "9" : "1" }
      : { type: "patch", base: scenario.endsWith("conflict") ? "9" : "1", patch:
        scenario === "patch-node" ? [{ path: ["nodes", Object.keys(original.nodes)[0]], value: Object.values(original.nodes)[0] }]
        : scenario === "patch-structural" ? [{ path: ["pages"], value: original.pages }] : patch };
    // ハンドラーの模擬の例外だけに頼らず、実際の保存の層で起きた例外を確かめる。
    const operation = () => input.type === "load" ? h.store.snapshot()
      : input.type === "save" ? h.store.replace(JSON.stringify(edit), input.base!)
      : h.store.patch(input.patch!, input.base!);
    assert.throws(operation, error => error instanceof SyntaxError && error.message.includes(marker));
    assert.deepEqual(await h.send(input), { type: "error", requestId: "req-1", message: fallback });
    assert.equal(h.store.meta()!.rev, "1");
    assert.deepEqual(h.peer.messages, []);
    assert.deepEqual(h.logs(), []);
  });
}

test("WebSocket preserves normal snapshots, saves, patches and conflicts", async t => {
  const h = await fixture(t);
  const first = await h.send({ type: "load" });
  assert.equal(first.type, "snapshot"); assert.equal(first.requestId, "req-1"); assert.deepEqual(first.doc, original);
  const saved = await h.send({ type: "save", doc: edit, base: "1" });
  assert.equal(saved.type, "saved"); assert.equal(saved.rev, "2"); assert.equal(saved.requestId, "req-1");
  assert.deepEqual(JSON.parse(h.peer.messages[0]).doc, edit);
  const updated = await h.send({ type: "patch", patch, base: "2" });
  assert.equal(updated.type, "saved"); assert.equal(updated.rev, "3"); assert.equal(updated.requestId, "req-1");
  assert.deepEqual(JSON.parse(h.peer.messages[1]).patch, patch);
  for (const input of [{ type: "save", doc: edit }, { type: "patch", patch }]) {
    const conflict = await h.send({ ...input, base: "1" });
    assert.equal(conflict.type, "conflict"); assert.equal(conflict.requestId, "req-1"); assert.equal(conflict.rev, "3");
    assert.deepEqual(conflict.doc, { ...edit, siteName: "Changed" });
    assert.equal(conflict.savedAt, updated.savedAt);
  }
  assert.equal(h.peer.messages.length, 2);
});

test("WebSocket preserves fixed public errors but redacts arbitrary English and Japanese failures", async t => {
  const h = await fixture(t);
  const publicMessages = [
    "保存先が設定されていません", "サイトが指定されていません", "サイトが見つかりません",
    "DOC_STORE binding is missing", "未対応のメッセージです", "不正なリクエスト", "JSONが壊れています",
    "ドキュメントが大きすぎて、保存先に入りきりません", "編集データの1項目が大きすぎます",
    "保存済み編集データが破損しています", "バックアップが破損しています", "Unsupported document storage schema",
    "Invalid document path", "Invalid document patch", "Missing patch collection", "Invalid patch key",
    "Unsupported storage schema", "D1バインディング（DB）がありません",
  ];
  for (const message of publicMessages) {
    h.remote.getSnapshot = async () => { throw new Error(message); };
    assert.deepEqual(await h.send({ type: "load" }), { type: "error", requestId: "req-1", message });
  }
  for (const error of [new Error(`Database failed: ${marker}`), new Error(`保存失敗: ${marker}`), new Error(`${publicMessages[0]} ${marker}`), marker, { message: marker }]) {
    h.remote.getSnapshot = async () => { throw error; };
    assert.deepEqual(await h.send({ type: "load" }), { type: "error", requestId: "req-1", message: fallback });
  }
  assert.deepEqual(h.logs(), []);
});

test("WebSocket keeps real validation, configuration, corruption, missing and capacity errors", async t => {
  const h = await fixture(t);
  const check = async (input: Record<string, unknown>, message: string) =>
    assert.deepEqual(await h.send(input), { type: "error", requestId: "req-1", message });
  await check({ type: "unknown" }, "未対応のメッセージです");
  await check({ type: "save", doc: {}, base: "1" }, "不正なリクエスト");
  await check({ type: "patch", patch, base: "invalid" }, "不正なリクエスト");
  await check({ type: "patch", patch: [{ path: ["siteName"], value: "x".repeat(7_000_001) }], base: "1" }, "編集データの1項目が大きすぎます");
  await check({ type: "patch", patch: [{ path: ["components", "absent"], remove: true }], base: "1" }, "Missing patch collection");
  h.sqlite.exec("UPDATE document_meta SET props='null'");
  await check({ type: "load" }, "保存済み編集データが破損しています");
  h.store.erase();
  await check({ type: "patch", patch, base: "1" }, "サイトが見つかりません");
  h.env.DOC_STORE = undefined;
  await check({ type: "load" }, "DOC_STORE binding is missing");
  h.env.DB = undefined;
  await check({ type: "load" }, "保存先が設定されていません");
  assert.deepEqual(h.logs(), [["D1 database is not configured: set database_id on the DB binding in wrangler.jsonc"]]);
});
