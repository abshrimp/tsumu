import { describe, before, afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { useComments, openPostedComment, closeCommentIfOpen as closeCommentIfOpen_2 } from "../lib/comment-store";
import * as comments from "../lib/comments";
import { applyCommentAction, type CommentAction as CommentAction_2, type CommentThread, parseCommentAction as parseCommentAction_2, MAX_COMMENT_LENGTH as MAX_COMMENT_LENGTH_2, type CommentAction as CommentAction_3, COMMENT_PAGE_SIZE, listCommentPage as listCommentPage_2, parseCommentCursor as parseCommentCursor_2, runCommentAction as runCommentAction_2, listCommentPage as listCommentPage_3, parseCommentCursor as parseCommentCursor_3, parseCommentAction as parseCommentAction_3, runCommentAction as runCommentAction_3, type CommentAction as CommentAction_4, type CommentAction as CommentAction_5 } from "../lib/comments";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "./helpers/bundle";
import { isComposingKey, isEscapeKey } from "../lib/keys";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbFromBinding, type Db } from "../lib/db";
import { nodeDatabase } from "../lib/node-storage";
import { isSiteId } from "../lib/site-model";
import { insertSite, deleteSite } from "../lib/sites";
import { type ActivityUser } from "../lib/activity";
import { userMessage } from "../lib/errors";
import { JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited } from "../lib/api-json";
import { commentTargetResolver, isDeletedCommentTarget } from "../lib/comment-targets";
import { useEditor } from "../lib/store";
import { commentTargetDoc } from "./helpers/comment-targets";
import { deleteLocalSite, emptyDest, isLocalSiteDeleted, loadLocalSites, saveLocalSites, SITE_SCOPED_KEYS, siteKey, touchLocalSite } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteFixture } from "./helpers/home-site-storage";

describe("comment-client-order", () => {
const create = (id: string): CommentAction_2 => ({ action: "create", id, pageId: "page", nodeId: null, x: .5, y: .5, bp: "base", body: id });
const threads = (...ids: string[]) => ids.reduce((all, id, i) => applyCommentAction(all, create(id), null, i + 1), [] as CommentThread[]);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function reset() { useComments.setState({ threadUnavailable: false, focusedThread: null, cursor: null, previousCursors: [], nextCursor: null, total: 0, unresolvedCount: 0, saving: false, active: false, store: "server", threads: [], loading: false, error: null, openId: null, draft: null }); }
afterEach(() => mock.reset());

test("a poll started before a successful post cannot remove the acknowledged thread", async () => {
  reset();
  const old = deferred<Response>();
  mock.method(globalThis, "fetch", async (_url, init) => init?.method ? Response.json(pageData(["new"])) : old.promise);
  const pending = useComments.getState().load();
  assert.equal(await useComments.getState().run(create("new")), true);
  useComments.getState().open("new");
  old.resolve(Response.json(pageData([])));
  await pending;
  assert.deepEqual(useComments.getState().threads.map((t) => t.id), ["new"]);
  assert.equal(useComments.getState().openId, "new");
  assert.equal(useComments.getState().loading, false);
});

test("an old failed or local-fallback read cannot replace a successful server post", async () => {
  for (const status of [500, 503]) {
    reset();
    const old = deferred<Response>();
    mock.method(globalThis, "fetch", async (_url, init) => init?.method ? Response.json(pageData(["new"])) : old.promise);
    const pending = useComments.getState().load();
    await useComments.getState().run(create("new"));
    old.resolve(Response.json({ error: "Old failure" }, { status }));
    await pending;
    assert.equal(useComments.getState().store, "server");
    assert.equal(useComments.getState().error, null);
    assert.equal(useComments.getState().threads[0]?.id, "new");
    mock.restoreAll();
  }
});

test("overlapping polls retain the newest response and its loading state", async () => {
  reset();
  const old = deferred<Response>(); const current = deferred<Response>(); let n = 0;
  mock.method(globalThis, "fetch", async () => ++n === 1 ? old.promise : current.promise);
  const first = useComments.getState().load(); const second = useComments.getState().load();
  old.resolve(Response.json(pageData(["old"]))); await first;
  assert.equal(useComments.getState().loading, true);
  current.resolve(Response.json(pageData(["current"]))); await second;
  assert.equal(useComments.getState().threads[0]?.id, "current");
  assert.equal(useComments.getState().loading, false);
});

test("writes are serialized and a poll during them cannot restore an intermediate snapshot", async () => {
  reset();
  const responses = [deferred<Response>(), deferred<Response>()];
  const actions: CommentAction_2[] = []; let reads = 0;
  mock.method(globalThis, "fetch", async (_url, init) => {
    if (!init?.method) { reads++; return Response.json(pageData([])); }
    const index = actions.length; actions.push(JSON.parse(String(init.body)));
    return responses[index].promise;
  });
  const first = useComments.getState().run(create("first"));
  const second = useComments.getState().run(create("second"));
  await Promise.resolve();
  assert.equal(actions.length, 1);
  await useComments.getState().load();
  assert.equal(reads, 0);
  responses[0].resolve(Response.json(pageData(["first"])));
  await first;
  await Promise.resolve();
  assert.equal(actions.length, 2);
  responses[1].resolve(Response.json(pageData(["first", "second"])));
  assert.equal(await second, true);
  assert.deepEqual(useComments.getState().threads.map((t) => t.id), ["first", "second"]);
});

test("a failed write releases the queue and keeps the failure until a current request succeeds", async () => {
  reset();
  let writes = 0;
  const old = deferred<Response>();
  mock.method(globalThis, "fetch", async (_url, init) => !init?.method ? old.promise : ++writes === 1
    ? Response.json({ error: "Save failed" }, { status: 500 }) : Response.json(pageData(["second"])));
  const poll = useComments.getState().load();
  assert.equal(await useComments.getState().run(create("first")), false);
  const error = useComments.getState().error;
  assert.ok(error);
  old.resolve(Response.json(pageData([]))); await poll;
  assert.equal(useComments.getState().error, error);
  assert.equal(await useComments.getState().run(create("second")), true);
  assert.equal(useComments.getState().threads[0]?.id, "second");
  assert.equal(useComments.getState().error, null);
});


test("posting before an unavailable-server read falls back locally and preserves queued actions", async () => {
  reset();
  useComments.setState({ store: null });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/sites/local-comments" },
    localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v) },
  } });
  try {
    let posts = 0;
    const old = deferred<Response>();
    mock.method(globalThis, "fetch", async (_url, init) => {
      if (!init?.method) return old.promise;
      posts++;
      return Response.json({}, { status: 503 });
    });
    const poll = useComments.getState().load();
    const first = useComments.getState().run(create("first"));
    const second = useComments.getState().run(create("second"));
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    old.resolve(Response.json({}, { status: 503 })); await poll;
    assert.equal(posts, 1, "subsequent actions use the established local store");
    assert.equal(useComments.getState().store, "local");
    assert.deepEqual(useComments.getState().threads.map((t) => t.id), ["first", "second"]);
    await useComments.getState().load();
    assert.deepEqual(useComments.getState().threads.map((t) => t.id), ["first", "second"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete (globalThis as any).window;
  }
});

const pageData = (ids: string[], focus: string | null = null, nextCursor: string | null = null) => ({
  threads: threads(...ids), focusedThread: focus ? threads(focus)[0] : null,
  nextCursor, total: 1001, unresolvedCount: 1000,
});

test("paging and polling keep the open detail separate from the loaded batch", async () => {
  reset(); useComments.setState({ threads: threads("new"), nextCursor: "2:new" }); useComments.getState().open("new");
  let url = "";
  mock.method(globalThis, "fetch", async input => { url = String(input); return Response.json(pageData(["old"], "new")); });
  await useComments.getState().navigate("older");
  assert.match(url, /before=2%3Anew/); assert.match(url, /focus=new/);
  assert.equal(useComments.getState().cursor, "2:new");
  assert.deepEqual(useComments.getState().previousCursors, [null]);
  assert.deepEqual(useComments.getState().threads.map(t => t.id), ["old"]);
  assert.equal(useComments.getState().focusedThread?.id, "new"); assert.equal(useComments.getState().openId, "new");
  assert.equal(useComments.getState().unresolvedCount, 1000);
  await useComments.getState().load(); assert.equal(useComments.getState().focusedThread?.id, "new");
});

test("a stale pagination response cannot replace a newer batch, counts or focus", async () => {
  reset(); useComments.setState({ threads: threads("new"), nextCursor: "2:new" }); useComments.getState().open("new");
  const old = deferred<Response>(); const latest = deferred<Response>(); let count = 0;
  mock.method(globalThis, "fetch", async () => ++count === 1 ? old.promise : latest.promise);
  const first = useComments.getState().navigate("older"); const second = useComments.getState().navigate("newest");
  latest.resolve(Response.json({ ...pageData(["new"], "new", "2:new"), unresolvedCount: 7 })); await second;
  old.resolve(Response.json(pageData(["old"], null))); await first;
  assert.equal(useComments.getState().cursor, null); assert.equal(useComments.getState().unresolvedCount, 7);
  assert.deepEqual(useComments.getState().threads.map(t => t.id), ["new"]); assert.equal(useComments.getState().focusedThread?.id, "new");
});

test("changing the selected detail during a pending read does not reopen its old focus", async () => {
  reset(); useComments.setState({ threads: threads("one", "two") }); useComments.getState().open("one");
  const response = deferred<Response>(); mock.method(globalThis, "fetch", async () => response.promise);
  const pending = useComments.getState().load(); useComments.getState().open("two");
  response.resolve(Response.json(pageData([], "one"))); await pending;
  assert.equal(useComments.getState().openId, "two"); assert.equal(useComments.getState().focusedThread?.id, "two");
});

