import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { useComments, openPostedComment } from "../lib/comment-store";

// 実際の内部コンポーネントの処理を、状態を再現できるフックで検証する。
// DOMのreadOnlyとReactの実際のマウントは、別途ブラウザテストで確かめる。
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
    isAuthor: () => true, tr: (value: string) => value, getLang: () => "en", relativeTime: () => "now", userLabel: () => "Guest",
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
  // キャンセルした新しいコメントは、次に開いたときに戻さない。
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
  click(); click(); // 再描画前の2回目の操作でも、二重送信しない。
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
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "サイトが見つかりません", code: "comment_site_missing" }, { status: 404 }));
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
  assert.equal(useComments.getState().error, "サイトが見つかりません");
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
  const context: any = { module: { exports: {} }, document: { querySelector: () => null },
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
  } else remove = find(panel.render(), node => node.props?.["aria-label"] === "スレッドを削除").props.onClick;
  const first = remove(), second = remove();
  assert.equal(confirms, 1); panel.unmount(); response.resolve(true); await Promise.all([first, second]);
  assert.deepEqual(actions, []);
});

test("thread deletion is cancelled when the discussion becomes unavailable during confirmation", async () => {
  const h = harness(), response = deferred<boolean>(); const actions: unknown[] = [];
  h.setConfirm(() => response.promise); h.setRun(async action => { actions.push(action); return true; });
  const props = { thread: { id: "thread", messages: [{ id: "one", author: {}, body: "Original", at: 1 }] }, unavailable: false, place: "", notices: null, onClose() {} };
  const panel = h.instance(h.ThreadView, props);
  const work = find(panel.render(), node => node.props?.["aria-label"] === "スレッドを削除").props.onClick();
  props.unavailable = true; panel.render(); response.resolve(true); await work;
  assert.deepEqual(actions, []);
});

test("a cancelled thread deletion releases its lock so a later confirmed deletion succeeds", async () => {
  const h = harness(); const actions: unknown[] = []; let closed = 0;
  h.setConfirm(async () => false); h.setRun(async action => { actions.push(action); return true; });
  const panel = h.instance(h.ThreadView, { thread: { id: "thread", messages: [{ id: "one", author: {}, body: "Original", at: 1 }] }, unavailable: false, place: "", notices: null, onClose() { closed++; } });
  const remove = () => find(panel.render(), node => node.props?.["aria-label"] === "スレッドを削除").props.onClick();
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
  } else remove = find(panel.render(), node => node.props?.["aria-label"] === "スレッドを削除").props.onClick;
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
