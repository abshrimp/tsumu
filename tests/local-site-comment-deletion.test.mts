import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { useComments, openPostedComment } from "../lib/comment-store";
import { applyCommentAction, type CommentAction } from "../lib/comments";
import { deleteLocalSite, emptyDest, isLocalSiteDeleted, loadLocalSites, saveLocalSites, SITE_SCOPED_KEYS, siteKey, touchLocalSite } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteFixture } from "./helpers/home-site-storage";

const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
const other = { ...source, id: "other", name: "Other" };
const listKey = storageKey("sites-v1");
const commentKey = siteKey(storageKey("comments-v1"), source.id);
const markerKey = siteKey(storageKey("site-deleted-v1"), source.id);
const create = (id: string): CommentAction => ({ action: "create", id, pageId: "p", nodeId: null, x: .5, y: .5, bp: "base", body: id });
const initial = applyCommentAction(applyCommentAction([], create("existing"), null, 1), create("second"), null, 2);
const draft = { pageId: "p", nodeId: null, x: .5, y: .5, bp: "base" };
const actions: CommentAction[] = [create("new"),
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
    // 別タブの削除をストレージ呼び出しの間に挟む。確認UIを通る通常経路は remove() で別途検証する。
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
