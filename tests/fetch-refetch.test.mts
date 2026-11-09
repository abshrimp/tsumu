import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { applyPageScripts, pageScriptsOf, walkSteps } from "../lib/script";
import { mapStep, numberFilters } from "../components/script-editor/step-tree";
import { previewDataVars, type FetchStep } from "../lib/data";
import type { FetchOptions } from "../lib/fetch-request";
import { lookupVar } from "../lib/vars";
import { PAGE_TARGET, type ScriptStep, type SiteDoc } from "../lib/types";
import { makeText, makeBox } from "../lib/presets";
import * as scriptContexts from "../components/script-editor/context";
const { ScriptNodeCtx, ScriptOwnerCtx, LoopCtx } = scriptContexts;
import { fetchRefetchBundle, fetchRefetchDoc } from "./helpers/fetch-refetch";

// 実ソースの FetchBody の入力確定と useRefetch を動かす。DOM の代わりにフックの状態を保持する。
function mount(options: { doc?: SiteDoc; nodeId?: string; roots?: string[]; loops?: any[]; owner?: { scriptId: string; nodeId: string | null } } = {}) {
  useEditor.getState().replaceDoc(options.doc ?? fetchRefetchDoc());
  let nodeId = options.nodeId ?? "";
  let loops = options.loops ?? [];
  let scriptOwner = options.owner;
  const instance = () => ({ slots: [] as any[], pending: [] as (() => void)[] });
  let root = instance();
  const runner = instance();
  let current = root;
  let cursor = 0;
  let selected = "fetch";
  const opened: any[] = [];
  const context = {
    doc: useEditor.getState().doc, pageId: "p", scriptRootIds: options.roots ?? [], readOnly: false, renameVar() {}, openPeek(...args: any[]) { opened.push(args); },
    updateStep(id: string, fn: (step: ScriptStep) => ScriptStep) {
      const scripts = numberFilters(mapStep(pageScriptsOf(useEditor.getState().doc, [], "p"), id, fn));
      useEditor.getState().updateDoc((doc) => applyPageScripts(doc, "p", [], scripts));
    },
  };
  const hooks = {
    ...React, useContext: (ctx: any) => ctx === ScriptNodeCtx ? nodeId : ctx === ScriptOwnerCtx ? scriptOwner : ctx === LoopCtx ? loops : ctx._currentValue === null ? context : ctx._currentValue,
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => any) { return getSnapshot(); },
    useState(initial: any) {
      const index = cursor++;
      const slots = current.slots;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: any) { return current.slots[cursor++] ??= { current: initial }; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = cursor++;
      const owner = current;
      const previous = owner.slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        owner.pending.push(() => {
          previous?.cleanup?.();
          owner.slots[index] = { effect: true, deps, cleanup: effect() };
        });
      }
    },
  };
  const requests: { input: { url: string } & FetchOptions; finish: (response: Response) => void }[] = [];
  const fetch = (_url: string, options: RequestInit) => new Promise<Response>((finish) => {
    requests.push({ input: JSON.parse(String(options.body)), finish });
  });
  const require = createRequire(resolve("components/script-editor/fetch.tsx"));
  const mod = { exports: {} as any };
  const source = transformSync(readFileSync("components/script-editor/fetch.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code;
  const browserDocument = { activeElement: null as { blur(): void } | null };
  new Function("require", "module", "exports", "fetch", "document", source)(
    (id: string) => id === "react" ? hooks : require(id), mod, mod.exports, fetch, browserDocument,
  );
  const step = (id = "fetch") => {
    const doc = useEditor.getState().doc;
    const scripts = nodeId ? doc.nodes[nodeId]?.scripts ?? [] : scriptOwner?.nodeId === null ? doc.pages.p.scripts ?? [] : doc.pages.p.pageScripts ?? [];
    let found: FetchStep | undefined;
    for (const script of scripts) walkSteps(script.steps, (s) => { if (s.id === id && s.kind === "fetch") found = s; });
    return found;
  };
  const renderInstance = (owner: typeof root, draw: () => any) => {
    current = owner; cursor = 0; context.doc = useEditor.getState().doc;
    const view = draw(); owner.pending.splice(0).forEach((effect) => effect()); return view;
  };
  const unmount = (owner: typeof root) => {
    for (const slot of owner.slots) if (slot?.effect) slot.cleanup?.();
  };
  const render = () => renderInstance(root, () => mod.exports.FetchBody({ step: step(selected) }).props.children);
  const hook = () => renderInstance(runner, () => mod.exports.useRefetch(step(selected)));
  const peek = { exports: {} as any };
  const blocksCode = transformSync(readFileSync("components/script-editor/blocks.tsx", "utf8"), {
    loader: "tsx", jsx: "automatic", format: "cjs",
  }).code;
  new Function("require", "module", "exports", blocksCode)(
    (id: string) => id === "react" ? hooks : id === "./fetch" ? mod.exports : require(id), peek, peek.exports,
  );
  return {
    requests, step, render, opened, browserDocument,
    action: () => render()[1],
    currentSample: () => mod.exports.hasCurrentSample(step()),
    values: () => render().find((v: any) => v?.type?.name === "FetchValues")?.props.state,
    compose(active: boolean) {
      const view = renderInstance(root, () => mod.exports.FetchBody({ step: step(selected) }));
      view.props[active ? "onCompositionStartCapture" : "onCompositionEndCapture"]();
    },
    dragRemount() {
      unmount(root);
      const source = step(); const savedScope = { nodeId, loops, scriptOwner };
      context.readOnly = true; nodeId = ""; loops = []; scriptOwner = undefined;
      const ghost = instance(); renderInstance(ghost, () => mod.exports.FetchBody({ step: source })); unmount(ghost);
      context.readOnly = false; ({ nodeId, loops, scriptOwner } = savedScope);
      root = instance(); render();
    },
    result(scope?: any) {
      const owner = instance();
      return () => renderInstance(owner, () => mod.exports.FetchResult({ step: step(),
        scope: scope ?? opened.at(-1)?.[1] ?? { nodeId: "", localNames: [] }, onClose() {} }));
    },
    run: (vars: Record<string, unknown> = {}) => hook().run(step(selected)!.url, step(selected), vars),
    unmount: () => { unmount(root); unmount(runner); },
    openTest(id = "fetch") {
      const owner = instance();
      const draw = () => renderInstance(owner, () => mod.exports.useRefetch(step(id)));
      draw();
      return { run: () => draw().run(), close: () => unmount(owner), status: () => {
        const { busy, error } = draw(); return { busy, error };
      } };
    },
    openPeek() {
      const owner = instance();
      return renderInstance(owner, () => peek.exports.PeekModal({ step: step(), scope: { nodeId: "", localNames: [] }, onClose() {} }));
    },
    cached: () => mod.exports.wholeCache.get(mod.exports.wholeKey(step())),
    select(id: string) { selected = id; },
    commitUrl(url: string) { render()[0].props.parts.url.props.onCommit(url); },
    setOptions(patch: FetchOptions) {
      let view = render();
      const options = () => view.find((v: any) => v?.props?.children?.[1]?.type?.name === "FetchOptionsPanel");
      if (!options()) { view.find((v: any) => v?.props?.["aria-expanded"] !== undefined).props.onClick(); view = render(); }
      options().props.children[1].props.onChange(patch);
    },
    async finish(index: number, sample: unknown, error?: string) {
      requests[index].finish(new Response(JSON.stringify(error ? { error } : { json: sample }), { status: error ? 502 : 200 }));
      await new Promise((done) => setTimeout(done, 0));
    },
    status() { const { busy, error } = hook(); return { busy, error }; },
  };
}

const old = [{ name: "OLD" }];
const latest = [{ name: "LATEST" }];

test("changing the source keeps the newest sample in the document and variable preview", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow"); void mounted.run();
  mounted.commitUrl("https://example.test/latest"); void mounted.run();
  await mounted.finish(1, latest);
  const saved = structuredClone(useEditor.getState().doc);
  const historyLength = useEditor.getState().past.length;
  await mounted.finish(0, old);
  assert.deepEqual(useEditor.getState().doc, saved);
  assert.equal(useEditor.getState().past.length, historyLength);
  assert.equal(mounted.step()!.url, "https://example.test/latest");
  assert.deepEqual(previewDataVars(saved, "p").products, latest);
  useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(previewDataVars(useEditor.getState().doc, "p").products, latest);
});

