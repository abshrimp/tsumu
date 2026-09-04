import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { deleteSite, insertSite, isSiteId } from "../lib/sites";
import { listComments, listCommentPage, parseCommentCursor, parseCommentAction, runCommentAction, type CommentAction } from "../lib/comments";
import { userMessage } from "../lib/errors";
import { JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited } from "../lib/api-json";

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
    assert.equal(await runCommentAction(db, "site", create, author), "site-missing");
    await assertEmpty(db);
  });
});

// 実際の API・サイトID検証・SQLite を通し、認証・翻訳・接続だけを差し替える。
function api(db: Db) {
  class NextResponse extends Response {
    static json(data: unknown, init?: ResponseInit) { return new NextResponse(JSON.stringify(data), init); }
  }
  const serverTr = async () => (text: string) => text;
  const load = (path: string, name: string, injected: Record<string, unknown>) => {
    const source = stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), "utf8"))
      .replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
    return new Function(...Object.keys(injected), `${source}\nreturn ${name};`)(...Object.values(injected));
  };
  const siteIdOf = load("../lib/site-server.ts", "siteIdOf", { NextResponse, serverTr, isSiteId });
  const post = load("../app/api/comments/route.ts", "POST", {
    NextResponse, serverTr, siteIdOf, userMessage, JsonBodyTooLargeError, JsonContentTypeError, readJsonLimited,
    listCommentPage, parseCommentCursor, parseCommentAction, runCommentAction,
    requireAuth: async (mode?: "user") => mode === "user" ? author : null,
    dbConfigured: () => true, getDb: async () => db,
    dbUnavailable: () => { throw new Error("Unexpected fallback"); },
  }) as (req: Request) => Promise<Response>;
  return (site = "site", action: CommentAction = create, contentType = "application/json") => post(new Request(`https://example.com/api/comments?site=${encodeURIComponent(site)}`, { method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(action) }));
}

test("the API stores the identity that authorized the new comment", async () => database(async db => {
  assert.equal((await api(db)()).status, 200);
  const [thread] = await listComments(db, "site");
  assert.deepEqual(thread.messages[0].author, author);
}));

for (const timing of ["before request", "before write"] as const) {
  test(`the API rejects creation when the site is deleted ${timing}, without resurrecting any records`, async () => database(async db => {
    let writes = 0;
    if (timing === "before request") await deleteSite(db, "site");
    const racingDb: Db = {
      ...db,
      batch: async statements => {
        if (++writes === 1 && timing === "before write") await deleteSite(db, "site");
        return db.batch(statements);
      },
    };
    const response = await api(racingDb)();
    await assertEmpty(db);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM sites")).rows[0].n, 0);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "サイトが見つかりません", code: "comment_site_missing" });
    assert.equal(writes, 1, "a failed create must not fetch a success snapshot");
  }));
}

test("the API still creates a discussion for an existing site and rejects invalid site IDs", async () => database(async db => {
  const send = api(db);
  const invalid = await send("../invalid");
  assert.equal(invalid.status, 400);
  await assertEmpty(db);
  const response = await send();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.focusedThread.id, create.id);
  assert.equal(data.focusedThread.messages[0].body, create.body);
  assert.equal(data.total, 1);
}));

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
      assert.equal(await runCommentAction(racingDb, "site", reply, author, 3), "missing");
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
    assert.equal(threads[0].updatedAt, 2);
    assert.equal(await runCommentAction(db, "other-site", { ...reply, id: "wrong-site" }, author, 4), "missing");
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM comment_messages")).rows[0].n, 2);
  });
});

for (const timing of ["before lookup", "before write"] as const) {
  test(`editing a comment deleted ${timing} cannot falsely report success`, async () => database(async db => {
    await runCommentAction(db, "site", create, author, 1);
    await runCommentAction(db, "site", reply, author, 2);
    if (timing === "before lookup") await runCommentAction(db, "site", { action: "delete-message", messageId: "reply" }, author, 3);
    const wrapped: Db = { ...db, batch: async statements => {
      if (timing === "before write") await runCommentAction(db, "site", { action: "delete-message", messageId: "reply" }, author, 3);
      return db.batch(statements);
    } };
    const result = await runCommentAction(wrapped, "site", { action: "edit", messageId: "reply", body: "Unsaved edit" }, author, 4);
    assert.equal(result, "message-missing");
    const [thread] = await listComments(db, "site");
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].body, "Original");
    assert.equal(thread.updatedAt, 3, "failed edit must not bump the surviving discussion");
  }));
}


test("the API distinguishes a deleted edit target from an unauthorized author", async () => database(async db => {
  const response = await api(db)("site", { action: "edit", messageId: "missing", body: "Keep this draft" });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "comment_message_missing");
}));

test("thread deletion rechecks the current first author's authority inside the write transaction", async () => database(async db => {
  const other = { email: "other@example.com", name: "Other", image: null };
  await runCommentAction(db, "site", create, author, 100);
  await runCommentAction(db, "site", reply, other, 200);
  let raced = false;
  const racingDb: Db = { ...db, batch: async statements => {
    if (!raced) {
      raced = true;
      assert.equal(await runCommentAction(db, "site", { action: "delete-message", messageId: "thread-0" }, author, 300), true);
    }
    return db.batch(statements);
  } };
  assert.equal(await runCommentAction(racingDb, "site", { action: "delete-thread", threadId: "thread" }, author, 400), false);
  const threads = await listComments(db, "site");
  assert.equal(threads.length, 1); assert.deepEqual(threads[0].messages.map(m => m.id), ["reply"]);
  assert.equal(await runCommentAction(db, "site", { action: "delete-thread", threadId: "thread" }, other, 500), true);
  await assertEmpty(db);
  assert.equal(await runCommentAction(db, "site", { action: "delete-thread", threadId: "thread" }, other, 600), true, "already removed threads remain idempotent");
}));

test("a delayed message deletion cannot delete a replacement message owned by another author", async () => database(async db => {
  const other = { email: "other@example.com", name: "Other", image: null };
  await runCommentAction(db, "site", create, author, 100);
  let raced = false;
  const racingDb: Db = { ...db, batch: async statements => {
    if (!raced) {
      raced = true;
      await runCommentAction(db, "site", { action: "delete-thread", threadId: "thread" }, author, 200);
      await runCommentAction(db, "site", { ...create, body: "Replacement" }, other, 300);
    }
    return db.batch(statements);
  } };
  assert.equal(await runCommentAction(racingDb, "site", { action: "delete-message", messageId: "thread-0" }, author, 400), false);
  const threads = await listComments(db, "site");
  assert.equal(threads.length, 1);
  assert.equal(threads[0].updatedAt, 300, "a rejected delete must not bump the replacement thread");
  assert.equal(threads[0].messages[0].body, "Replacement");
  assert.equal(threads[0].messages[0].author.email, other.email);
}));


test("comment API refuses an oversized JSON body before writing anything", async () => database(async db => {
  const oversized = { ...create, body: "x".repeat(100 * 1024) };
  const response = await api(db)("site", oversized);
  assert.equal(response.status, 413);
  await assertEmpty(db);
}));


test("comment POST rejects text/plain even if its body is valid JSON", async () => database(async db => {
  const response = await api(db)("site", create, "text/plain");
  assert.equal(response.status, 415);
  await assertEmpty(db);
}));