test("creating from an old batch returns latest pagination and the created detail even if off-batch", async () => {
  reset(); useComments.setState({ threads: threads("old"), cursor: "2:old", previousCursors: [null] });
  mock.method(globalThis, "fetch", async () => Response.json(pageData(["concurrent"], "created", "3:concurrent")));
  assert.equal(await useComments.getState().run(create("created")), true);
  useComments.getState().open("created");
  assert.equal(useComments.getState().cursor, null); assert.deepEqual(useComments.getState().previousCursors, []);
  assert.equal(useComments.getState().focusedThread?.id, "created"); assert.equal(useComments.getState().openId, "created");
});

test("failed page navigation retains the old batch, cursor and open detail", async () => {
  reset(); useComments.setState({ threads: threads("new"), nextCursor: "2:new" }); useComments.getState().open("new");
  mock.method(globalThis, "fetch", async () => Response.json({ error: "Failure" }, { status: 502 }));
  await useComments.getState().navigate("older");
  assert.equal(useComments.getState().cursor, null); assert.deepEqual(useComments.getState().previousCursors, []);
  assert.equal(useComments.getState().focusedThread?.id, "new"); assert.equal(useComments.getState().threads[0]?.id, "new");
  assert.ok(useComments.getState().error);
});

test("authoritative removal marks only the open detail unavailable and retains its draft host", async () => {
  reset(); useComments.setState({ threads: threads("new"), nextCursor: "2:new" }); useComments.getState().open("new");
  mock.method(globalThis, "fetch", async () => Response.json(pageData(["old"], null)));
  await useComments.getState().navigate("older");
  assert.equal(useComments.getState().focusedThread?.id, "new");
  assert.equal(useComments.getState().threadUnavailable, true);
  assert.equal(useComments.getState().openId, "new");
});


test("a background poll cannot cancel a pending user page navigation", async () => {
  reset(); useComments.setState({ threads: threads("new"), nextCursor: "2:new" });
  const response = deferred<Response>(); let requests = 0;
  mock.method(globalThis, "fetch", async () => { requests++; return response.promise; });
  const navigation = useComments.getState().navigate("older");
  await useComments.getState().load(); assert.equal(requests, 1);
  response.resolve(Response.json(pageData(["old"]))); await navigation;
  assert.equal(useComments.getState().cursor, "2:new"); assert.equal(useComments.getState().threads[0].id, "old");
  await useComments.getState().load(); assert.equal(requests, 2);
});


for (const newerSelection of ["thread", "draft", "closed"] as const) test(`a completed creation does not replace a newer ${newerSelection} selection`, async () => {
  reset(); useComments.setState({ active: true, threads: threads("other") });
  const original = { pageId: "p", nodeId: null, x: .5, y: .5, bp: "base" };
  useComments.getState().setDraft(original);
  const response = deferred<Response>(); mock.method(globalThis, "fetch", async () => response.promise);
  const submitted = useComments.getState().run(create("created")).then(ok => { if (ok) openPostedComment(original, "created"); });
  await Promise.resolve();
  const replacement = { ...original };
  if (newerSelection === "thread") useComments.getState().open("other");
  else if (newerSelection === "draft") useComments.getState().setDraft(replacement);
  else useComments.getState().setActive(false);
  response.resolve(Response.json(pageData(["created", "other"], "created"))); await submitted;
  assert.equal(useComments.getState().openId, newerSelection === "thread" ? "other" : null);
  assert.equal(useComments.getState().draft, newerSelection === "draft" ? replacement : null);
});

test("a completed deletion does not close a different thread opened while saving", async () => {
  reset(); useComments.setState({ threads: threads("one", "two") }); useComments.getState().open("one");
  const response = deferred<Response>(); mock.method(globalThis, "fetch", async () => response.promise);
  const submitted = useComments.getState().run({ action: "delete-thread", threadId: "one" }).then(ok => { if (ok) closeCommentIfOpen_2("one"); });
  await Promise.resolve(); useComments.getState().open("two");
  response.resolve(Response.json(pageData(["two"]))); await submitted;
  assert.equal(useComments.getState().openId, "two"); assert.equal(useComments.getState().focusedThread?.id, "two");
});


test("incomplete comment responses fail closed without replacing the current page or detail", async () => {
  reset(); useComments.setState({ threads: threads("new"), nextCursor: "2:new" }); useComments.getState().open("new");
  mock.method(globalThis, "fetch", async () => Response.json({ threads: threads("old") }));
  await useComments.getState().navigate("older");
  assert.deepEqual(useComments.getState().threads.map(thread => thread.id), ["new"]);
  assert.equal(useComments.getState().focusedThread?.id, "new");
  assert.equal(useComments.getState().openId, "new");
  assert.ok(useComments.getState().error);
});

test("a missing-target reply fails honestly and subsequent polls preserve the cached detail until Close", async () => {
  reset(); useComments.setState({ threads: threads("one"), active: true }); useComments.getState().open("one");
  mock.method(globalThis, "fetch", async (_url, init) => init?.method
    ? Response.json({ error: "Thread deleted", code: "comment_thread_missing" }, { status: 404 })
    : Response.json({ ...pageData([]), total: 0, unresolvedCount: 0 }));
  assert.equal(await useComments.getState().run({ action: "reply", threadId: "one", id: "reply", body: "Unsent reply" }), false);
  assert.equal(useComments.getState().threadUnavailable, true); assert.equal(useComments.getState().focusedThread?.id, "one");
  await useComments.getState().load();
  assert.deepEqual(useComments.getState().threads, []); assert.equal(useComments.getState().unresolvedCount, 0);
  assert.equal(useComments.getState().threadUnavailable, true); assert.equal(useComments.getState().focusedThread?.id, "one");
  useComments.getState().open(null); assert.equal(useComments.getState().focusedThread, null); assert.equal(useComments.getState().threadUnavailable, false);
});

test("missing-target completion does not disable another discussion selected meanwhile", async () => {
  reset(); useComments.setState({ threads: threads("one", "two") }); useComments.getState().open("one");
  const response = deferred<Response>(); mock.method(globalThis, "fetch", async () => response.promise);
  const pending = useComments.getState().run({ action: "reply", threadId: "one", id: "reply", body: "Reply" });
  await Promise.resolve(); useComments.getState().open("two");
  response.resolve(Response.json({ error: "Deleted", code: "comment_thread_missing" }, { status: 404 }));
  assert.equal(await pending, false); assert.equal(useComments.getState().openId, "two");
  assert.deepEqual(useComments.getState().threads.map(t => t.id), ["two"]);
  assert.equal(useComments.getState().threadUnavailable, false); assert.equal(useComments.getState().focusedThread?.id, "two");
});


test("known missing replies are removed from list and counts even if the next poll fails", async () => {
  reset(); useComments.setState({ threads: threads("one"), total: 1, unresolvedCount: 1 }); useComments.getState().open("one");
  mock.method(globalThis, "fetch", async (_url, init) => init?.method
    ? Response.json({ code: "comment_thread_missing" }, { status: 404 }) : Response.json({ error: "Offline" }, { status: 502 }));
  const reply = { action: "reply" as const, threadId: "one", id: "reply", body: "Unsent" };
  assert.equal(await useComments.getState().run(reply), false);
  assert.deepEqual(useComments.getState().threads, []); assert.equal(useComments.getState().total, 0); assert.equal(useComments.getState().unresolvedCount, 0);
  assert.equal(useComments.getState().focusedThread?.id, "one"); assert.equal(useComments.getState().threadUnavailable, true);
  assert.equal(await useComments.getState().run(reply), false); assert.equal(useComments.getState().total, 0);
  useComments.getState().open(null); await useComments.getState().load();
  assert.deepEqual(useComments.getState().threads, []); assert.equal(useComments.getState().focusedThread, null);
});


test("an older focused cache is not subtracted from a newer authoritative count twice", async () => {
  reset(); useComments.setState({ threads: threads("one", "two"), total: 2, unresolvedCount: 2 }); useComments.getState().open("two");
  const response = deferred<Response>();
  mock.method(globalThis, "fetch", async (_url, init) => init?.method ? Response.json({ code: "comment_thread_missing" }, { status: 404 }) : response.promise);
  const pending = useComments.getState().load(); useComments.getState().open("one");
  response.resolve(Response.json({ ...pageData(["two"], "two"), total: 1, unresolvedCount: 1 })); await pending;
  assert.equal(useComments.getState().focusedThread?.id, "one");
  assert.equal(await useComments.getState().run({ action: "reply", threadId: "one", id: "reply", body: "Unsent" }), false);
  assert.deepEqual(useComments.getState().threads.map(t => t.id), ["two"]);
  assert.equal(useComments.getState().total, 1); assert.equal(useComments.getState().unresolvedCount, 1);
  assert.equal(useComments.getState().threadUnavailable, true);
});


test("an ID conflict preserves the live discussion and allows retrying with a fresh ID", async () => {
  reset(); useComments.setState({ threads: threads("one"), total: 1, unresolvedCount: 1 }); useComments.getState().open("one");
  let requests = 0;
  mock.method(globalThis, "fetch", async () => ++requests === 1
    ? Response.json({ error: "コメントのIDが重複しています。もう一度送信してください", code: "comment_id_conflict" }, { status: 409 })
    : Response.json({ ...pageData(["one"], "one"), total: 1, unresolvedCount: 1, threads: applyCommentAction(threads("one"), { action: "reply", threadId: "one", id: "fresh", body: "Keep this reply" }, null, 2) }));
  assert.equal(await useComments.getState().run({ action: "reply", threadId: "one", id: "collision", body: "Keep this reply" }), false);
  assert.equal(useComments.getState().openId, "one"); assert.equal(useComments.getState().focusedThread?.id, "one");
  assert.equal(useComments.getState().threadUnavailable, false); assert.equal(useComments.getState().total, 1);
  assert.equal(useComments.getState().unresolvedCount, 1); assert.deepEqual(useComments.getState().threads, threads("one"));
  assert.ok(useComments.getState().error);
  assert.equal(await useComments.getState().run({ action: "reply", threadId: "one", id: "fresh", body: "Keep this reply" }), true);
  assert.deepEqual(useComments.getState().threads[0].messages.map(m => m.body), ["one", "Keep this reply"]);
  assert.equal(useComments.getState().error, null);
});

