import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { useComments, openPostedComment, closeCommentIfOpen } from "../lib/comment-store";
import { applyCommentAction, type CommentAction, type CommentThread } from "../lib/comments";

const create = (id: string): CommentAction => ({ action: "create", id, pageId: "page", nodeId: null, x: .5, y: .5, bp: "base", body: id });
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
  const actions: CommentAction[] = []; let reads = 0;
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
  const submitted = useComments.getState().run({ action: "delete-thread", threadId: "one" }).then(ok => { if (ok) closeCommentIfOpen("one"); });
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
