import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { useComments } from "../lib/comment-store";
import { applyCommentAction, type CommentAction, type CommentThread } from "../lib/comments";

const create = (id: string): CommentAction => ({ action: "create", id, pageId: "page", nodeId: null, x: .5, y: .5, bp: "base", body: id });
const threads = (...ids: string[]) => ids.reduce((all, id, i) => applyCommentAction(all, create(id), null, i + 1), [] as CommentThread[]);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function reset() { useComments.setState({ active: false, store: "server", threads: [], loading: false, error: null, openId: null, draft: null }); }
afterEach(() => mock.reset());

test("a poll started before a successful post cannot remove the acknowledged thread", async () => {
  reset();
  const old = deferred<Response>();
  mock.method(globalThis, "fetch", async (_url, init) => init?.method ? Response.json({ threads: threads("new") }) : old.promise);
  const pending = useComments.getState().load();
  assert.equal(await useComments.getState().run(create("new")), true);
  useComments.getState().open("new");
  old.resolve(Response.json({ threads: [] }));
  await pending;
  assert.deepEqual(useComments.getState().threads.map((t) => t.id), ["new"]);
  assert.equal(useComments.getState().openId, "new");
  assert.equal(useComments.getState().loading, false);
});

test("an old failed or local-fallback read cannot replace a successful server post", async () => {
  for (const status of [500, 503]) {
    reset();
    const old = deferred<Response>();
    mock.method(globalThis, "fetch", async (_url, init) => init?.method ? Response.json({ threads: threads("new") }) : old.promise);
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
  old.resolve(Response.json({ threads: threads("old") })); await first;
  assert.equal(useComments.getState().loading, true);
  current.resolve(Response.json({ threads: threads("current") })); await second;
  assert.equal(useComments.getState().threads[0]?.id, "current");
  assert.equal(useComments.getState().loading, false);
});

test("writes are serialized and a poll during them cannot restore an intermediate snapshot", async () => {
  reset();
  const responses = [deferred<Response>(), deferred<Response>()];
  const actions: CommentAction[] = []; let reads = 0;
  mock.method(globalThis, "fetch", async (_url, init) => {
    if (!init?.method) { reads++; return Response.json({ threads: [] }); }
    const index = actions.length; actions.push(JSON.parse(String(init.body)));
    return responses[index].promise;
  });
  const first = useComments.getState().run(create("first"));
  const second = useComments.getState().run(create("second"));
  await Promise.resolve();
  assert.equal(actions.length, 1);
  await useComments.getState().load();
  assert.equal(reads, 0);
  responses[0].resolve(Response.json({ threads: threads("first") }));
  await first;
  await Promise.resolve();
  assert.equal(actions.length, 2);
  responses[1].resolve(Response.json({ threads: threads("first", "second") }));
  assert.equal(await second, true);
  assert.deepEqual(useComments.getState().threads.map((t) => t.id), ["first", "second"]);
});

test("a failed write releases the queue and keeps the failure until a current request succeeds", async () => {
  reset();
  let writes = 0;
  const old = deferred<Response>();
  mock.method(globalThis, "fetch", async (_url, init) => !init?.method ? old.promise : ++writes === 1
    ? Response.json({ error: "Save failed" }, { status: 500 }) : Response.json({ threads: threads("second") }));
  const poll = useComments.getState().load();
  assert.equal(await useComments.getState().run(create("first")), false);
  const error = useComments.getState().error;
  assert.ok(error);
  old.resolve(Response.json({ threads: [] })); await poll;
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