for (const selectAnother of [false, true]) test(`a site-missing create keeps the draft or newer selection intact: ${selectAnother}`, async () => {
  reset(); useComments.setState({ active: true, threads: threads("other"), total: 1, unresolvedCount: 1 });
  const draft = { pageId: "page", nodeId: null, x: .5, y: .5, bp: "base" };
  useComments.getState().setDraft(draft);
  const response = deferred<Response>(); mock.method(globalThis, "fetch", async () => response.promise);
  const pending = useComments.getState().run(create("new")).then(ok => {
    if (ok) openPostedComment(draft, "new");
    return ok;
  });
  await Promise.resolve();
  if (selectAnother) useComments.getState().open("other");
  response.resolve(Response.json({ error: "サイトが見つかりません", code: "comment_site_missing" }, { status: 404 }));
  assert.equal(await pending, false);
  assert.equal(useComments.getState().draft, selectAnother ? null : draft);
  assert.equal(useComments.getState().openId, selectAnother ? "other" : null);
  assert.equal(useComments.getState().focusedThread?.id ?? null, selectAnother ? "other" : null);
  assert.equal(useComments.getState().threadUnavailable, false);
  assert.deepEqual(useComments.getState().threads, threads("other"));
  assert.equal(useComments.getState().total, 1); assert.equal(useComments.getState().unresolvedCount, 1);
  assert.equal(useComments.getState().store, "server"); assert.equal(useComments.getState().saving, false);
  assert.equal(useComments.getState().error, "サイトが見つかりません");
});


test("a deleted message edit response preserves the visible discussion and reports failure", async () => {
  reset();
  const visible = threads("existing");
  useComments.setState({ threads: visible, focusedThread: visible[0], openId: "existing" });
  mock.method(globalThis, "fetch", async () => Response.json({ error: "The comment you are editing has been deleted.", code: "comment_message_missing" }, { status: 404 }));
  assert.equal(await useComments.getState().run({ action: "edit", messageId: "existing-0", body: "Keep this edit" }), false);
  assert.equal(useComments.getState().threads, visible);
  assert.equal(useComments.getState().focusedThread, visible[0]);
  assert.equal(useComments.getState().openId, "existing");
  assert.ok(useComments.getState().error);
});
});