test("an earlier success or error cannot end the newest loading state", async () => {
  for (const error of [undefined, "古い取得に失敗しました"]) {
    const mounted = mount();
    mounted.commitUrl("https://example.test/slow"); void mounted.run();
    mounted.commitUrl("https://example.test/latest"); void mounted.run();
    await mounted.finish(0, old, error);
    assert.deepEqual(mounted.step()!.preview?.sample, [{ name: "Initial" }]);
    assert.deepEqual(mounted.status(), { busy: true, error: null });
    await mounted.finish(1, latest);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
  }
});

test("late older errors do not replace the latest successful result", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow"); void mounted.run();
  mounted.commitUrl("https://example.test/latest"); void mounted.run();
  await mounted.finish(1, latest);
  await mounted.finish(0, undefined, "古い取得に失敗しました");
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
  assert.deepEqual(mounted.status(), { busy: false, error: null });
});

test("latest failures keep the saved fallback and cannot be overwritten by an older success", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow"); void mounted.run();
  mounted.commitUrl("https://example.test/latest"); void mounted.run();
  await mounted.finish(1, undefined, "新しい取得に失敗しました");
  await mounted.finish(0, old);
  assert.deepEqual(mounted.step()!.preview?.sample, [{ name: "Initial" }]);
  assert.equal(mounted.step()!.preview?.fetchedAt, undefined);
  assert.deepEqual(mounted.status(), { busy: false, error: "新しい取得に失敗しました" });
});

test("requests to the same URL also follow the newest method, headers and JSON body", async () => {
  const mounted = mount();
  mounted.setOptions({ method: "POST" }); void mounted.run();
  mounted.setOptions({ headers: [{ name: "X-Version", value: "new" }] }); void mounted.run();
  mounted.setOptions({ body: '{"version":2}' }); void mounted.run();
  assert.deepEqual(mounted.requests.map((r) => r.input.url), Array(3).fill("https://example.test/initial"));
  await mounted.finish(2, latest);
  await mounted.finish(0, old);
  await mounted.finish(1, old);
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
  assert.equal(mounted.step()!.method, "POST");
  assert.deepEqual(mounted.step()!.headers, [{ name: "X-Version", value: "new" }]);
  assert.equal(mounted.step()!.body, '{"version":2}');
});

