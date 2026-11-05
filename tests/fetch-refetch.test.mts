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
  const root = { slots: [] as any[], pending: [] as (() => void)[] };
  let current = root;
  let cursor = 0;
  let selected = "fetch";
  const context = {
    doc: useEditor.getState().doc, pageId: "p", renameVar() {}, openPeek() {},
    // ScriptEditor と同じ、応答時点のストアにステップ単位で書き込む経路。
    updateStep(id: string, fn: (step: ScriptStep) => ScriptStep) {
      const scripts = numberFilters(mapStep(pageScriptsOf(useEditor.getState().doc, [], "p"), id, fn));
      useEditor.getState().updateDoc((doc) => applyPageScripts(doc, "p", [], scripts));
    },
  };
  const hooks = {
    ...React, useContext: () => context,
    useState(initial: any) {
      const index = cursor++;
      const slots = current.slots;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: any) {
      const index = cursor++;
      return current.slots[index] ??= { current: initial };
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = cursor++;
      const instance = current;
      const previous = instance.slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        instance.pending.push(() => {
          previous?.cleanup?.();
          instance.slots[index] = { effect: true, deps, cleanup: effect() };
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
  const renderInstance = (instance: typeof root, draw: () => any) => {
    current = instance;
    cursor = 0;
    context.doc = useEditor.getState().doc;
    const view = draw();
    instance.pending.splice(0).forEach((effect) => effect());
    return view;
  };
  const unmount = (instance: typeof root) => {
    for (const slot of instance.slots) if (slot?.effect) slot.cleanup?.();
  };
  const render = () => renderInstance(root, () => mod.exports.FetchBody({ step: step(selected) }).props.children);
  return {
    requests, step, render,
    unmount: () => unmount(root),
    openBody(id = "fetch") {
      const instance = { slots: [] as any[], pending: [] as (() => void)[] };
      const render = () => renderInstance(instance, () => mod.exports.FetchBody({ step: step(id) }).props.children);
      return {
        commitUrl: (url: string) => render()[0].props.parts.url.props.onCommit(url),
        close: () => unmount(instance),
      };
    },
    openModal() {
      const instance = { slots: [] as any[], pending: [] as (() => void)[] };
      const blocks = { exports: {} as any };
      const blocksCode = transformSync(readFileSync("components/script-editor/blocks.tsx", "utf8"), {
        loader: "tsx", jsx: "automatic", format: "cjs",
      }).code;
      new Function("require", "module", "exports", blocksCode)(
        (id: string) => id === "react" ? hooks : id === "./fetch" ? mod.exports : require(id), blocks, blocks.exports,
      );
      const close = () => unmount(instance);
      const render = () => renderInstance(instance, () => blocks.exports.PeekModal({ step: step(), onClose: close }));
      render();
      return {
        refresh: () => render().props.children[0].props.children[1].props.onClick(),
        close: () => render().props.children[0].props.children[2].props.onClick(),
        status: () => {
          const view = render().props.children;
          return { busy: view[0].props.children[1].props.disabled, error: view[2]?.props.children ?? null };
        },
      };
    },
    select(id: string) { selected = id; },
    commitUrl(url: string) { render()[0].props.parts.url.props.onCommit(url); },
    setOptions(patch: FetchOptions) {
      let view = render();
      if (!view[4]) { view[2].props.onClick(); view = render(); }
      view[4].props.children[1].props.onChange(patch);
    },
    async finish(index: number, sample: unknown, error?: string) {
      requests[index].finish(new Response(JSON.stringify(error ? { error } : { json: sample }), { status: error ? 502 : 200 }));
      await new Promise((done) => setTimeout(done, 0));
    },
    status() {
      const view = render();
      return { busy: view[1]?.props.className === "se-blk-note", error: view[3]?.props.children ?? null };
    },
  };
}

const old = [{ name: "OLD" }];
const latest = [{ name: "LATEST" }];

test("changing the source keeps the newest sample in the document and variable preview", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow");
  mounted.commitUrl("https://example.test/latest");
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
    mounted.commitUrl("https://example.test/slow");
    mounted.commitUrl("https://example.test/latest");
    await mounted.finish(0, old, error);
    assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
    assert.deepEqual(mounted.status(), { busy: true, error: null });
    await mounted.finish(1, latest);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
  }
});

test("late older errors do not replace the latest successful result", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow");
  mounted.commitUrl("https://example.test/latest");
  await mounted.finish(1, latest);
  await mounted.finish(0, undefined, "古い取得に失敗しました");
  assert.deepEqual(mounted.step()!.sample, latest);
  assert.deepEqual(mounted.status(), { busy: false, error: null });
});

test("latest failures keep the saved fallback and cannot be overwritten by an older success", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow");
  mounted.commitUrl("https://example.test/latest");
  await mounted.finish(1, undefined, "新しい取得に失敗しました");
  await mounted.finish(0, old);
  assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
  assert.equal(mounted.step()!.fetchedAt, 1);
  assert.deepEqual(mounted.status(), { busy: false, error: "新しい取得に失敗しました" });
});

test("requests to the same URL also follow the newest method, headers and JSON body", async () => {
  const mounted = mount();
  mounted.setOptions({ method: "POST" });
  mounted.setOptions({ headers: [{ name: "X-Version", value: "new" }] });
  mounted.setOptions({ body: '{"version":2}' });
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
  mounted.commitUrl("https://example.test/slow");
  mounted.commitUrl("");
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
    change(mounted);
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
      mounted.commitUrl("https://example.test/slow");
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
  mounted.commitUrl("https://example.test/failed");
  await mounted.finish(0, undefined, "現在の取得に失敗しました");
  assert.deepEqual(mounted.status(), { busy: false, error: "現在の取得に失敗しました" });
  useEditor.getState().undo();
  assert.deepEqual(mounted.status(), { busy: false, error: null });
  assert.equal(mounted.requests.length, 1);
});