describe("comment-composer", () => {
// 実際の内部のコンポーネントの処理を、状態を再現できるフックで検証する。
// DOM の readOnly と、React の実際のマウントは、別にブラウザのテストで確かめる。
function harness() {
  const source = readFileSync(new URL("../components/Comments.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function Composer("); const end = source.indexOf("export function CommentLayer(");
  assert.ok(start >= 0 && end > start);
  const code = transformSync(source.slice(start, end) + "\nexport { Composer, Message, ThreadView };", { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  let current: any;
  const slot = (initial: any) => { const instance = current; const i = instance.index++; if (!(i in instance.slots)) instance.slots[i] = initial; return { instance, i }; };
  let run: (...args: any[]) => any = () => false;
  const context: any = {
    module: { exports: {} }, MAX_COMMENT_LENGTH: 5000, unsentBodies: new Map<string, { body: string }>(),
    useState: (initial: any) => { const { instance, i } = slot(initial); return [instance.slots[i], (value: any) => { instance.slots[i] = typeof value === "function" ? value(instance.slots[i]) : value; }]; },
    useRef: (initial: any) => { const { instance, i } = slot({ current: initial }); return instance.slots[i]; },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const { instance, i } = slot(undefined);
      const prev = instance.slots[i];
      if (!prev || deps.some((value, index) => value !== prev.deps[index])) {
        prev?.cleanup?.();
        instance.slots[i] = { deps, cleanup: effect() };
      }
    },
    require: (name: string) => { assert.equal(name, "react/jsx-runtime"); return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }; },
    useComments: (selector: any) => selector({ run: (...args: any[]) => run(...args) }), useServerStatus: () => ({ user: null }),
    isAuthor: () => true, isComposingKey, isEscapeKey, tr: (value: string) => value, getLang: () => "en", relativeTime: () => "now", userLabel: () => "Guest",
    BackButton: "BackButton", Check: "Check", RotateCcw: "RotateCcw", UserAvatar: "UserAvatar", MoreHorizontal: "MoreHorizontal", Pencil: "Pencil", Trash2: "Trash2", CornerDownLeft: "CornerDownLeft", ContextMenu: "ContextMenu", showConfirm: async () => true,
  };
  context.useLayoutEffect = context.useEffect;
  let commentState = { threadUnavailable: false };
  const closed: string[] = [];
  context.useComments.getState = () => commentState;
  context.closeCommentIfOpen = (id: string) => closed.push(id);
  runInNewContext(code, context);
  const { Composer, Message, ThreadView } = context.module.exports;
  function instance(fn: any, props: any) {
    return { slots: [] as any[], index: 0, unmount() { this.slots.forEach(cell => cell?.cleanup?.()); }, render() { current = this; this.index = 0; const tree = fn(props); current = undefined; return tree; } };
  }
  return { Composer, Message, ThreadView, instance, closed, unsentBodies: context.unsentBodies as Map<string, { body: string }>, setCommentState: (state: typeof commentState) => { commentState = state; }, setConfirm: (fn: () => Promise<boolean>) => { context.showConfirm = fn; }, setRun: (fn: typeof run) => { run = fn; } };
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
}
const textarea = (tree: any) => find(tree, node => node.type === "textarea");
const submit = (tree: any) => find(tree, node => node.type === "button" && node.props.className === "btn btn-sm btn-primary");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("unsent text is kept per discussion until it is sent or cancelled", async () => {
  const h = harness();
  const props = (draftKey: string, onCancel?: () => void) => ({ placeholder: "", submitLabel: "", draftKey, onCancel, onSubmit: async () => true });
  const typed = h.instance(h.Composer, props("reply:a"));
  textarea(typed.render()).props.onChange({ target: { value: "Half-written reply" } });
  // 一覧に戻って開き直す（作り直す）と、そのスレッドの書きかけだけが戻る。
  const reopened = h.instance(h.Composer, props("reply:a"));
  assert.equal(textarea(reopened.render()).props.value, "Half-written reply");
  assert.equal(textarea(h.instance(h.Composer, props("reply:b")).render()).props.value, "");
  submit(reopened.render()).props.onClick(); await tick();
  assert.equal(textarea(h.instance(h.Composer, props("reply:a")).render()).props.value, "");
  // 取り消した新しいコメントは、次に開いたときに戻さない。
  const draft = h.instance(h.Composer, props("new", () => {}));
  textarea(draft.render()).props.onChange({ target: { value: "Discard me" } });
  find(draft.render(), node => node.type === "button" && node.props.className === "btn btn-sm btn-ghost").props.onClick();
  assert.equal(textarea(h.instance(h.Composer, props("new")).render()).props.value, "");
  assert.equal(h.unsentBodies.size, 0);
});

for (const ok of [true, false]) test(`pending submission is read-only and ${ok ? "clears on success" : "retains text on failure"}`, async () => {
  const h = harness(); const response = deferred<boolean>(); const sent: string[] = [];
  const composer = h.instance(h.Composer, { initial: "First reply", placeholder: "", submitLabel: "", onSubmit: (body: string) => { sent.push(body); return response.promise; } });
  const click = submit(composer.render()).props.onClick;
  click(); click(); // 再描画の前に2回目の操作をしても、二重に送信しない。
  assert.equal(textarea(composer.render()).props.readOnly, true);
  assert.equal(submit(composer.render()).props.disabled, true);
  assert.deepEqual(sent, ["First reply"]);
  response.resolve(ok); await tick();
  assert.equal(textarea(composer.render()).props.readOnly, false);
  assert.equal(textarea(composer.render()).props.value, ok ? "" : "First reply");
});

test("a new comment rejected for a deleted site keeps its text and draft open", async (t) => {
  const h = harness();
  const draft = { pageId: "page", nodeId: null, x: .5, y: .5, bp: "base" };
  useComments.setState({ active: true, store: "server", threads: [], error: null });
  useComments.getState().setDraft(draft);
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Site not found", code: "comment_site_missing" }, { status: 404 }));
  const composer = h.instance(h.Composer, { initial: "Unsent new comment", placeholder: "", submitLabel: "", onSubmit: async (body: string) => {
    const ok = await useComments.getState().run({ action: "create", id: "new", ...draft, body });
    if (ok) openPostedComment(draft, "new");
    return ok;
  } });
  submit(composer.render()).props.onClick(); await tick();
  assert.equal(textarea(composer.render()).props.value, "Unsent new comment");
  assert.equal(textarea(composer.render()).props.readOnly, false);
  assert.equal(useComments.getState().draft, draft);
  assert.equal(useComments.getState().openId, null);
  assert.equal(useComments.getState().error, "Couldn\'t save the comment");
});

test("an old edit completion cannot close a cancelled and reopened edit session", async () => {
  const h = harness(); const response = deferred<boolean>(); h.setRun(() => response.promise);
  const m = { id: "message", author: {}, body: "Original", at: 1 };
  const message = h.instance(h.Message, { m, thread: { id: "thread", messages: [m] } });
  const openEdit = () => {
    find(message.render(), n => n.type === "button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 200, bottom: 20 }) } });
    find(message.render(), n => n.type === "ContextMenu").props.items.find((i: any) => i.key === "edit").onClick();
    return find(message.render(), n => n.type === h.Composer);
  };
  const first = openEdit(); const saved = first.props.onSubmit("First edit"); first.props.onCancel();
  assert.equal(find(message.render(), n => n.type === h.Composer), undefined);
  const second = openEdit(); assert.ok(second);
  response.resolve(true); await saved;
  assert.ok(find(message.render(), n => n.type === h.Composer), "new editing session must remain mounted");
});

for (const nativeEvent of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) test(`IME confirmation and cancellation stay inside the composer: ${JSON.stringify(nativeEvent)}`, () => {
  const h = harness(); let cancelled = 0; let sent = 0;
  const composer = h.instance(h.Composer, { initial: "日本語", placeholder: "", submitLabel: "", onCancel: () => cancelled++, onSubmit: () => { sent++; return false; } });
  const keydown = textarea(composer.render()).props.onKeyDown;
  keydown({ key: "Escape", nativeEvent, stopPropagation() {} });
  keydown({ key: "Enter", metaKey: true, nativeEvent, preventDefault() {} });
  assert.equal(cancelled, 0); assert.equal(sent, 0);
  keydown({ key: "Escape", nativeEvent: { isComposing: false }, stopPropagation() {} });
  assert.equal(cancelled, 1);
});


test("oversized input is kept intact, visibly rejected and never submitted", () => {
  const h = harness(); let sent = 0;
  const composer = h.instance(h.Composer, { initial: "x".repeat(5001), placeholder: "", submitLabel: "", onSubmit: () => { sent++; return true; } });
  assert.equal(textarea(composer.render()).props.value.length, 5001);
  assert.equal(submit(composer.render()).props.disabled, true);
  assert.ok(find(composer.render(), node => node.props.role === "alert"));
  submit(composer.render()).props.onClick(); assert.equal(sent, 0);
});


test("the comment layer's bubbling Escape listener also ignores IME events", () => {
  const source = readFileSync(new URL("../components/Comments.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const onKey = (e: KeyboardEvent)");
  const end = source.indexOf('window.addEventListener("keydown", onKey)', start);
  assert.ok(start >= 0 && end > start);
  const code = transformSync(source.slice(start, end) + "\nexport { onKey };", { loader: "ts", format: "cjs" }).code;
  const closed: unknown[] = []; const active: boolean[] = [];
  const context: any = { module: { exports: {} }, document: { querySelector: () => null }, isEscapeKey,
    useComments: { getState: () => ({ draft: {}, openId: null, open: (id: unknown) => closed.push(id), setActive: (value: boolean) => active.push(value) }) } };
  runInNewContext(code, context);
  const onKey = context.module.exports.onKey;
  onKey({ key: "Escape", isComposing: true }); onKey({ key: "Escape", isComposing: false, keyCode: 229 });
  assert.deepEqual(closed, []); assert.deepEqual(active, []);
  onKey({ key: "Escape", isComposing: false, keyCode: 27 }); assert.deepEqual(closed, [null]);
});


test("an unavailable discussion keeps the text copyable but prevents submission", () => {
  const h = harness(); let sent = 0;
  const composer = h.instance(h.Composer, { initial: "Unsent reply", disabled: true, placeholder: "", submitLabel: "", onSubmit: () => { sent++; return true; } });
  assert.equal(textarea(composer.render()).props.value, "Unsent reply");
  assert.equal(submit(composer.render()).props.disabled, true);
  submit(composer.render()).props.onClick(); assert.equal(sent, 0);
});


for (const unavailable of [true, false]) test(`message deletion uses the authoritative remaining thread, not its earlier count: ${unavailable}`, async () => {
  const h = harness(); const m = { id: "one", author: {}, body: "Original", at: 1 };
  const message = h.instance(h.Message, { m, thread: { id: "thread", messages: [m, { ...m, id: "two" }] } });
  h.setRun(async () => { h.setCommentState({ threadUnavailable: unavailable }); return true; });
  find(message.render(), node => node.type === "button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 200, bottom: 20 }) } });
  await find(message.render(), node => node.type === "ContextMenu").props.items.find((item: any) => item.key === "delete").onClick();
  assert.deepEqual(h.closed, unavailable ? ["thread"] : []);
});

for (const next of ["New draft", "Sent draft"]) test(`late send completion preserves a remounted draft: ${next}`, async () => {
  const h = harness(), response = deferred<boolean>();
  const props = { draftKey: "reply:thread", placeholder: "", submitLabel: "", onSubmit: () => response.promise };
  const first = h.instance(h.Composer, props);
  textarea(first.render()).props.onChange({ target: { value: "Sent draft" } });
  submit(first.render()).props.onClick(); first.unmount();
  const reopened = h.instance(h.Composer, props);
  textarea(reopened.render()).props.onChange({ target: { value: next } });
  response.resolve(true); await tick(); reopened.unmount();
  assert.equal(textarea(h.instance(h.Composer, props).render()).props.value, next);
});

for (const kind of ["message", "thread"]) test(`${kind} deletion confirmation is cancelled on unmount and cannot be duplicated`, async () => {
  const h = harness(), response = deferred<boolean>(); let confirms = 0; const actions: unknown[] = [];
  h.setConfirm(() => { confirms++; return response.promise; }); h.setRun(async action => { actions.push(action); return true; });
  const m = { id: "one", author: {}, body: "Original", at: 1 };
  const props = { m, thread: { id: "thread", messages: [m] }, unavailable: false, place: "", notices: null, onClose() {} };
  const panel = h.instance(kind === "message" ? h.Message : h.ThreadView, props);
  let remove: () => Promise<void>;
  if (kind === "message") {
    find(panel.render(), node => node.type === "button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 200, bottom: 20 }) } });
    remove = find(panel.render(), node => node.type === "ContextMenu").props.items.find((item: any) => item.key === "delete").onClick;
  } else remove = find(panel.render(), node => node.props?.["aria-label"] === "Delete thread").props.onClick;
  const first = remove(), second = remove();
  assert.equal(confirms, 1); panel.unmount(); response.resolve(true); await Promise.all([first, second]);
  assert.deepEqual(actions, []);
});

test("thread deletion is cancelled when the discussion becomes unavailable during confirmation", async () => {
  const h = harness(), response = deferred<boolean>(); const actions: unknown[] = [];
  h.setConfirm(() => response.promise); h.setRun(async action => { actions.push(action); return true; });
  const props = { thread: { id: "thread", messages: [{ id: "one", author: {}, body: "Original", at: 1 }] }, unavailable: false, place: "", notices: null, onClose() {} };
  const panel = h.instance(h.ThreadView, props);
  const work = find(panel.render(), node => node.props?.["aria-label"] === "Delete thread").props.onClick();
  props.unavailable = true; panel.render(); response.resolve(true); await work;
  assert.deepEqual(actions, []);
});

test("a cancelled thread deletion releases its lock so a later confirmed deletion succeeds", async () => {
  const h = harness(); const actions: unknown[] = []; let closed = 0;
  h.setConfirm(async () => false); h.setRun(async action => { actions.push(action); return true; });
  const panel = h.instance(h.ThreadView, { thread: { id: "thread", messages: [{ id: "one", author: {}, body: "Original", at: 1 }] }, unavailable: false, place: "", notices: null, onClose() { closed++; } });
  const remove = () => find(panel.render(), node => node.props?.["aria-label"] === "Delete thread").props.onClick();
  await remove(); assert.equal(actions.length, 0);
  h.setConfirm(async () => true); await remove();
  assert.equal(actions.length, 1); assert.equal(closed, 1);
});

for (const kind of ["message", "thread"]) test(`${kind} deletion closes the removed discussion after its own update unmounts the view`, async () => {
  const h = harness();
  const m = { id: "one", author: {}, body: "Original", at: 1 };
  const panel = h.instance(kind === "message" ? h.Message : h.ThreadView, {
    m, thread: { id: "thread", messages: [m] }, unavailable: false, place: "", notices: null,
    onClose() { h.closed.push("thread"); },
  });
  h.setRun(async () => {
    h.setCommentState({ threadUnavailable: true });
    panel.unmount();
    return true;
  });
  let remove: () => Promise<void>;
  if (kind === "message") {
    find(panel.render(), node => node.type === "button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ right: 200, bottom: 20 }) } });
    remove = find(panel.render(), node => node.type === "ContextMenu").props.items.find((item: any) => item.key === "delete").onClick;
  } else remove = find(panel.render(), node => node.props?.["aria-label"] === "Delete thread").props.onClick;
  await remove();
  assert.deepEqual(h.closed, ["thread"]);
});

for (const draftKey of ["new", undefined]) test(`Escape cancels an explicit composer and discards its draft: ${draftKey ?? "edit"}`, () => {
  const h = harness(); let cancelled = 0; let stopped = 0;
  const props = { draftKey, initial: "", placeholder: "", submitLabel: "", onCancel: () => cancelled++, onSubmit: () => false };
  const composer = h.instance(h.Composer, props);
  textarea(composer.render()).props.onChange({ target: { value: "Discarded text" } });
  textarea(composer.render()).props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: false }, stopPropagation() { stopped++; } });
  assert.equal(cancelled, 1);
  assert.equal(stopped, 1);
  composer.unmount();
  assert.equal(textarea(h.instance(h.Composer, props).render()).props.value, "");
});

test("Escape in a reply bubbles to the thread close handler and preserves its unsent text", () => {
  const h = harness(); let stopped = 0;
  const props = { draftKey: "reply:thread", placeholder: "", submitLabel: "", onSubmit: () => false };
  const composer = h.instance(h.Composer, props);
  textarea(composer.render()).props.onChange({ target: { value: "Keep this reply" } });
  textarea(composer.render()).props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: false }, stopPropagation() { stopped++; } });
  assert.equal(stopped, 0, "the canvas Escape listener must be able to close the discussion");
  composer.unmount();
  assert.equal(textarea(h.instance(h.Composer, props).render()).props.value, "Keep this reply");
});
});

describe("comment-id-collisions", () => {
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
    NextResponse, userMessage, JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited,
    serverTr: async () => (text: string) => text,
    requireAuth: async (mode?: "user") => mode === "user" ? user : null, requireSiteAccess: async () => null,
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
});

