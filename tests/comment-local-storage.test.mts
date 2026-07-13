import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { useComments } from "../lib/comment-store";
import { applyCommentAction, parseCommentAction, MAX_COMMENT_LENGTH, type CommentAction } from "../lib/comments";

const key = "tsumu-comments-v1:local-comments";
const create = (id: string): CommentAction => ({ action: "create", id, pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: id });
const initial = applyCommentAction([], create("existing"), null, 1);
const actions: CommentAction[] = [
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


for (const action of [create("long"), { action: "reply", threadId: "existing", id: "long-reply", body: "" }, { action: "edit", messageId: "existing-0", body: "" }] as CommentAction[]) {
  test(`${action.action} rejects oversize bodies instead of truncating or storing them locally`, async () => {
    const oversized = { ...action, body: "x".repeat(MAX_COMMENT_LENGTH + 1) } as CommentAction;
    assert.equal(parseCommentAction(oversized), null);
    assert.ok(parseCommentAction({ ...action, body: "x".repeat(MAX_COMMENT_LENGTH) }));
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
