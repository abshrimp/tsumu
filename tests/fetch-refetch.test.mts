import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";
import { applyPageScripts, pageScriptsOf } from "../lib/script";
import { mapStep, numberFilters } from "../components/script-editor/step-tree";
import { previewDataVars, type FetchStep } from "../lib/data";
import type { FetchOptions } from "../lib/fetch-request";
import type { ScriptStep } from "../lib/types";
import { fetchRefetchBundle, fetchRefetchDoc } from "./helpers/fetch-refetch";

// 実ソースの FetchBody の入力確定と useRefetch を動かす。DOM の代わりにフックの状態を保持する。
function mount() {
  useEditor.getState().replaceDoc(fetchRefetchDoc());
  const instance = () => ({ slots: [] as any[], pending: [] as (() => void)[] });
  const root = instance();
  const runner = instance();
  let current = root;
  let cursor = 0;
  let selected = "fetch";
  const context = {
    doc: useEditor.getState().doc, pageId: "p", renameVar() {}, openPeek() {},
    updateStep(id: string, fn: (step: ScriptStep) => ScriptStep) {
      const scripts = numberFilters(mapStep(pageScriptsOf(useEditor.getState().doc, [], "p"), id, fn));
      useEditor.getState().updateDoc((doc) => applyPageScripts(doc, "p", [], scripts));
    },
  };
  const hooks = {
    ...React, useContext: (ctx: any) => ctx._currentValue === null ? context : ctx._currentValue,
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
  new Function("require", "module", "exports", "fetch", source)(
    (id: string) => id === "react" ? hooks : require(id), mod, mod.exports, fetch,
  );
  const step = (id = "fetch") => useEditor.getState().doc.pages.p.pageScripts?.[0].steps.find((s) => s.id === id) as FetchStep | undefined;
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
    requests, step, render,
    run: (vars: Record<string, unknown> = {}) => hook().run(step(selected)!.url, step(selected), vars),
    unmount: () => { unmount(root); unmount(runner); },
    openTest(id = "fetch") {
      const owner = instance();
      const draw = () => renderInstance(owner, () => mod.exports.useRefetch(step(id), true));
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
    assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
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
  assert.deepEqual(mounted.step()!.sample, latest);
  assert.deepEqual(mounted.status(), { busy: false, error: null });
});

test("latest failures keep the saved fallback and cannot be overwritten by an older success", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow"); void mounted.run();
  mounted.commitUrl("https://example.test/latest"); void mounted.run();
  await mounted.finish(1, undefined, "新しい取得に失敗しました");
  await mounted.finish(0, old);
  assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
  assert.equal(mounted.step()!.fetchedAt, 1);
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
  assert.deepEqual(mounted.step()!.sample, latest);
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
  assert.deepEqual(mounted.step("other")!.sample, [{ name: "Other" }]);
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
  assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
  useEditor.getState().undo(); useEditor.getState().redo();
  assert.equal(mounted.requests.length, 0);
});

test("one explicit execution caches the full response and viewing it never resends a write", async () => {
  const mounted = mount(); mounted.setOptions({ method: "POST" });
  const all = Array.from({ length: 23 }, (_, i) => ({ name: String(i) }));
  void mounted.run(); await mounted.finish(0, all);
  assert.deepEqual(mounted.step()!.sample, all.slice(0, 20));
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
  assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }], "closing cancels saving, not the transmitted request");
  assert.equal(second.status().busy, false);
  void second.run(); await mounted.finish(1, latest);
  assert.deepEqual(mounted.step()!.sample, latest);
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
    assert.deepEqual(mounted.step()!.sample, latest);
  }
});

test("pending state is independent for different blocks and identical writes retry only after settlement", async () => {
  const mounted = mount();
  const first = mounted.openTest(); void first.run();
  const other = mounted.openTest("other"); void other.run();
  await mounted.finish(1, latest); assert.equal(first.status().busy, true);
  await mounted.finish(0, old); assert.equal(first.status().busy, false);
  void first.run(); await mounted.finish(2, latest);
  assert.deepEqual(mounted.step()!.sample, latest);
  assert.deepEqual(mounted.step("other")!.sample, latest);
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
    assert.deepEqual(mounted.step()!.sample, sample);
    assert.deepEqual(mounted.cached(), sample);
    mounted.openPeek(); assert.equal(mounted.requests.length, 1);
    useEditor.getState().replaceDoc(JSON.parse(JSON.stringify(useEditor.getState().doc)));
    assert.deepEqual(mounted.step()!.sample, sample);
  }
});

test("the browser regression fixture bundles the real script editor", async () => {
  const bundle = await fetchRefetchBundle();
  assert.match(bundle, /function ScriptEditorInner/);
  assert.match(bundle, /function FetchBody/);
});