describe("comment-local-storage", () => {
const key = "tsumu-comments-v1:local-comments";
const create = (id: string): CommentAction_3 => ({ action: "create", id, pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: id });
const initial = applyCommentAction([], create("existing"), null, 1);
const actions: CommentAction_3[] = [
  create("new"),
  { action: "reply", threadId: "existing", id: "reply", body: "Reply" },
  { action: "edit", messageId: "existing-0", body: "Edited" },
  { action: "resolve", threadId: "existing", resolved: true },
  { action: "delete-message", messageId: "existing-0" },
  { action: "delete-thread", threadId: "existing" },
];
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  mock.reset();
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as any).window;
});

function setup(store: "local" | null, failure: "read" | "write" | null, raw = JSON.stringify(initial)) {
  const memory = new Map([[key, raw]]);
  let writes = 0;
  let posts = 0;
  const storage = {
    getItem(k: string) {
      if (failure === "read") throw new DOMException("Blocked", "SecurityError");
      return memory.get(k) ?? null;
    },
    setItem(k: string, value: string) {
      writes++;
      if (failure === "write") throw new DOMException("Full", "QuotaExceededError");
      memory.set(k, value);
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/sites/local-comments" }, localStorage: storage,
  } });
  mock.method(globalThis, "fetch", async (_url, init) => {
    if (init?.method) posts++;
    return Response.json({}, { status: 503 });
  });
  mock.method(console, "error", () => {});
  useComments.setState({ focusedThread: structuredClone(initial[0]), threadUnavailable: false, store, threads: structuredClone(initial), loading: false, error: null, openId: "existing", draft: null });
  return { memory, writes: () => writes, posts: () => posts, recover: () => { failure = null; } };
}

for (const store of ["local", null] as const) for (const failure of ["read", "write"] as const) for (const action of actions) {
  test(`${store ?? "503 fallback"}: ${action.action} fails honestly after a local ${failure} failure and can be retried`, async () => {
    const storage = setup(store, failure);
    const before = structuredClone(useComments.getState().threads);
    assert.equal(await useComments.getState().run(action), false);
    assert.deepEqual(useComments.getState().threads, before);
    assert.equal(storage.memory.get(key), JSON.stringify(initial));
    assert.equal(useComments.getState().openId, "existing");
    assert.ok(useComments.getState().error);
    if (failure === "read") assert.equal(storage.writes(), 0);
    storage.recover();
    assert.equal(await useComments.getState().run(action), true);
    const saved = JSON.parse(storage.memory.get(key)!);
    assert.deepEqual(useComments.getState().threads, saved);
    assert.equal(useComments.getState().error, null);
    assert.equal(useComments.getState().store, "local");
    await useComments.getState().load();
    assert.deepEqual(useComments.getState().threads, saved);
    if (store === "local") assert.equal(storage.posts(), 0);
  });
}

for (const raw of ["", "{broken", "null", "{}", "true"]) {
  test(`an unreadable saved comment list ${JSON.stringify(raw)} is never replaced by a new comment`, async () => {
    const storage = setup("local", null, raw);
    assert.equal(await useComments.getState().run(create("new")), false);
    assert.equal(storage.memory.get(key), raw);
    assert.equal(storage.writes(), 0);
    assert.deepEqual(useComments.getState().threads, initial);
    assert.ok(useComments.getState().error);
  });
}

for (const store of ["local", null] as const) for (const failure of ["read", "invalid"] as const) {
  test(`${store ?? "503 fallback"}: a failed ${failure} refresh preserves displayed comments and reports an error`, async () => {
    const storage = setup(store, failure === "read" ? "read" : null, failure === "invalid" ? "{broken" : JSON.stringify(initial));
    await useComments.getState().load();
    assert.deepEqual(useComments.getState().threads, initial);
    assert.ok(useComments.getState().error);
    assert.equal(useComments.getState().loading, false);
    assert.equal(storage.writes(), 0);
    storage.recover(); storage.memory.set(key, JSON.stringify(initial));
    await useComments.getState().load();
    assert.deepEqual(useComments.getState().threads, initial);
    assert.equal(useComments.getState().error, null);
  });
}

test("an absent local list still accepts the first comment and preserves later queued replies", async () => {
  const storage = setup("local", null);
  storage.memory.delete(key);
  useComments.setState({ threads: [] });
  const first = useComments.getState().run(create("new"));
  const second = useComments.getState().run({ action: "reply", threadId: "new", id: "reply", body: "Reply" });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  await useComments.getState().load();
  assert.deepEqual(useComments.getState().threads[0].messages.map(m => m.body), ["new", "Reply"]);
});


for (const action of [create("long"), { action: "reply", threadId: "existing", id: "long-reply", body: "" }, { action: "edit", messageId: "existing-0", body: "" }] as CommentAction_3[]) {
  test(`${action.action} rejects oversize bodies instead of truncating or storing them locally`, async () => {
    const oversized = { ...action, body: "x".repeat(MAX_COMMENT_LENGTH_2 + 1) } as CommentAction_3;
    assert.equal(parseCommentAction_2(oversized), null);
    assert.ok(parseCommentAction_2({ ...action, body: "x".repeat(MAX_COMMENT_LENGTH_2) }));
    const storage = setup("local", null);
    assert.equal(await useComments.getState().run(oversized), false);
    assert.equal(storage.writes(), 0); assert.equal(storage.memory.get(key), JSON.stringify(initial));
    assert.deepEqual(useComments.getState().threads, initial); assert.ok(useComments.getState().error);
  });
}


test("a local reply to a thread removed in another tab fails without writing or losing its open detail", async () => {
  const storage = setup("local", null); storage.memory.set(key, "[]");
  assert.equal(await useComments.getState().run({ action: "reply", threadId: "existing", id: "late", body: "Keep this text" }), false);
  assert.equal(storage.writes(), 0); assert.equal(storage.memory.get(key), "[]");
  assert.deepEqual(useComments.getState().threads, []); assert.equal(useComments.getState().threadUnavailable, true);
  assert.equal(useComments.getState().focusedThread?.id, "existing"); assert.ok(useComments.getState().error);
  await useComments.getState().load(); assert.equal(useComments.getState().focusedThread?.id, "existing");
  assert.equal(useComments.getState().threadUnavailable, true);
});

for (const store of ["local", null] as const) for (const collision of ["body", "author", "thread", "create-thread", "create-message"] as const) {
  test(`${store ?? "503 fallback"}: a ${collision} ID collision preserves stored content and the open draft host`, async () => {
    let saved = applyCommentAction(initial, create("other"), null, 2);
    const reply = { action: "reply" as const, threadId: "existing", id: "reply", body: "Reply" };
    const stored = collision === "thread" ? { ...reply, threadId: "other" }
      : collision === "create-message" ? { ...reply, id: "new-0" } : reply;
    saved = applyCommentAction(saved, stored, collision === "author" ? { email: "author@example.com", name: "Author", image: null } : null, 3);
    const storage = setup(store, null, JSON.stringify(saved));
    const action = collision === "body" ? { ...reply, body: "Keep this unsent reply" }
      : collision === "create-message" ? create("new") : collision === "create-thread" ? create("existing") : reply;
    const before = structuredClone(useComments.getState().threads);
    assert.equal(await useComments.getState().run(action), false);
    assert.equal(storage.memory.get(key), JSON.stringify(saved)); assert.equal(storage.writes(), 0);
    assert.deepEqual(useComments.getState().threads, before);
    assert.equal(useComments.getState().openId, "existing"); assert.equal(useComments.getState().focusedThread?.id, "existing");
    assert.equal(useComments.getState().threadUnavailable, false); assert.ok(useComments.getState().error);
    assert.deepEqual(applyCommentAction(saved, action, null, 4), saved, "the pure local reducer also preserves global message-ID uniqueness");
  });
}

for (const store of ["local", null] as const) test(`${store ?? "503 fallback"}: an identical reply retry succeeds without changing messages or timestamps`, async () => {
  const reply = { action: "reply" as const, threadId: "existing", id: "reply", body: "Reply" };
  const saved = applyCommentAction(initial, reply, null, 2);
  const storage = setup(store, null, JSON.stringify(saved));
  assert.equal(await useComments.getState().run(reply), true);
  assert.equal(storage.memory.get(key), JSON.stringify(saved));
  assert.deepEqual(useComments.getState().threads, saved);
  assert.equal(useComments.getState().threadUnavailable, false); assert.equal(useComments.getState().error, null);
});

for (const store of ["local", null] as const) {
  test(`${store ?? "503 fallback"}: editing a deleted message fails without discarding its stale visible draft`, async () => {
    const storage = setup(store, null, "[]");
    const previous = useComments.getState();
    assert.equal(await useComments.getState().run({ action: "edit", messageId: "existing-0", body: "Unsaved edit" }), false);
    assert.equal(storage.writes(), 0);
    assert.equal(storage.memory.get(key), "[]");
    assert.equal(useComments.getState().threads, previous.threads);
    assert.equal(useComments.getState().focusedThread, previous.focusedThread);
    assert.equal(useComments.getState().openId, previous.openId);
    assert.ok(useComments.getState().error);
  });
}
});

