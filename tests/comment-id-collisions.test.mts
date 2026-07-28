import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";
import * as comments from "../lib/comments";
import type { ActivityUser } from "../lib/activity";
import { userMessage } from "../lib/errors";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

const author = { email: "author@example.com", name: "Author", image: null };
const other = { email: "other@example.com", name: "Other", image: null };
const create = (id: string): comments.CommentAction => ({ action: "create", id, pageId: "page", nodeId: null, x: .5, y: .5, bp: "base", body: "Original" });
const reply = { action: "reply" as const, threadId: "thread", id: "reply", body: "Reply" };

async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-comment-collisions-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    for (const id of ["site", "other-site"]) {
      await insertSite(db, id, { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    }
    await comments.runCommentAction(db, "site", create("thread"), author, 1);
    await comments.runCommentAction(db, "site", create("other-thread"), author, 1);
    await comments.runCommentAction(db, "other-site", create("private-thread"), author, 1);
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
const snapshot = async (db: Db) => Promise.all(["comment_threads", "comment_messages"].map(async table => (await db.execute(`SELECT * FROM ${table} ORDER BY id`)).rows));

for (const collision of ["body", "author", "thread", "site", "original"] as const) {
  test(`a reply ID collision with another ${collision} is rejected without any writes`, async () => database(async db => {
    const initial = collision === "thread" ? { ...reply, threadId: "other-thread" }
      : collision === "site" ? { ...reply, threadId: "private-thread" } : reply;
    if (collision !== "original") await comments.runCommentAction(db, collision === "site" ? "other-site" : "site", initial, author, 2);
    const attempt = collision === "body" ? { ...reply, body: "Must not be lost" }
      : collision === "original" ? { ...reply, id: "thread-0", body: "New reply" } : reply;
    const before = await snapshot(db);
    assert.equal(await comments.runCommentAction(db, "site", attempt, collision === "author" ? other : author, 3), "conflict");
    assert.deepEqual(await snapshot(db), before, "rejection must not bump either thread or modify any stored message");
  }));
}

for (const [stored, retried] of [[null, author], [author, null]] as const) {
  test(`anonymous edit permission does not imply reply idempotency (${stored ? "signed in" : "guest"} original)`, async () => database(async db => {
    await comments.runCommentAction(db, "site", reply, stored, 2);
    const before = await snapshot(db);
    assert.equal(await comments.runCommentAction(db, "site", reply, retried, 3), "conflict");
    assert.deepEqual(await snapshot(db), before);
  }));
}

for (const user of [author, null]) test(`an identical ${user ? "signed-in" : "guest"} reply retry is a no-op`, async () => database(async db => {
  assert.equal(await comments.runCommentAction(db, "site", reply, user, 2), true);
  const before = await snapshot(db);
  const refreshed = user ? { ...user, name: "New display name", image: "https://example.com/new-avatar.png" } : null;
  assert.equal(await comments.runCommentAction(db, "site", reply, refreshed, 3), true);
  assert.deepEqual(await snapshot(db), before, "timestamps and stored profile are retained on a retry");
}));

test("retrying the old payload after editing a reply does not replace or acknowledge it", async () => database(async db => {
  await comments.runCommentAction(db, "site", reply, author, 2);
  await comments.runCommentAction(db, "site", { action: "edit", messageId: reply.id, body: "Edited" }, author, 3);
  const before = await snapshot(db);
  assert.equal(await comments.runCommentAction(db, "site", reply, author, 4), "conflict");
  assert.deepEqual(await snapshot(db), before);
}));

test("a missing target still takes precedence over a colliding message ID", async () => database(async db => {
  await comments.runCommentAction(db, "site", reply, author, 2);
  const before = await snapshot(db);
  assert.equal(await comments.runCommentAction(db, "site", { ...reply, threadId: "deleted" }, author, 3), "missing");
  assert.deepEqual(await snapshot(db), before);
}));

test("creation already rolls back both a thread collision and a derived first-message ID collision", async () => database(async db => {
  await comments.runCommentAction(db, "site", { ...reply, id: "new-thread-0" }, author, 2);
  const before = await snapshot(db);
  await assert.rejects(comments.runCommentAction(db, "site", create("thread"), author, 3));
  await assert.rejects(comments.runCommentAction(db, "site", create("new-thread"), author, 3));
  assert.deepEqual(await snapshot(db), before);
}));

// 実際の API と SQLite を通し、認証・翻訳・接続だけを差し替える。
function api(db: Db, user: ActivityUser | null = author) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const injected = {
    listCommentPage: comments.listCommentPage, parseCommentCursor: comments.parseCommentCursor,
    parseCommentAction: comments.parseCommentAction, runCommentAction: comments.runCommentAction,
    NextResponse, userMessage, JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited,
    serverTr: async () => (text: string) => text,
    requireAuth: async () => null, sessionUser: async () => user,
    dbConfigured: () => true, getDb: async () => db,
    dbUnavailable: () => { throw new Error("Unexpected fallback"); },
    siteIdOf: async (id: string) => id,
  };
  const source = stripTypeScriptTypes(readFileSync(new URL("../app/api/comments/route.ts", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
  const post = new Function(...Object.keys(injected), `${source}\nreturn POST;`)(...Object.values(injected)) as (req: Request) => Promise<Response>;
  return (body: comments.CommentAction) => post(new Request("https://example.com/api/comments?site=site&focus=thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

test("the API returns generic 409 conflicts, 200 for identical retries and the existing 404 for a missing thread", async () => database(async db => {
  const send = api(db);
  assert.equal((await send(reply)).status, 200);
  assert.equal((await send(reply)).status, 200);
  const conflict = await send({ ...reply, body: "Another payload" });
  assert.equal(conflict.status, 409);
  const error = await conflict.json();
  assert.equal(error.code, "comment_id_conflict");
  assert.equal("threads" in error, false);
  await comments.runCommentAction(db, "other-site", { ...reply, id: "private-reply", threadId: "private-thread" }, author, 2);
  const privateCollision = await send({ ...reply, id: "private-reply" });
  assert.equal(privateCollision.status, 409);
  assert.deepEqual(await privateCollision.json(), error, "no information about a conflicting site's message is exposed");
  const missing = await send({ ...reply, threadId: "deleted" });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "comment_thread_missing");
}));