test("clearing a source invalidates its pending response and loading state", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow"); void mounted.run();
  mounted.commitUrl(""); void mounted.run();
  assert.deepEqual(mounted.status(), { busy: false, error: null });
  const saved = structuredClone(useEditor.getState().doc);
  await mounted.finish(0, old);
  assert.deepEqual(useEditor.getState().doc, saved);
});

test("Undo rejects pending samples for a different URL or request configuration", async () => {
  for (const change of [
    (mounted: ReturnType<typeof mount>) => mounted.commitUrl("https://example.test/slow"),
    (mounted: ReturnType<typeof mount>) => mounted.setOptions({ method: "POST" }),
    (mounted: ReturnType<typeof mount>) => mounted.setOptions({ headers: [{ name: "X-Version", value: "new" }] }),
    (mounted: ReturnType<typeof mount>) => mounted.setOptions({ body: '{"version":2}' }),
  ]) {
    const mounted = mount();
    change(mounted); void mounted.run();
    useEditor.getState().undo();
    const saved = structuredClone(useEditor.getState().doc);
    const future = structuredClone(useEditor.getState().future);
    await mounted.finish(0, old);
    assert.deepEqual(useEditor.getState().doc, saved);
    assert.deepEqual(useEditor.getState().future, future);
  }
});

test("Undo and external source changes hide late errors from the abandoned request", async () => {
  for (const change of [
    () => useEditor.getState().undo(),
    () => useEditor.getState().updateDoc((doc) => {
      const step = doc.pages.p.pageScripts![0].steps[0] as FetchStep;
      step.headers = [{ name: "X-Version", value: "external" }];
    }),
  ]) {
    for (const renderBeforeResponse of [true, false]) {
      const mounted = mount();
      mounted.commitUrl("https://example.test/slow"); void mounted.run();
      change();
      // React の再描画より先に応答が返る場合も、旧設定の状態を表示しない。
      if (renderBeforeResponse) assert.deepEqual(mounted.status(), { busy: false, error: null });
      const saved = structuredClone(useEditor.getState().doc);
      const future = structuredClone(useEditor.getState().future);
      await mounted.finish(0, undefined, "旧設定の取得に失敗しました");
      assert.deepEqual(mounted.status(), { busy: false, error: null });
      assert.deepEqual(useEditor.getState().doc, saved);
      assert.deepEqual(useEditor.getState().future, future);
    }
  }
});

test("Undo also hides an already displayed error without starting another request", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/failed"); void mounted.run();
  await mounted.finish(0, undefined, "現在の取得に失敗しました");
  assert.deepEqual(mounted.status(), { busy: false, error: "現在の取得に失敗しました" });
  useEditor.getState().undo();
  assert.deepEqual(mounted.status(), { busy: false, error: null });
  assert.equal(mounted.requests.length, 1);
});

test("a removed block is not recreated and another selected block is not overwritten", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow"); void mounted.run();
  mounted.select("other");
  mounted.render();
  useEditor.getState().updateDoc((doc) => { doc.pages.p.pageScripts![0].steps = doc.pages.p.pageScripts![0].steps.filter((s) => s.id !== "fetch"); });
  const saved = structuredClone(useEditor.getState().doc);
  await mounted.finish(0, old);
  assert.deepEqual(useEditor.getState().doc, saved);
  assert.equal(mounted.step(), undefined);
  assert.deepEqual(mounted.step("other")!.preview?.sample, [{ name: "Other" }]);
});

test("a valid response follows a reordered block and preserves unrelated edits", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/latest"); void mounted.run();
  useEditor.getState().updateDoc((doc) => {
    doc.pages.p.pageScripts![0].steps.reverse();
    const fetched = doc.pages.p.pageScripts![0].steps[1] as FetchStep;
    fetched.as = "renamed";
    doc.pages.p.title = "Edited while fetching";
  });
  await mounted.finish(0, latest);
  assert.deepEqual(useEditor.getState().doc.pages.p.pageScripts![0].steps.map((s) => s.id), ["other", "fetch"]);
  assert.equal(mounted.step()!.as, "renamed");
  assert.equal(useEditor.getState().doc.pages.p.title, "Edited while fetching");
  assert.deepEqual(previewDataVars(useEditor.getState().doc, "p").renamed, latest);
});

test("settings changes and viewing a saved GET or DELETE sample do not send requests", () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/edited");
  mounted.setOptions({ method: "DELETE" });
  mounted.setOptions({ headers: [{ name: "X-Confirm", value: "yes" }] });
  mounted.openPeek(); mounted.openPeek();
  assert.equal(mounted.requests.length, 0);
  assert.deepEqual(mounted.step()!.preview?.sample, [{ name: "Initial" }]);
  useEditor.getState().undo(); useEditor.getState().redo();
  assert.equal(mounted.requests.length, 0);
});

test("one explicit execution caches the full response and viewing it never resends a write", async () => {
  const mounted = mount(); mounted.setOptions({ method: "POST" });
  const all = Array.from({ length: 23 }, (_, i) => ({ name: String(i) }));
  void mounted.run(); await mounted.finish(0, all);
  assert.deepEqual(mounted.step()!.preview?.sample, all.slice(0, 20));
  assert.deepEqual(mounted.cached(), all);
  mounted.openPeek(); mounted.openPeek();
  assert.equal(mounted.requests.length, 1);
});