describe("comment-pagination", () => {
async function database(run: (db: Db) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "tsumu-comment-pages-"));
  const old = process.env.TSUMU_DATA_DIR; process.env.TSUMU_DATA_DIR = dir;
  try {
    const db = await getDbFromBinding(nodeDatabase()!);
    await db.execute("PRAGMA synchronous = OFF");
    for (const id of ["site", "other"]) await insertSite(db, id, { name: id, repo: null, branch: "main", previewBranch: "preview", siteUrl: null, previewUrl: null });
    await run(db);
  } finally {
    if (old === undefined) delete process.env.TSUMU_DATA_DIR; else process.env.TSUMU_DATA_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
}
async function create(db: Db, id: string, at: number, site = "site") {
  await runCommentAction_2(db, site, { action: "create", id, pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: id }, null, at);
}

test("the 1001st thread is visible and every older thread remains reachable", async () => database(async db => {
  for (let i = 0; i <= COMMENT_PAGE_SIZE; i++) await create(db, `c${String(i).padStart(4, "0")}`, i + 1);
  await runCommentAction_2(db, "site", { action: "resolve", threadId: "c0000", resolved: true }, null, 2000);
  const first = await listCommentPage_2(db, "site");
  assert.equal(first.threads.length, COMMENT_PAGE_SIZE); assert.equal(first.threads[0].id, "c1000");
  assert.equal(first.total, 1001); assert.equal(first.unresolvedCount, 1000); assert.ok(first.nextCursor);
  const older = await listCommentPage_2(db, "site", parseCommentCursor_2(first.nextCursor));
  assert.deepEqual(older.threads.map(t => t.id), ["c0000"]); assert.equal(older.nextCursor, null);
  assert.equal(new Set([...first.threads, ...older.threads].map(t => t.id)).size, 1001);
  assert.equal(older.total, 1001); assert.equal(older.unresolvedCount, 1000);
  await create(db, "newest", 3000);
  assert.equal((await listCommentPage_2(db, "site")).threads[0].id, "newest");
}));

test("tied timestamps and deleted cursor rows do not skip or duplicate older comments", async () => database(async db => {
  for (let i = 0; i < COMMENT_PAGE_SIZE + 2; i++) await create(db, `t${String(i).padStart(4, "0")}`, 10);
  const first = await listCommentPage_2(db, "site");
  const cursor = parseCommentCursor_2(first.nextCursor)!;
  await runCommentAction_2(db, "site", { action: "delete-thread", threadId: cursor.id }, null);
  await create(db, "z_new", 10);
  const next = await listCommentPage_2(db, "site", cursor);
  assert.deepEqual(next.threads.map(t => t.id), ["t0001", "t0000"]);
  assert.equal(next.nextCursor, null);
  const end = await listCommentPage_2(db, "site", { createdAt: 10, id: "t0000" });
  assert.deepEqual(end.threads, []); assert.equal(end.nextCursor, null);
}));

test("off-batch focus is independent, site-scoped, current, and explicitly absent after deletion", async () => database(async db => {
  await create(db, "old", 1); await create(db, "new", 2); await create(db, "private", 3, "other");
  const cursor = { createdAt: 2, id: "new" };
  const page = await listCommentPage_2(db, "site", cursor, "new");
  assert.deepEqual(page.threads.map(t => t.id), ["old"]); assert.equal(page.focusedThread?.id, "new");
  assert.equal((await listCommentPage_2(db, "site", cursor, "private")).focusedThread, null);
  await runCommentAction_2(db, "site", { action: "reply", threadId: "new", id: "reply", body: "Reply" }, null, 4);
  assert.deepEqual((await listCommentPage_2(db, "site", cursor, "new")).focusedThread?.messages.map(m => m.body), ["new", "Reply"]);
  await runCommentAction_2(db, "site", { action: "delete-thread", threadId: "new" }, null);
  assert.equal((await listCommentPage_2(db, "site", cursor, "new")).focusedThread, null);
}));

test("message reads exclude other batches and sites, except the requested focused thread", async () => database(async db => {
  await create(db, "old", 1); await create(db, "new", 2); await create(db, "private", 3, "other");
  let returned: string[] = [];
  const tracked: Db = { ...db, batch: async statements => {
    const result = await db.batch(statements);
    returned = result[1].rows.map(r => String(r.thread_id)); return result;
  } };
  await listCommentPage_2(tracked, "site", { createdAt: 2, id: "new" }); assert.deepEqual(returned, ["old"]);
  await listCommentPage_2(tracked, "site", { createdAt: 2, id: "new" }, "new"); assert.deepEqual(returned, ["old", "new"]);
  await listCommentPage_2(tracked, "site", null, "private"); assert.deepEqual(returned, ["old", "new"]);
}));

test("cursor parsing rejects malformed, unsafe and injectable values", () => {
  for (const value of [null, "", "-1:x", "1.5:x", "NaN:x", "1:", "1:x' OR 1=1", "9007199254740992:x", `1:${"x".repeat(65)}`]) assert.equal(parseCommentCursor_2(value), null);
  assert.deepEqual(parseCommentCursor_2("0:a_B-1"), { createdAt: 0, id: "a_B-1" });
});


test("the original message stays first when a reply has the same timestamp", async () => database(async db => {
  await create(db, "z_thread", 1);
  await runCommentAction_2(db, "site", { action: "reply", threadId: "z_thread", id: "a_reply", body: "Reply" }, { email: "other@example.com", name: null, image: null }, 1);
  assert.deepEqual((await listCommentPage_2(db, "site")).threads[0].messages.map(m => m.id), ["z_thread-0", "a_reply"]);
}));


test("a same-time reply cannot claim ownership and delete the original author's thread", async () => database(async db => {
  const owner = { email: "owner@example.com", name: null, image: null };
  const replier = { email: "replier@example.com", name: null, image: null };
  await runCommentAction_2(db, "site", { action: "create", id: "thread", pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: "Original" }, owner, 1);
  await runCommentAction_2(db, "site", { action: "reply", threadId: "thread", id: "reply", body: "Reply" }, replier, 1);
  assert.equal(await runCommentAction_2(db, "site", { action: "delete-thread", threadId: "thread" }, replier), false);
  assert.equal((await listCommentPage_2(db, "site")).threads[0].messages[0].author.email, owner.email);
  assert.equal(await runCommentAction_2(db, "site", { action: "delete-thread", threadId: "thread" }, owner), true);
}));
});

describe("comment-storage", () => {
const author = { email: "author@example.com", name: "Author", image: null };
const create: CommentAction_4 = {
  action: "create", id: "thread", pageId: "page", nodeId: null, x: 0.5, y: 0.5,
  bp: "base", body: "Original",
};
const reply: CommentAction_4 = { action: "reply", threadId: "thread", id: "reply", body: "Reply" };

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

test("comment creation requires an explicit current breakpoint ID", () => {
  for (const bp of [undefined, null, "", 123, "x".repeat(41)]) {
    assert.equal(parseCommentAction_3({ ...create, bp }), null);
  }
  assert.deepEqual(parseCommentAction_3(create), create);
});

test("a late comment creation cannot recreate data for a deleted site", async () => {
  await database(async (db) => {
    await deleteSite(db, "site");
    assert.equal(await runCommentAction_3(db, "site", create, author), "site-missing");
    await assertEmpty(db);
  });
});

// 実際の API・サイトの ID の検証・SQLite を通し、認証・翻訳・接続だけを差し替える。
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
    NextResponse, serverTr, siteIdOf, userMessage, JsonBodyTooLargeError, JsonContentTypeError, jsonErrorStatus, readJsonLimited,
    listCommentPage: listCommentPage_3, parseCommentCursor: parseCommentCursor_3, parseCommentAction: parseCommentAction_3, runCommentAction: runCommentAction_3,
    requireAuth: async (mode?: "editor-user") => mode === "editor-user" ? author : null, requireSiteAccess: async () => null,
    dbConfigured: () => true, getDb: async () => db,
    dbUnavailable: () => { throw new Error("Unexpected fallback"); },
  }) as (req: Request) => Promise<Response>;
  return (site = "site", action: CommentAction_4 = create, contentType = "application/json") => post(new Request(`https://example.com/api/comments?site=${encodeURIComponent(site)}`, { method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(action) }));
}

test("the API stores the identity that authorized the new comment", async () => database(async db => {
  assert.equal((await api(db)()).status, 200);
  const [thread] = (await listCommentPage_3(db, "site")).threads;
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
    assert.deepEqual(await response.json(), { error: "Site not found", code: "comment_site_missing" });
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
      await runCommentAction_3(db, "site", create, author, 1);
      let intercepted = false;
      const racingDb: Db = {
        ...db,
        batch: async (statements) => {
          // 事前の読み取りをすべて終えた後、返信を書き込むトランザクションの直前に削除する。
          assert.equal(intercepted, false);
          intercepted = true;
          if (target === "site") await deleteSite(db, "site");
          else await runCommentAction_3(db, "site", { action: "delete-thread", threadId: "thread" }, author, 2);
          return db.batch(statements);
        },
      };
      assert.equal(await runCommentAction_3(racingDb, "site", reply, author, 3), "missing");
      assert.equal(intercepted, true);
      await assertEmpty(db);
    });
  });
}

test("comment creation and replies still persist, and retries cannot duplicate replies", async () => {
  await database(async (db) => {
    assert.equal(await runCommentAction_3(db, "site", create, author, 1), true);
    assert.equal(await runCommentAction_3(db, "site", reply, author, 2), true);
    assert.equal(await runCommentAction_3(db, "site", reply, author, 3), true);
    const threads = (await listCommentPage_3(db, "site")).threads;
    assert.equal(threads.length, 1);
    assert.deepEqual(threads[0].messages.map((m) => m.body), ["Original", "Reply"]);
    assert.equal(threads[0].updatedAt, 2);
    assert.equal(await runCommentAction_3(db, "other-site", { ...reply, id: "wrong-site" }, author, 4), "missing");
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM comment_messages")).rows[0].n, 2);
  });
});

