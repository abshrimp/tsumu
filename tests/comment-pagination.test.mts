import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { insertSite } from "../lib/sites";
import { COMMENT_PAGE_SIZE, listCommentPage, parseCommentCursor, runCommentAction } from "../lib/comments";

async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-comment-pages-"));
  const old = process.env.TSUMU_DATA_DIR; process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    for (const id of ["site", "other"]) await insertSite(db, id, { name: id, repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (old === undefined) delete process.env.TSUMU_DATA_DIR; else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
}
async function create(db: Db, id: string, at: number, site = "site") {
  await runCommentAction(db, site, { action: "create", id, pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: id }, null, at);
}

test("the 1001st thread is visible and every older thread remains reachable", async () => database(async db => {
  for (let i = 0; i <= COMMENT_PAGE_SIZE; i++) await create(db, `c${String(i).padStart(4, "0")}`, i + 1);
  await runCommentAction(db, "site", { action: "resolve", threadId: "c0000", resolved: true }, null, 2000);
  const first = await listCommentPage(db, "site");
  assert.equal(first.threads.length, COMMENT_PAGE_SIZE); assert.equal(first.threads[0].id, "c1000");
  assert.equal(first.total, 1001); assert.equal(first.unresolvedCount, 1000); assert.ok(first.nextCursor);
  const older = await listCommentPage(db, "site", parseCommentCursor(first.nextCursor));
  assert.deepEqual(older.threads.map(t => t.id), ["c0000"]); assert.equal(older.nextCursor, null);
  assert.equal(new Set([...first.threads, ...older.threads].map(t => t.id)).size, 1001);
  assert.equal(older.total, 1001); assert.equal(older.unresolvedCount, 1000);
  await create(db, "newest", 3000);
  assert.equal((await listCommentPage(db, "site")).threads[0].id, "newest");
}));

test("tied timestamps and deleted cursor rows do not skip or duplicate older comments", async () => database(async db => {
  for (let i = 0; i < COMMENT_PAGE_SIZE + 2; i++) await create(db, `t${String(i).padStart(4, "0")}`, 10);
  const first = await listCommentPage(db, "site");
  const cursor = parseCommentCursor(first.nextCursor)!;
  await runCommentAction(db, "site", { action: "delete-thread", threadId: cursor.id }, null);
  await create(db, "z_new", 10);
  const next = await listCommentPage(db, "site", cursor);
  assert.deepEqual(next.threads.map(t => t.id), ["t0001", "t0000"]);
  assert.equal(next.nextCursor, null);
  const end = await listCommentPage(db, "site", { createdAt: 10, id: "t0000" });
  assert.deepEqual(end.threads, []); assert.equal(end.nextCursor, null);
}));

test("off-batch focus is independent, site-scoped, current, and explicitly absent after deletion", async () => database(async db => {
  await create(db, "old", 1); await create(db, "new", 2); await create(db, "private", 3, "other");
  const cursor = { createdAt: 2, id: "new" };
  const page = await listCommentPage(db, "site", cursor, "new");
  assert.deepEqual(page.threads.map(t => t.id), ["old"]); assert.equal(page.focusedThread?.id, "new");
  assert.equal((await listCommentPage(db, "site", cursor, "private")).focusedThread, null);
  await runCommentAction(db, "site", { action: "reply", threadId: "new", id: "reply", body: "Reply" }, null, 4);
  assert.deepEqual((await listCommentPage(db, "site", cursor, "new")).focusedThread?.messages.map(m => m.body), ["new", "Reply"]);
  await runCommentAction(db, "site", { action: "delete-thread", threadId: "new" }, null);
  assert.equal((await listCommentPage(db, "site", cursor, "new")).focusedThread, null);
}));

test("message reads exclude other batches and sites, except the requested focused thread", async () => database(async db => {
  await create(db, "old", 1); await create(db, "new", 2); await create(db, "private", 3, "other");
  let returned: string[] = [];
  const tracked: Db = { ...db, batch: async statements => {
    const result = await db.batch(statements);
    returned = result[1].rows.map(r => String(r.thread_id)); return result;
  } };
  await listCommentPage(tracked, "site", { createdAt: 2, id: "new" }); assert.deepEqual(returned, ["old"]);
  await listCommentPage(tracked, "site", { createdAt: 2, id: "new" }, "new"); assert.deepEqual(returned, ["old", "new"]);
  await listCommentPage(tracked, "site", null, "private"); assert.deepEqual(returned, ["old", "new"]);
}));

test("cursor parsing rejects malformed, unsafe and injectable values", () => {
  for (const value of [null, "", "-1:x", "1.5:x", "NaN:x", "1:", "1:x' OR 1=1", "9007199254740992:x", `1:${"x".repeat(65)}`]) assert.equal(parseCommentCursor(value), null);
  assert.deepEqual(parseCommentCursor("0:a_B-1"), { createdAt: 0, id: "a_B-1" });
});


test("the original message stays first when a reply has the same timestamp", async () => database(async db => {
  await create(db, "z_thread", 1);
  await runCommentAction(db, "site", { action: "reply", threadId: "z_thread", id: "a_reply", body: "Reply" }, { email: "other@example.com", name: null, image: null }, 1);
  assert.deepEqual((await listCommentPage(db, "site")).threads[0].messages.map(m => m.id), ["z_thread-0", "a_reply"]);
}));


test("a same-time reply cannot claim ownership and delete the original author's thread", async () => database(async db => {
  const owner = { email: "owner@example.com", name: null, image: null };
  const replier = { email: "replier@example.com", name: null, image: null };
  await runCommentAction(db, "site", { action: "create", id: "thread", pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: "Original" }, owner, 1);
  await runCommentAction(db, "site", { action: "reply", threadId: "thread", id: "reply", body: "Reply" }, replier, 1);
  assert.equal(await runCommentAction(db, "site", { action: "delete-thread", threadId: "thread" }, replier), false);
  assert.equal((await listCommentPage(db, "site")).threads[0].messages[0].author.email, owner.email);
  assert.equal(await runCommentAction(db, "site", { action: "delete-thread", threadId: "thread" }, owner), true);
}));