test("repeated clicks and reopening a pending test cannot duplicate a request", async () => {
  const mounted = mount(); mounted.setOptions({ method: "DELETE" });
  const first = mounted.openTest(); void first.run(); void first.run();
  assert.equal(mounted.requests.length, 1);
  first.close();
  const second = mounted.openTest();
  assert.equal(second.status().busy, true);
  void second.run(); assert.equal(mounted.requests.length, 1);
  await mounted.finish(0, old);
  assert.deepEqual(mounted.step()!.preview?.sample, old, "closing a view does not discard a document-owned request");
  assert.equal(second.status().busy, false);
  void second.run(); await mounted.finish(1, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
});

test("a closed test and its error cannot change a different setting's latest test", async () => {
  for (const error of [undefined, "閉じたテストの取得に失敗しました"]) {
    const mounted = mount();
    const first = mounted.openTest(); void first.run(); first.close();
    mounted.commitUrl("https://example.test/new");
    const second = mounted.openTest(); void second.run();
    await mounted.finish(0, old, error);
    assert.deepEqual(second.status(), { busy: true, error: null });
    await mounted.finish(1, latest);
    assert.deepEqual(second.status(), { busy: false, error: null });
    assert.deepEqual(mounted.step()!.preview?.sample, latest);
  }
});

test("pending state is independent for different blocks and identical writes retry only after settlement", async () => {
  const mounted = mount();
  const first = mounted.openTest(); void first.run();
  const other = mounted.openTest("other"); void other.run();
  await mounted.finish(1, latest); assert.equal(first.status().busy, true);
  await mounted.finish(0, old); assert.equal(first.status().busy, false);
  void first.run(); await mounted.finish(2, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
  assert.deepEqual(mounted.step("other")!.preview?.sample, latest);
});

test("unresolved URL values fail without sending; explicit temporary values are encoded without saving", async () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/[slug]/{q}");
  await mounted.run(); assert.equal(mounted.requests.length, 0);
  assert.equal(mounted.status().error, "テスト用の値を入力してください");
  void mounted.run({ slug: "001", q: "a b" });
  assert.equal(mounted.requests[0].input.url, "https://example.test/001/a%20b");
  await mounted.finish(0, latest);
  assert.equal(mounted.step()!.url, "https://example.test/[slug]/{q}");
  assert.equal(JSON.stringify(mounted.step()).includes("a b"), false);
});

test("explicit tests preserve raw JSON body types and saved templates", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/{code}");
  mounted.setOptions({ method: "POST", headers: [{ name: "X-Flag", value: "{flag}" }],
    body: '{"data":{data},"nil":{nil},"code":"{code}","flag":{flag}}' });
  const config = structuredClone(mounted.step());
  void mounted.run({ data: [1, { text: "A" }], nil: null, code: "001", flag: false });
  assert.deepEqual(mounted.requests[0].input, {
    url: "https://example.test/001", method: "POST", headers: { "X-Flag": "false", "Content-Type": "application/json" },
    body: '{"data":[1,{"text":"A"}],"nil":null,"code":"001","flag":false}',
  });
  await mounted.finish(0, latest);
  for (const field of ["url", "method", "headers", "body"] as const) assert.deepEqual(mounted.step()![field], config![field]);
});

test("null, empty, boolean and numeric samples keep their type on fetch, viewing and save/load", async () => {
  for (const sample of [null, "", false, 0, []]) {
    const mounted = mount(); void mounted.run(); await mounted.finish(0, sample);
    assert.deepEqual(mounted.step()!.preview?.sample, sample);
    assert.deepEqual(mounted.cached(), sample);
    mounted.openPeek(); assert.equal(mounted.requests.length, 1);
    useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)));
    assert.deepEqual(mounted.step()!.preview?.sample, sample);
  }
});

test("the browser regression fixture bundles the real script editor", async () => {
  const bundle = await fetchRefetchBundle();
  assert.match(bundle, /function ScriptEditorInner/);
  assert.match(bundle, /function FetchBody/);
});


test("one block action executes immediately, opens the result, then becomes view-only", async () => {
  const mounted = mount();
  assert.equal(mounted.action().props.children[1], "データを見る");
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 0);
  mounted.commitUrl("https://example.test/new");
  assert.equal(mounted.action().props.children[1], "データ取得");
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 1, "no confirmation step before sending");
  assert.equal(mounted.opened.length, 2);
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 1, "reopening a pending result does not send");
  await mounted.finish(0, latest);
  assert.equal(mounted.action().props.children[1], "データを見る");
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 1);
  const result = mounted.result();
  const refresh = () => result().props.children[0].props.children[1];
  assert.equal(mounted.requests.length, 1, "rendering the result is read-only");
  refresh().props.onClick(); refresh().props.onClick();
  assert.equal(mounted.requests.length, 2, "upper-right refresh sends directly, only once");
  await mounted.finish(1, old);
  assert.deepEqual(mounted.step()!.preview?.sample, old);
});

test("settings invalidate only the current-result marker across save/load and Undo", () => {
  const mounted = mount();
  mounted.setOptions({ method: "POST", body: '{"version":2}' });
  assert.equal(mounted.currentSample(), false);
  assert.deepEqual(mounted.step()!.preview?.sample, [{ name: "Initial" }]);
  assert.equal(mounted.step()!.preview?.fetchedAt, undefined);
  useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)));
  assert.equal(mounted.currentSample(), false);
  assert.equal(mounted.action().props.children[1], "データ取得");
  assert.equal(mounted.requests.length, 0);
  const original = mount(); original.commitUrl("https://example.test/changed");
  useEditor.getState().undo();
  assert.equal(original.currentSample(), true);
  original.commitUrl("https://example.test/initial");
  assert.equal(original.currentSample(), true, "unchanged settings do not invalidate");
});