for (const timing of ["before lookup", "before write"] as const) {
  test(`editing a comment deleted ${timing} cannot falsely report success`, async () => database(async db => {
    await runCommentAction_3(db, "site", create, author, 1);
    await runCommentAction_3(db, "site", reply, author, 2);
    if (timing === "before lookup") await runCommentAction_3(db, "site", { action: "delete-message", messageId: "reply" }, author, 3);
    const wrapped: Db = { ...db, batch: async statements => {
      if (timing === "before write") await runCommentAction_3(db, "site", { action: "delete-message", messageId: "reply" }, author, 3);
      return db.batch(statements);
    } };
    const result = await runCommentAction_3(wrapped, "site", { action: "edit", messageId: "reply", body: "Unsaved edit" }, author, 4);
    assert.equal(result, "message-missing");
    const [thread] = (await listCommentPage_3(db, "site")).threads;
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
  await runCommentAction_3(db, "site", create, author, 100);
  await runCommentAction_3(db, "site", reply, other, 200);
  let raced = false;
  const racingDb: Db = { ...db, batch: async statements => {
    if (!raced) {
      raced = true;
      assert.equal(await runCommentAction_3(db, "site", { action: "delete-message", messageId: "thread-0" }, author, 300), true);
    }
    return db.batch(statements);
  } };
  assert.equal(await runCommentAction_3(racingDb, "site", { action: "delete-thread", threadId: "thread" }, author, 400), false);
  const threads = (await listCommentPage_3(db, "site")).threads;
  assert.equal(threads.length, 1); assert.deepEqual(threads[0].messages.map(m => m.id), ["reply"]);
  assert.equal(await runCommentAction_3(db, "site", { action: "delete-thread", threadId: "thread" }, other, 500), true);
  await assertEmpty(db);
  assert.equal(await runCommentAction_3(db, "site", { action: "delete-thread", threadId: "thread" }, other, 600), true, "already removed threads remain idempotent");
}));

test("a delayed message deletion cannot delete a replacement message owned by another author", async () => database(async db => {
  const other = { email: "other@example.com", name: "Other", image: null };
  await runCommentAction_3(db, "site", create, author, 100);
  let raced = false;
  const racingDb: Db = { ...db, batch: async statements => {
    if (!raced) {
      raced = true;
      await runCommentAction_3(db, "site", { action: "delete-thread", threadId: "thread" }, author, 200);
      await runCommentAction_3(db, "site", { ...create, body: "Replacement" }, other, 300);
    }
    return db.batch(statements);
  } };
  assert.equal(await runCommentAction_3(racingDb, "site", { action: "delete-message", messageId: "thread-0" }, author, 400), false);
  const threads = (await listCommentPage_3(db, "site")).threads;
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
});

describe("comment-targets", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const anchor = { pageId: "p", nodeId: "target" };
const state = () => useEditor.getState();
function setup() {
  state().replaceDoc(commentTargetDoc()); state().setActivePage("p");
  const threads = applyCommentAction([], { action: "create", id: "thread", ...anchor, x: .5, y: .5, bp: "base", body: "Keep this discussion" }, null, 1);
  useComments.setState({ threads, active: true, openId: "thread", draft: null, store: "local", error: null, loading: false, showResolved: false });
  return threads;
}

test("element and subtree deletion retain comments, and undo/redo reconnect exact ids", () => {
  const before = setup();
  state().deleteNode("parent");
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "deleted-node");
  assert.deepEqual(useComments.getState().threads, before);
  state().undo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "node");
  state().redo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "deleted-node");
  assert.deepEqual(useComments.getState().threads, before);
});

test("deleted page retains its open thread after the active page changes", () => {
  setup(); state().deletePage("p");
  assert.equal(state().activePageId, "q");
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "deleted-page");
  assert.equal(useComments.getState().openId, "thread");
  state().undo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "node");
});

test("responsive and ancestor-hidden targets are present, not deleted", () => {
  const doc = commentTargetDoc(); doc.nodes.parent.hiddenOn = ["sm"];
  assert.deepEqual(commentTargetResolver(doc, "sm")(anchor), { kind: "node", pageId: "p", hidden: true });
  assert.equal(commentTargetResolver(doc, "base")(anchor).hidden, false);
  doc.nodes.parent.hiddenOn = []; doc.nodes.target.styles.sm = { default: { display: "none" } };
  assert.equal(commentTargetResolver(doc, "sm")(anchor).hidden, true);
  assert.equal(isDeletedCommentTarget(commentTargetResolver(doc, "sm")(anchor)), false);
});

test("an existing unrendered node is not deleted, and a moved node follows its current page", () => {
  const doc = commentTargetDoc(); doc.nodes.parent.children = [];
  assert.equal(commentTargetResolver(doc, "base")(anchor).kind, "node");
  doc.pages.q.children.push("target"); delete doc.pages.p;
  assert.deepEqual(commentTargetResolver(doc, "base")(anchor), { kind: "node", pageId: "q", hidden: false });
});

test("page comments distinguish present and deleted pages without a node id", () => {
  const doc = commentTargetDoc(); const thread = { pageId: "p", nodeId: null };
  assert.equal(commentTargetResolver(doc, "base")(thread).kind, "page");
  delete doc.pages.p;
  assert.equal(commentTargetResolver(doc, "base")(thread).kind, "deleted-page");
});

test("remote deletion and unrelated undo do not resurrect a target or change its discussion", () => {
  const before = setup(); state().updateNode("target", { name: "Local edit" });
  const remote = structuredClone(state().doc); delete remote.nodes.target; remote.nodes.parent.children = [];
  state().applyRemoteDoc(remote); state().undo();
  assert.equal(state().doc.nodes.target, undefined);
  assert.deepEqual(useComments.getState().threads, before);
  assert.equal(useComments.getState().openId, "thread");
});

test("new comment draft retains its original target after the page disappears", () => {
  setup(); useComments.getState().setDraft({ ...anchor, x: .5, y: .5, bp: "base" });
  state().deletePage("p");
  assert.deepEqual(useComments.getState().draft, { ...anchor, x: .5, y: .5, bp: "base" });
});

test("restoring an element never rolls back replies or resolution made while it was deleted", () => {
  setup(); state().deleteNode("parent");
  let threads = applyCommentAction(useComments.getState().threads, { action: "reply", threadId: "thread", id: "later", body: "Reply after deletion" }, null, 2);
  threads = applyCommentAction(threads, { action: "resolve", threadId: "thread", resolved: true }, null, 3);
  useComments.setState({ threads }); state().undo();
  assert.equal(commentTargetResolver(state().doc, "base")(anchor).kind, "node");
  assert.deepEqual(useComments.getState().threads, threads);
  assert.equal(threads[0].messages.length, 2); assert.equal(threads[0].resolvedAt, 3);
});

test("a replacement with the same name does not inherit the deleted element's discussion", () => {
  const doc = commentTargetDoc();
  doc.nodes.replacement = { ...doc.nodes.target, id: "replacement" };
  delete doc.nodes.target; doc.nodes.parent.children = ["replacement"];
  assert.equal(commentTargetResolver(doc, "base")(anchor).kind, "deleted-node");
});
});