test("a removed block is not recreated and another selected block is not overwritten", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/slow");
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
  mounted.commitUrl("https://example.test/latest");
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

test("closing and reopening the data modal invalidates the old refresh success and error", async () => {
  for (const error of [undefined, "閉じた小窓の取得に失敗しました"]) {
    const mounted = mount();
    const first = mounted.openModal();
    await mounted.finish(0, [{ name: "Initial" }]);
    first.refresh();
    first.close();
    const reopened = mounted.openModal();
    reopened.refresh();
    await mounted.finish(2, latest);
    assert.deepEqual(reopened.status(), { busy: false, error: null });
    // 最新の見本になった小窓は、同じ取得元の全件も読み直す。
    await mounted.finish(3, latest);
    const saved = structuredClone(useEditor.getState().doc);
    const historyLength = useEditor.getState().past.length;
    await mounted.finish(1, old, error);
    assert.deepEqual(useEditor.getState().doc, saved);
    assert.equal(useEditor.getState().past.length, historyLength);
    assert.deepEqual(previewDataVars(saved, "p").products, latest);
    assert.deepEqual(reopened.status(), { busy: false, error: null });
  }
});

test("a reopened modal keeps its latest failure and fallback after the closed refresh succeeds", async () => {
  const mounted = mount();
  const first = mounted.openModal();
  await mounted.finish(0, [{ name: "Initial" }]);
  first.refresh();
  first.close();
  const reopened = mounted.openModal();
  reopened.refresh();
  await mounted.finish(2, undefined, "新しい小窓の取得に失敗しました");
  await mounted.finish(1, old);
  assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
  assert.deepEqual(reopened.status(), { busy: false, error: "新しい小窓の取得に失敗しました" });
});

test("closing the modal cancels explicit refresh while background FetchBody work still saves", async () => {
  const mounted = mount();
  const modal = mounted.openModal();
  await mounted.finish(0, [{ name: "Initial" }]);
  modal.refresh();
  modal.close();
  const saved = structuredClone(useEditor.getState().doc);
  await mounted.finish(1, old);
  assert.deepEqual(useEditor.getState().doc, saved);

  mounted.commitUrl("https://example.test/background");
  mounted.unmount();
  await mounted.finish(2, latest);
  assert.deepEqual(mounted.step()!.sample, latest);
  assert.equal(mounted.step()!.url, "https://example.test/background");
});

test("a newer modal refresh supersedes background work from the closed script editor", async () => {
  for (const oldFirst of [false, true]) {
    for (const error of [undefined, "新しい取得に失敗しました"]) {
      const mounted = mount();
      mounted.commitUrl("https://example.test/background");
      mounted.unmount();
      const modal = mounted.openModal();
      await mounted.finish(1, [{ name: "Initial" }]);
      modal.refresh();
      if (oldFirst) {
        await mounted.finish(0, old);
        assert.deepEqual(mounted.step()!.sample, [{ name: "Initial" }]);
        assert.deepEqual(modal.status(), { busy: true, error: null });
      }
      await mounted.finish(2, latest, error);
      assert.deepEqual(modal.status(), { busy: false, error: error ?? null });
      if (!error) await mounted.finish(3, latest);
      const saved = structuredClone(useEditor.getState().doc);
      const historyLength = useEditor.getState().past.length;
      if (!oldFirst) await mounted.finish(0, old);
      assert.deepEqual(useEditor.getState().doc, saved);
      assert.equal(useEditor.getState().past.length, historyLength);
      assert.deepEqual(mounted.step()!.sample, error ? [{ name: "Initial" }] : latest);
    }
  }
});

test("an old modal cleanup or response cannot remove another hook's current request", async () => {
  const mounted = mount();
  const first = mounted.openModal();
  await mounted.finish(0, [{ name: "Initial" }]);
  first.refresh();
  const second = mounted.openModal();
  second.refresh();
  // 古い画面の cleanup が新しい要求の登録より後でも、所有者を確かめて片付ける。
  first.close();
  await mounted.finish(1, old);
  assert.deepEqual(second.status(), { busy: true, error: null });
  await mounted.finish(2, latest);
  assert.deepEqual(mounted.step()!.sample, latest);
});

test("background work is independent for different blocks and latest-first across reopened bodies", async () => {
  const mounted = mount();
  mounted.commitUrl("https://example.test/background");
  mounted.unmount();
  const other = mounted.openBody("other");
  other.commitUrl("https://example.test/other-latest");
  await mounted.finish(1, [{ name: "OTHER LATEST" }]);
  await mounted.finish(0, latest);
  assert.deepEqual(mounted.step()!.sample, latest);
  assert.deepEqual(mounted.step("other")!.sample, [{ name: "OTHER LATEST" }]);

  const before = mounted.openBody();
  before.commitUrl("https://example.test/again");
  before.close();
  const reopened = mounted.openBody();
  reopened.commitUrl("https://example.test/different");
  reopened.commitUrl("https://example.test/again");
  await mounted.finish(4, latest);
  await mounted.finish(2, old);
  await mounted.finish(3, old);
  assert.deepEqual(mounted.step()!.sample, latest);
});

test("the browser regression fixture bundles the real script editor", async () => {
  const bundle = await fetchRefetchBundle();
  assert.match(bundle, /function ScriptEditorInner/);
  assert.match(bundle, /function FetchBody/);
});