test("samples without a valid success timestamp remain fallback data, not a confirmed current result", () => {
  for (const fetchedAt of [undefined, 0, -1, NaN]) {
    const mounted = mount();
    useEditor.getState().updateDoc((doc) => { (doc.pages.p.pageScripts![0].steps[0] as FetchStep).preview!.preview?.fetchedAt = fetchedAt; });
    assert.equal(mounted.currentSample(), false);
    assert.equal(mounted.action().props.children[1], "データ取得");
    assert.deepEqual(mounted.step()!.preview?.sample, [{ name: "Initial" }]);
  }
});

test("inline runtime inputs enable the one send action and reach the result without saving", async () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/{missing}");
  assert.equal(mounted.action().props.disabled, true);
  mounted.values().setValue("missing", "001");
  assert.equal(mounted.action().props.disabled, false);
  mounted.action().props.onClick();
  assert.equal(mounted.requests[0].input.url, "https://example.test/001");
  const view = mounted.result()();
  assert.equal(view.props.children[1].props.children[1].props.children, "https://example.test/001");
  await mounted.finish(0, latest);
  // 取得時刻の数字に偶然 "001" が含まれても、テスト値の保存とは判定しない。
  const { fetchedAt, ...saved } = mounted.step()!.preview!;
  assert.equal(typeof fetchedAt, "number");
  assert.equal(JSON.stringify(saved).includes("001"), false);
});

test("a failed direct request retains fallback, shares the modal error, and can be retried", async () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/failure");
  mounted.action().props.onClick();
  await mounted.finish(0, undefined, "失敗しました");
  const result = mounted.result();
  assert.equal(result().props.children.find((v: any) => v?.props?.role === "alert").props.children, "失敗しました");
  assert.equal(mounted.currentSample(), false);
  assert.equal(mounted.action().props.children[1], "データを見る");
  mounted.action().props.onClick(); assert.equal(mounted.requests.length, 1, "viewing a failed result never retries");
  result().props.children[0].props.children[1].props.onClick(); await mounted.finish(1, latest);
  assert.equal(mounted.currentSample(), true);
});

test("an action during IME composition never submits an uncommitted request", () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/new");
  mounted.compose(true);
  let prevented = false;
  mounted.action().props.onPointerDown({ preventDefault() { prevented = true; } });
  mounted.compose(false);
  mounted.action().props.onClick();
  assert.equal(prevented, true);
  assert.equal(mounted.requests.length, 0);
  assert.equal(mounted.opened.length, 0);
});


test("result refresh also refuses a partially composed test value", () => {
  const mounted = mount(); const result = mounted.result();
  result().props.onCompositionStartCapture();
  let prevented = false;
  result().props.children[0].props.children[1].props.onPointerDown({ preventDefault() { prevented = true; } });
  result().props.onCompositionEndCapture();
  result().props.children[0].props.children[1].props.onClick();
  assert.equal(prevented, true);
  assert.equal(mounted.requests.length, 0);
});


test("visual drag unmounts never abandon a transmitted POST or silently turn viewing into resending", async () => {
  for (const error of [undefined, "POSTの取得に失敗しました"]) {
    const mounted = mount(); mounted.setOptions({ method: "POST" });
    mounted.action().props.onClick(); assert.equal(mounted.requests.length, 1);
    mounted.dragRemount(); assert.equal(mounted.action().props.children[1], "送信中…");
    await mounted.finish(0, latest, error);
    assert.deepEqual(mounted.step()!.preview?.sample, error ? [{ name: "Initial" }] : latest);
    assert.equal(mounted.action().props.children[1], "データを見る");
    mounted.action().props.onClick(); assert.equal(mounted.requests.length, 1);
    if (error) assert.equal(mounted.result()().props.children.find((v: any) => v?.props?.role === "alert").props.children, error);
  }
});

test("identical page and step IDs in a replacement document cannot inherit pending writes, errors, or attempts", async () => {
  for (const error of [undefined, "old document failed"]) {
    const mounted = mount(); mounted.setOptions({ method: "POST" }); mounted.action().props.onClick();
    const other = structuredClone(useEditor.getState().doc); other.siteName = "Different document";
    useEditor.getState().replaceDoc(other);
    assert.equal(mounted.status().busy, false);
    assert.equal(mounted.action().props.children[1], "データ取得");
    await mounted.finish(0, latest, error);
    assert.deepEqual(useEditor.getState().doc, other);
    assert.equal(mounted.status().error, null);
    assert.equal(mounted.action().props.children[1], "データ取得");
  }
});

