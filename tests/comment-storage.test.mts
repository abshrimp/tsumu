import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite } from "../lib/sites";
import { listComments, runCommentAction, type CommentAction } from "../lib/comments";

const author = { email: "author@example.com", name: "Author", image: null };
const create: CommentAction = {
  action: "create", id: "thread", pageId: "page", nodeId: null, x: 0.5, y: 0.5,
  bp: "base", body: "Original",
};
const reply: CommentAction = { action: "reply", threadId: "thread", id: "reply", body: "Reply" };

async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-comments-"));
  const previous = process.env.TSUMU_DATA_DIR;
  process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await insertSite(db, "site", { name: "Site", repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (previous === undefined) delete process.env.TSUMU_DATA_DIR;
    else process.env.TSUMU_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function assertEmpty(db: Db) {
  for (const table of ["comment_threads", "comment_messages"]) {
    const result = await db.execute("SELECT COUNT(*) AS n FROM " + table);
    assert.equal(result.rows[0].n, 0, table + " must not contain orphaned records");
  }
}

test("a late comment creation cannot recreate data for a deleted site", async () => {
  await database(async (db) => {
    await deleteSite(db, "site");
    assert.equal(await runCommentAction(db, "site", create, author), true);
    await assertEmpty(db);
  });
});

for (const target of ["thread", "site"] as const) {
  test("a reply racing with " + target + " deletion leaves no orphaned message", async () => {
    await database(async (db) => {
      await runCommentAction(db, "site", create, author, 1);
      let intercepted = false;
      const racingDb: Db = {
        ...db,
        batch: async (statements) => {
          // Delete after any preflight reads, immediately before the reply write transaction.
          assert.equal(intercepted, false);
          intercepted = true;
          if (target === "site") await deleteSite(db, "site");
          else await runCommentAction(db, "site", { action: "delete-thread", threadId: "thread" }, author, 2);
          return db.batch(statements);
        },
      };
      assert.equal(await runCommentAction(racingDb, "site", reply, author, 3), true);
      assert.equal(intercepted, true);
      await assertEmpty(db);
    });
  });
}

test("comment creation and replies still persist, and retries cannot duplicate replies", async () => {
  await database(async (db) => {
    assert.equal(await runCommentAction(db, "site", create, author, 1), true);
    assert.equal(await runCommentAction(db, "site", reply, author, 2), true);
    assert.equal(await runCommentAction(db, "site", reply, author, 3), true);
    const threads = await listComments(db, "site");
    assert.equal(threads.length, 1);
    assert.deepEqual(threads[0].messages.map((m) => m.body), ["Original", "Reply"]);
    assert.equal(threads[0].updatedAt, 3);
    assert.equal(await runCommentAction(db, "other-site", { ...reply, id: "wrong-site" }, author, 4), true);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM comment_messages")).rows[0].n, 2);
  });
});