describe("local-site-comment-deletion", () => {
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
const other = { ...source, id: "other", name: "Other" };
const listKey = storageKey("sites-v1");
const commentKey = siteKey(storageKey("comments-v1"), source.id);
const markerKey = siteKey(storageKey("site-deleted-v1"), source.id);
const create = (id: string): CommentAction_5 => ({ action: "create", id, pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: id });
const initial = applyCommentAction(applyCommentAction([], create("existing"), null, 1), create("second"), null, 2);
const draft = { pageId: "p", nodeId: null, x: .5, y: .5, bp: "base" };
const actions: CommentAction_5[] = [create("new"),
  { action: "reply", threadId: "existing", id: "reply", body: "Reply" },
  { action: "edit", messageId: "existing-0", body: "Edited" },
  { action: "resolve", threadId: "existing", resolved: true },
  { action: "delete-message", messageId: "existing-0" },
  { action: "delete-thread", threadId: "existing" },
];
afterEach(() => mock.reset());
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

async function setup(store: "server" | "local" | null = "local") {
  const values = new Map([[listKey, JSON.stringify([source, other])], [commentKey, JSON.stringify(initial)]]);
  let markerReadFailure = false;
  let cleanupFailure = false;
  let onCommentRead: (() => void) | undefined;
  let onCommentWrite: (() => void) | undefined;
  let commentWrites = 0;
  const storage: Storage = {
    get length() { return values.size; }, clear() { values.clear(); }, key(i) { return [...values.keys()][i] ?? null; },
    getItem(key) {
      if (markerReadFailure && key === markerKey) throw new DOMException("Blocked marker", "SecurityError");
      const value = values.get(key) ?? null;
      if (key === commentKey) { const callback = onCommentRead; onCommentRead = undefined; callback?.(); }
      return value;
    },
    setItem(key, value) {
      if (key === commentKey) { commentWrites++; const callback = onCommentWrite; onCommentWrite = undefined; callback?.(); }
      values.set(key, value);
    },
    removeItem(key) { if (cleanupFailure) throw new DOMException("Cleanup blocked", "SecurityError"); values.delete(key); },
  };
  const home = await homeSiteFixture(storage);
  home.location.pathname = `/sites/${source.id}`;
  mock.method(console, "error", () => {});
  useComments.setState({ active: true, store, threads: structuredClone(initial), focusedThread: null, threadUnavailable: false,
    openId: null, draft: null, error: null, loading: false, saving: false, cursor: null, previousCursors: [], nextCursor: null,
    total: initial.length, unresolvedCount: initial.length });
  return { home, values, storage, writes: () => commentWrites,
    failMarkerRead: (value: boolean) => { markerReadFailure = value; },
    failCleanup: (value: boolean) => { cleanupFailure = value; },
    duringRead: (callback: () => void) => { onCommentRead = callback; },
    duringWrite: (callback: () => void) => { onCommentWrite = callback; },
    async remove(id = source.id, name = source.name) { home.remove(id); home.answer(name); await home.flush(); },
    // 別のタブでの削除を、ストレージの呼び出しの間に挟む。確認の UI を通る通常の経路は、remove() で別に検証する。
    concurrentDelete() { deleteLocalSite(source.id); for (const key of SITE_SCOPED_KEYS) storage.removeItem(siteKey(key, source.id)); },
  };
}

for (const store of ["local", null] as const) for (const action of actions) {
  test(`${store ?? "POST 503"}: actual Home deletion rejects stale ${action.action} without dropping its draft host`, async () => {
    const f = await setup(store);
    try {
      if (action.action === "create") useComments.getState().setDraft(draft);
      else useComments.getState().open("existing");
      const focused = useComments.getState().focusedThread;
      await f.remove();
      assert.equal(isLocalSiteDeleted(source.id), true);
      assert.equal(f.values.has(commentKey), false);
      assert.equal(await useComments.getState().run(action), false);
      assert.equal(f.writes(), 0); assert.equal(f.values.has(commentKey), false);
      const state = useComments.getState();
      assert.deepEqual(state.threads, []); assert.equal(state.total, 0); assert.equal(state.unresolvedCount, 0);
      assert.equal(state.active, true); assert.equal(state.error, "Site not found");
      if (action.action === "create") assert.equal(state.draft, draft);
      else { assert.equal(state.openId, "existing"); assert.equal(state.focusedThread, focused); assert.equal(state.threadUnavailable, true); }
    } finally { f.home.dispose(); }
  });
}

test("queued mutations recheck a deletion made while the first POST awaited its 503 response", async () => {
  const f = await setup(null);
  const response = deferred<Response>(); let posts = 0;
  try {
    useComments.getState().setDraft(draft);
    mock.method(globalThis, "fetch", async () => { posts++; return response.promise; });
    const pending = actions.map(a => useComments.getState().run(a));
    await Promise.resolve(); assert.equal(posts, 1);
    await f.remove();
    response.resolve(Response.json({}, { status: 503 }));
    assert.deepEqual(await Promise.all(pending), actions.map(() => false));
    assert.equal(posts, 1, "queued writes use local deletion state established by the failed fallback");
    assert.equal(f.writes(), 0); assert.equal(f.values.has(commentKey), false);
    assert.equal(useComments.getState().draft, draft); assert.equal(useComments.getState().saving, false);
  } finally { response.resolve(Response.json({}, { status: 503 })); f.home.dispose(); }
});

for (const selection of ["draft", "thread", "closed"] as const) test(`a delayed fallback rejection preserves the newer ${selection} selection`, async () => {
  const f = await setup(null); const response = deferred<Response>();
  try {
    useComments.getState().setDraft(draft);
    mock.method(globalThis, "fetch", async () => response.promise);
    const pending = useComments.getState().run(create("new")).then(ok => { if (ok) openPostedComment(draft, "new"); return ok; });
    await Promise.resolve();
    const newer = { ...draft };
    if (selection === "draft") useComments.getState().setDraft(newer);
    else if (selection === "thread") useComments.getState().open("second");
    else useComments.getState().setActive(false);
    await f.remove(); response.resolve(Response.json({}, { status: 503 }));
    assert.equal(await pending, false);
    const state = useComments.getState();
    assert.equal(state.active, selection !== "closed");
    assert.equal(state.draft, selection === "draft" ? newer : null);
    assert.equal(state.openId, selection === "thread" ? "second" : null);
    assert.equal(state.focusedThread?.id ?? null, selection === "thread" ? "second" : null);
  } finally { response.resolve(Response.json({}, { status: 503 })); f.home.dispose(); }
});

for (const store of ["local", null] as const) test(`${store ?? "initial 503"}: reads suppress marked comments but retain the open detail and draft`, async () => {
  const f = await setup(store);
  try {
    useComments.getState().open("existing"); const focus = useComments.getState().focusedThread;
    f.failCleanup(true); await f.remove();
    assert.equal(f.values.get(commentKey), JSON.stringify(initial), "simulate best-effort cleanup failure");
    await useComments.getState().load();
    assert.deepEqual(useComments.getState().threads, []); assert.equal(useComments.getState().focusedThread, focus);
    assert.equal(useComments.getState().threadUnavailable, true); assert.equal(useComments.getState().loading, false);
    useComments.getState().setDraft(draft);
    await useComments.getState().load(); assert.equal(useComments.getState().draft, draft);
    assert.equal(f.writes(), 0);
  } finally { f.home.dispose(); }
});

test("deletion before comment initialization cannot expose residual browser comments", async () => {
  const f = await setup(null);
  try {
    useComments.setState({ threads: [], focusedThread: null, total: 0, unresolvedCount: 0 });
    f.failCleanup(true); await f.remove();
    await useComments.getState().load();
    assert.equal(useComments.getState().store, "local"); assert.deepEqual(useComments.getState().threads, []);
    assert.equal(await useComments.getState().run(create("late")), false); assert.equal(f.writes(), 0);
  } finally { f.home.dispose(); }
});

for (const absentComments of [false, true]) test(`503 fallback without a local site record preserves ${absentComments ? "first-comment" : "existing-comments"} behavior`, async () => {
  const f = await setup(null);
  try {
    f.values.delete(listKey); if (absentComments) f.values.delete(commentKey);
    await useComments.getState().load();
    assert.equal(await useComments.getState().run(create("new")), true);
    assert.equal(JSON.parse(f.values.get(commentKey)!).length, absentComments ? 1 : initial.length + 1);
    assert.equal(f.values.has(markerKey), false, "absence and 503 never imply deletion");
  } finally { f.home.dispose(); }
});

for (const operation of ["load", "write"] as const) test(`a marker read failure during ${operation} is not reported as deletion`, async () => {
  const f = await setup();
  try {
    useComments.getState().open("existing"); f.failMarkerRead(true);
    if (operation === "load") await useComments.getState().load();
    else assert.equal(await useComments.getState().run(create("new")), false);
    assert.deepEqual(useComments.getState().threads, initial);
    assert.equal(useComments.getState().threadUnavailable, false);
    assert.equal(useComments.getState().error, operation === "load" ? "Couldn't load comments" : "Couldn't save the comment");
    assert.equal(f.writes(), 0); assert.equal(f.values.has(markerKey), false);
    f.failMarkerRead(false); assert.equal(await useComments.getState().run(create("retry")), true);
  } finally { f.home.dispose(); }
});

for (const stage of ["read", "write", "write-cleanup-failure"] as const) test(`deletion overlapping the comment ${stage} rejects success and hides the deleted record`, async () => {
  const f = await setup();
  try {
    useComments.getState().setDraft(draft);
    if (stage === "read") f.duringRead(() => f.concurrentDelete());
    else f.duringWrite(() => { f.concurrentDelete(); if (stage === "write-cleanup-failure") f.failCleanup(true); });
    assert.equal(await useComments.getState().run(create("new")), false);
    assert.equal(f.writes(), stage === "read" ? 0 : 1);
    assert.deepEqual(useComments.getState().threads, []); assert.equal(useComments.getState().draft, draft);
    assert.equal(f.values.has(commentKey), stage === "write-cleanup-failure");
    await useComments.getState().load(); assert.deepEqual(useComments.getState().threads, []);
    assert.equal(await useComments.getState().run(create("retry")), false);
  } finally { f.home.dispose(); }
});

test("an unreadable post-write marker fails safely without claiming deletion or erasing potentially valid data", async () => {
  const f = await setup();
  try {
    useComments.getState().setDraft(draft); f.duringWrite(() => f.failMarkerRead(true));
    assert.equal(await useComments.getState().run(create("new")), false);
    assert.equal(f.writes(), 1); assert.equal(f.values.has(commentKey), true);
    assert.deepEqual(useComments.getState().threads, initial); assert.equal(useComments.getState().draft, draft);
    assert.equal(useComments.getState().error, "Couldn't save the comment");
    assert.equal(f.values.has(markerKey), false);
  } finally { f.home.dispose(); }
});

test("successful server reads and writes remain authoritative despite a local deletion marker", async () => {
  const f = await setup("server");
  try {
    await f.remove();
    mock.method(globalThis, "fetch", async () => Response.json({ threads: initial,
      nextCursor: null, total: initial.length, unresolvedCount: initial.filter(thread => !thread.resolvedAt).length,
      focusedThread: null }));
    await useComments.getState().load(); assert.deepEqual(useComments.getState().threads, initial);
    assert.equal(await useComments.getState().run(create("server")), true);
    assert.equal(useComments.getState().store, "server"); assert.equal(f.values.get(markerKey), "1"); assert.equal(f.writes(), 0);
  } finally { f.home.dispose(); }
});

test("independent deletions survive stale list writes and do not block another site's comments", async () => {
  const f = await setup();
  try {
    await f.remove(other.id, other.name);
    assert.equal(await useComments.getState().run(create("new")), true);
    saveLocalSites([source, other]);
    assert.deepEqual(loadLocalSites().map(s => s.id), [source.id]);
    await f.remove();
    saveLocalSites([source, other]); touchLocalSite(10);
    assert.deepEqual(loadLocalSites(), []);
    assert.equal(isLocalSiteDeleted(source.id), true); assert.equal(isLocalSiteDeleted(other.id), true);
    assert.equal(await useComments.getState().run(create("late")), false);
  } finally { f.home.dispose(); }
});

test("new and duplicated sites use fresh IDs without clearing the deleted ID's marker", async () => {
  const f = await setup();
  try {
    await f.remove();
    f.home.create(); await f.home.save({ ...emptyDest(), name: source.name });
    const created = f.home.sites().find(s => s.id !== other.id)!;
    assert.notEqual(created.id, source.id); assert.equal(isLocalSiteDeleted(created.id), false);
    f.home.duplicate(other.id); await f.home.save({ ...emptyDest(), name: source.name });
    const copied = f.home.sites().find(s => s.id !== other.id && s.id !== created.id)!;
    assert.ok(copied); assert.notEqual(copied.id, source.id); assert.equal(isLocalSiteDeleted(copied.id), false);
    f.home.location.pathname = `/sites/${created.id}`;
    assert.equal(await useComments.getState().run(create("fresh")), true);
    assert.equal(f.values.get(markerKey), "1"); assert.equal(f.values.has(commentKey), false);
  } finally { f.home.dispose(); }
});


for (const failure of ["missing-record", "marker-read"] as const) test(`Home rejects ${failure} deletion before committing a marker or cleaning content`, async () => {
  const f = await setup();
  try {
    if (failure === "missing-record") f.values.set(listKey, JSON.stringify([other]));
    else f.failMarkerRead(true);
    const before = [...f.values];
    await f.remove();
    assert.equal(f.home.prompt()?.kind, "alert");
    assert.deepEqual([...f.values], before);
    assert.equal(f.values.has(markerKey), false);
    f.home.answer(); await f.home.flush();
  } finally { f.home.dispose(); }
});
});