test("restoring a backup with identical request IDs isolates late success, errors and attempts", async () => {
  for (const error of [undefined, "old document failed"]) {
    const mounted = mount(); mounted.setOptions({ method: "POST" });
    mounted.action().props.onClick();
    const restored = structuredClone(useEditor.getState().doc);
    (restored.pages.p.pageScripts![0].steps[0] as FetchStep).preview!.preview?.sample = [{ name: "Backup" }];
    const session = useEditor.getState().documentSession;
    useEditor.getState().restoreDoc(restored);
    assert.equal(useEditor.getState().documentSession, session + 1);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
    assert.equal(mounted.action().props.children[1], "データ取得");
    const past = structuredClone(useEditor.getState().past);
    await mounted.finish(0, latest, error);
    assert.deepEqual(useEditor.getState().doc, restored);
    assert.deepEqual(useEditor.getState().past, past);
    assert.equal(mounted.cached(), undefined);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
    assert.equal(mounted.action().props.children[1], "データ取得");
    mounted.action().props.onClick();
    assert.equal(mounted.requests.length, 2, "the restored document can explicitly send the same request");
    await mounted.finish(1, latest);
    assert.deepEqual(mounted.step()!.preview?.sample, latest);
  }
});

test("restore clears completed attempts, errors and temporary inputs without changing the request", async () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/{missing}");
  mounted.values().setValue("missing", "Before restore");
  mounted.action().props.onClick(); await mounted.finish(0, undefined, "古い取得に失敗しました");
  assert.equal(mounted.status().error, "古い取得に失敗しました");
  const restored = structuredClone(useEditor.getState().doc); restored.siteName = "Backup";
  useEditor.getState().restoreDoc(restored);
  assert.deepEqual(mounted.values().values, {});
  assert.deepEqual(mounted.status(), { busy: false, error: null });
  assert.equal(mounted.action().props.children[1], "データ取得");
  assert.equal(mounted.action().props.disabled, true);
  assert.equal(mounted.requests.length, 1, "restore and viewing never send automatically");
});

test("Undo and Redo preserve restore history without reviving a pre-restore response or temporary inputs", async () => {
  for (const error of [undefined, "old document failed"]) {
    const mounted = mount();
    const original = structuredClone(useEditor.getState().doc);
    mounted.commitUrl("https://example.test/{missing}");
    const before = structuredClone(useEditor.getState().doc);
    mounted.values().setValue("missing", "Before restore"); mounted.action().props.onClick();
    const restored = structuredClone(before);
    (restored.pages.p.pageScripts![0].steps[0] as FetchStep).preview!.preview?.sample = [{ name: "Backup" }];
    useEditor.getState().restoreDoc(restored);
    const session = useEditor.getState().documentSession;
    useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, before);
    assert.equal(useEditor.getState().documentSession, session, "session identity is not part of undo history");
    assert.deepEqual(mounted.values().values, {});
    const past = structuredClone(useEditor.getState().past);
    const future = structuredClone(useEditor.getState().future);
    await mounted.finish(0, latest, error);
    assert.deepEqual(useEditor.getState().doc, before);
    assert.deepEqual(useEditor.getState().past, past);
    assert.deepEqual(useEditor.getState().future, future);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
    useEditor.getState().redo(); assert.deepEqual(useEditor.getState().doc, restored);
    useEditor.getState().undo(); useEditor.getState().undo();
    assert.deepEqual(useEditor.getState().doc, original, "edits before restore remain undoable");
    useEditor.getState().redo(); useEditor.getState().redo();
    assert.deepEqual(useEditor.getState().doc, restored);
  }
});

test("an identical no-op restore preserves the session and a valid pending response", async () => {
  const mounted = mount(); void mounted.run();
  const before = useEditor.getState();
  useEditor.getState().restoreDoc(structuredClone(before.doc));
  assert.equal(useEditor.getState(), before);
  await mounted.finish(0, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
});

test("deleting and undo-restoring a pending block rejects its late result but retains the fact it was sent", async () => {
  const mounted = mount(); mounted.setOptions({ method: "POST" }); mounted.action().props.onClick();
  useEditor.getState().updateDoc((doc) => { doc.pages.p.pageScripts![0].steps.shift(); });
  useEditor.getState().undo(); const saved = structuredClone(useEditor.getState().doc);
  await mounted.finish(0, latest);
  assert.deepEqual(useEditor.getState().doc, saved);
  assert.equal(mounted.action().props.children[1], "データを見る");
  mounted.action().props.onClick(); assert.equal(mounted.requests.length, 1);
  assert.match(mounted.status().error!, /送信済み/);
});

test("modal runtime edits and result provenance persist across closing, reopening and block remount", async () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/{missing}");
  mounted.values().setValue("missing", "A"); mounted.action().props.onClick(); await mounted.finish(0, { result: "A" });
  const first = mounted.result();
  const state = (view: any) => view.props.children.find((v: any) => v?.type?.name === "FetchValues").props.state;
  state(first()).setValue("missing", "B");
  assert.equal(first().props.children[1].props.children[1].props.children, "https://example.test/B");
  const oldResult = first().props.children.at(-1).props.children[0];
  first().props.children[0].props.children[1].props.onClick();
  assert.equal(mounted.requests[1].input.url, "https://example.test/B"); await mounted.finish(1, { result: "B" });
  mounted.action().props.onClick();
  const reopened = mounted.result();
  assert.equal(state(reopened()).values.missing, "B");
  assert.ok(/"https:\/\/example\.test\/A"/.test(JSON.stringify(oldResult)), "old result provenance does not follow the unsent draft");
  assert.equal(reopened().props.children[1].props.children[1].props.children, "https://example.test/B");
  assert.equal(reopened().props.children.at(-1).props.children[0], false, "the same destination is not repeated");
  assert.deepEqual(mounted.step()!.preview?.sample, { result: "B" });
  mounted.dragRemount(); mounted.action().props.onClick();
  const afterDrag = mounted.result(); assert.equal(state(afterDrag()).values.missing, "B");
  afterDrag().props.children[0].props.children[1].props.onClick();
  assert.equal(mounted.requests[2].input.url, "https://example.test/B"); await mounted.finish(2, { result: "B" });
  assert.equal(JSON.stringify(mounted.step()).includes('"missing":"B"'), false);
});

test("temporary values clear for request, scope and document changes", () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/{missing}");
  mounted.values().setValue("missing", "A");
  mounted.setOptions({ method: "POST" }); assert.deepEqual(mounted.values().values, {});
  mounted.values().setValue("missing", "B");
  const scoped = mounted.result({ nodeId: "", localNames: ["missing"] });
  const state = scoped().props.children.find((v: any) => v?.type?.name === "FetchValues").props.state;
  assert.deepEqual(state.values, {});
  useEditor.getState().replaceDoc(structuredClone(useEditor.getState().doc));
  assert.deepEqual(mounted.values().values, {});
});


function nodeFetchDoc(): SiteDoc {
  const doc = fetchRefetchDoc();
  const fetch = doc.pages.p.pageScripts![0].steps.shift()!;
  doc.nodes.act = { ...makeText("Act"), id: "act", scripts: [{ id: "node-script", trigger: "click", pos: { x: 32, y: 32 }, steps: [fetch] }] };
  doc.pages.p.children = ["act"];
  return doc;
}

test("real duplicatePage cannot redirect a node fetch response into the copied page's identical step ID", async () => {
  const mounted = mount({ doc: nodeFetchDoc(), nodeId: "act", owner: { nodeId: "act", scriptId: "node-script" } });
  useEditor.getState().duplicatePage("p");
  const copiedPage = useEditor.getState().activePageId;
  const copiedNode = useEditor.getState().doc.pages[copiedPage].children[0];
  const originalCopy = structuredClone(useEditor.getState().doc.nodes[copiedNode]);
  assert.equal(originalCopy.scripts![0].steps[0].id, "fetch");
  void mounted.run(); await mounted.finish(0, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
  assert.deepEqual(useEditor.getState().doc.nodes[copiedNode], originalCopy);
});

test("same-page duplicateNode keeps response writes and caches on the actual authoring node", async () => {
  const mounted = mount({ doc: nodeFetchDoc(), nodeId: "act", owner: { nodeId: "act", scriptId: "node-script" } });
  useEditor.getState().duplicateNode("act");
  const copyId = useEditor.getState().selection!;
  const copy = structuredClone(useEditor.getState().doc.nodes[copyId]);
  void mounted.run(); await mounted.finish(0, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest);
  assert.deepEqual(useEditor.getState().doc.nodes[copyId], copy);
});

test("an explicit component root is writable, but an unrelated off-page node is not", async () => {
  const doc = nodeFetchDoc(); doc.pages.p.children = [];
  doc.nodes.component = { ...makeBox(), id: "component", children: ["act"] };
  doc.components = { c: { id: "c", name: "Component", rootId: "component" } };
  const mounted = mount({ doc, nodeId: "act", roots: ["component"], owner: { nodeId: "act", scriptId: "node-script" } });
  void mounted.run(); await mounted.finish(0, latest); assert.deepEqual(mounted.step()!.preview?.sample, latest);
  const outside = mount({ doc, nodeId: "act", owner: { nodeId: "act", scriptId: "node-script" } });
  void outside.run(); assert.equal(outside.requests.length, 0);
});

test("refresh resolves the latest upstream sample while preserving the old result's actual destination", async () => {
  const mounted = mount(); mounted.commitUrl("https://example.test/{other.0.name}");
  mounted.action().props.onClick(); await mounted.finish(0, { answer: "first" });
  useEditor.getState().updateDoc((doc) => { (doc.pages.p.pageScripts![0].steps[1] as FetchStep).preview!.preview?.sample = [{ name: "LATEST" }]; });
  mounted.action().props.onClick(); const result = mounted.result();
  assert.equal(result().props.children[1].props.children[1].props.children, "https://example.test/LATEST");
  assert.ok(/"https:\/\/example\.test\/Other"/.test(JSON.stringify(result().props.children.at(-1).props.children[0])));
  result().props.children[0].props.children[1].props.onClick();
  assert.equal(mounted.requests[1].input.url, "https://example.test/LATEST"); await mounted.finish(1, { answer: "latest" });
});

for (const target of ["url", "body"] as const) {
  for (const value of target === "url" ? ["LATEST", false, 0] : ["LATEST", null, false, 0]) {
    test(`resolved ${target} input ${JSON.stringify(value)} replaces its previously missing temporary value`, async () => {
      const mounted = mount();
      const name = "other.0.newfield";
      mounted.commitUrl(target === "url" ? `https://example.test/{${name}}` : "https://example.test/body");
      if (target === "body") mounted.setOptions({ method: "POST", body: `{"value":{${name}}}` });
      mounted.values().setValue(name, "TEMP");
      mounted.action().props.onClick(); await mounted.finish(0, { answer: "temporary" });
      assert.equal(target === "url" ? mounted.requests[0].input.url : JSON.parse(mounted.requests[0].input.body!).value,
        target === "url" ? "https://example.test/TEMP" : "TEMP");
      useEditor.getState().updateDoc((doc) => {
        (doc.pages.p.pageScripts![0].steps[1] as FetchStep).preview!.preview?.sample = [{ name: "Other", newfield: value }];
      });
      mounted.action().props.onClick(); const result = mounted.result();
      const state = result().props.children.find((v: any) => v?.type?.name === "FetchValues").props.state;
      assert.deepEqual(state.inputs, [{ name, value, missing: false }]);
      assert.equal(lookupVar(state.vars, name), value, "hidden temporary input must not override current data");
      assert.equal(mounted.requests.length, 1, "upstream changes and reopening do not send");
      if (target === "url") assert.equal(result().props.children[1].props.children[1].props.children, `https://example.test/${value}`);
      result().props.children[0].props.children[1].props.onClick();
      assert.equal(target === "url" ? mounted.requests[1].input.url : JSON.parse(mounted.requests[1].input.body!).value,
        target === "url" ? `https://example.test/${value}` : value);
      await mounted.finish(1, { answer: "current" });
    });
  }
}

test("a read-only standalone drag ghost cannot erase the real loop's temporary runtime inputs", () => {
  const doc = fetchRefetchDoc(); (doc.pages.p.pageScripts![0].steps[0] as FetchStep).url = "https://example.test/{local}";
  delete (doc.pages.p.pageScripts![0].steps[0] as FetchStep).preview?.fetchedAt;
  const mounted = mount({ doc, loops: [{ array: "rows", fields: ["local"], samples: {} }] });
  mounted.values().setValue("local", "LOCAL"); mounted.dragRemount();
  assert.equal(mounted.values().values.local, "LOCAL");
  assert.equal(mounted.action().props.disabled, false);
});


test("same-page nodes with copied identical script and step IDs remain separate request owners", async () => {
  const mounted = mount({ doc: nodeFetchDoc(), nodeId: "act", owner: { nodeId: "act", scriptId: "node-script" } });
  useEditor.getState().duplicatePage("p");
  const copiedPage = useEditor.getState().activePageId;
  const copiedNode = useEditor.getState().doc.pages[copiedPage].children[0];
  useEditor.getState().updateDoc((doc) => { doc.pages[copiedPage].children = []; doc.pages.p.children.push(copiedNode); });
  const copy = structuredClone(useEditor.getState().doc.nodes[copiedNode]);
  assert.equal(copy.scripts![0].id, "node-script"); assert.equal(copy.scripts![0].steps[0].id, "fetch");
  void mounted.run(); await mounted.finish(0, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest); assert.deepEqual(useEditor.getState().doc.nodes[copiedNode], copy);
});

test("page-load and unconnected page scripts with identical step IDs are distinct owners", async () => {
  for (const nodeId of [PAGE_TARGET, null]) {
    const doc = fetchRefetchDoc();
    const loose = structuredClone(doc.pages.p.pageScripts![0]); loose.id = "loose";
    (loose.steps[0] as FetchStep).preview!.preview?.sample = [{ name: "Loose" }]; doc.pages.p.scripts = [loose];
    const mounted = mount({ doc, owner: { nodeId, scriptId: nodeId === null ? "loose" : "script" } });
    void mounted.run(); await mounted.finish(0, latest);
    const actual = useEditor.getState().doc.pages.p;
    assert.deepEqual((actual.pageScripts![0].steps[0] as FetchStep).preview?.sample, nodeId === null ? [{ name: "Initial" }] : latest);
    assert.deepEqual((actual.scripts![0].steps[0] as FetchStep).preview?.sample, nodeId === null ? latest : [{ name: "Loose" }]);
  }
});


test("view pointer activation commits a draft on click without becoming a send or losing the viewer", async () => {
  for (const field of ["url", "body"] as const) {
    const mounted = mount();
    mounted.setOptions({ method: "POST", body: '{"name":"{missing}"}' });
    mounted.values().setValue("missing", ""); mounted.action().props.onClick();
    await mounted.finish(0, { ok: true });
    let blurs = 0;
    mounted.browserDocument.activeElement = { blur() {
      blurs++;
      if (field === "url") mounted.commitUrl("https://example.test/draft");
      else mounted.setOptions({ body: '{"name":"NEW"}' });
    } };
    const view = mounted.action(); let prevented = false;
    view.props.onPointerDown({ button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, "prevent premature blur from disabling or changing the clicked action");
    assert.equal(blurs, 0); assert.equal(mounted.requests.length, 1);
    const opened = mounted.opened.length; view.props.onClick();
    assert.equal(blurs, 1); assert.equal(mounted.opened.length, opened + 1);
    assert.equal(mounted.requests.length, 1, "a view click must never send the newly committed draft");
    assert.equal(mounted.step()![field], field === "url" ? "https://example.test/draft" : '{"name":"NEW"}');
    const result = mounted.result();
    const refresh = () => result().props.children[0].props.children[1];
    if (field === "url") {
      assert.equal(refresh().props.disabled, true);
      const state = result().props.children.find((v: any) => v?.type?.name === "FetchValues").props.state;
      state.setValue("missing", "");
    }
    assert.equal(refresh().props.disabled, false); refresh().props.onClick();
    assert.equal(mounted.requests.length, 2);
    assert.equal(mounted.requests[1].input[field], field === "url" ? "https://example.test/draft" : '{"name":"NEW"}');
    await mounted.finish(1, { ok: true });
  }
});
