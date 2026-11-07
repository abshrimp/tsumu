import { describe, before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "./helpers/bundle";
import { fetchPreviewScope } from "../components/script-editor/fetch";
import { itemFieldsOf } from "../components/script-editor/arrays";
import { previewDataVars, toListItems, varGroupsAt, type FetchStep, pagePlan } from "../lib/data";
import { variableChoiceSamples } from "../lib/variable-choice";
import { lookupVar } from "../lib/vars";
import { fetchScopeDoc, fetchRefetchDoc } from "./helpers/fetch-refetch";
import { fetchPreviewInputs } from "../lib/fetch-preview";
import { resolve } from "node:path";
import * as React from "react";
import { useEditor } from "../lib/store";
import { applyPageScripts, pageScriptsOf, walkSteps, compileScripts } from "../lib/script";
import { mapStep, numberFilters } from "../components/script-editor/step-tree";
import { type FetchOptions, runtimeJsonBody } from "../lib/fetch-request";
import { PAGE_TARGET, type ScriptStep, type SiteDoc } from "../lib/types";
import { makeText, makeBox } from "../lib/presets";
import * as scriptContexts from "../components/script-editor/context";
import { scriptsFile } from "../lib/script-runtime";
import * as source_2 from "../lib/safe-fetch";
import * as source_3 from "../lib/safe-fetch";
import { SAFE_FETCH_SOURCE } from "../lib/generator/safe-fetch-source";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";

describe("fetch-json-errors", () => {
class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(body), init);
  }
}

function fixture(fetchPublic: (url: string, init: RequestInit) => Promise<Response>) {
  const url = new URL("../app/api/fetch-json/route.ts", import.meta.url);
  const require = createRequire(url);
  const { code } = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  });
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../lib/i18n-server": {
      serverTr: async () => (value: string, params: Record<string, unknown> = {}) =>
        value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? key)),
    },
    "../../../lib/server": { requireAuth: async () => null },
    "../../../lib/safe-fetch": {
      BlockedUrlError: class extends Error {}, TooLargeError: class extends Error {},
      fetchPublic,
      readTextLimited: async () => { throw new Error("an HTTP error body must not be parsed"); },
    },
  };
  const module = { exports: {} as { POST: (req: Request) => Promise<Response> } };
  new Function("require", "module", "exports", code)(
    (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    module, module.exports,
  );
  return (signal?: AbortSignal) => module.exports.POST(new Request("https://editor.example/api/fetch-json", {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://data.example/value.json" }),
  }));
}

async function timely<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("HTTP error waited for upstream cancellation")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

test("JSON proxy reports a cloned upstream HTTP error without waiting for its other reader", async () => {
  const original = new Response("upstream failure", { status: 503 });
  const clone = original.clone();
  try {
    const result = await timely(fixture(async () => clone)());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /HTTP 503/);
    assert.equal(original.bodyUsed, false);
    assert.equal(await original.text(), "upstream failure");
  } finally { void original.body?.cancel().catch(() => {}); }
});

for (const rejects of [false, true]) {
  test(`JSON proxy preserves HTTP errors when upstream cancellation ${rejects ? "rejects" : "never resolves"}`, async () => {
    let cancelled = false;
    const upstream = new Response(new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return rejects ? Promise.reject(new Error("cleanup failed")) : new Promise<void>(() => {});
      },
    }), { status: 429 });
    const result = await timely(fixture(async () => upstream)());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /HTTP 429/);
    assert.equal(cancelled, true);
  });
}

test("cancelling a preview propagates to the in-flight data request", async () => {
  const controller = new AbortController();
  let observedReason: unknown;
  await fixture(async (_url, { signal }) => {
    controller.abort();
    observedReason = signal?.reason;
    return new Response(null, { status: 503 });
  })(controller.signal);
  assert.equal(observedReason, controller.signal.reason);
});
});

describe("fetch-preview", () => {
test("test requests resolve known nested values but require unknown, null and complex URL values", () => {
  const inputs = fetchPreviewInputs("https://example.test/[slug]/{data.name}/{data.items}/{empty}/{nil}/{flag}/{zero}", {}, {
    data: { name: "001", items: [1] }, empty: "", nil: null, flag: false, zero: 0,
  });
  assert.deepEqual(inputs.map(({ name, missing }) => [name, missing]), [
    ["slug", true], ["data.name", false], ["data.items", true], ["empty", false], ["nil", true], ["flag", false], ["zero", false],
  ]);
  assert.equal(inputs[1].value, "001", "samples do not declare or coerce a type");
});

test("only active headers and bodies need values, with raw body objects and null preserved", () => {
  const options = { method: "POST" as const, headers: [{ name: "X-Key", value: "{token}" }, { name: "", value: "{unused}" }], body: '{"data":{object},"nil":{nil},"other":{unknown}}' };
  const vars = { token: "", object: { x: 1 }, nil: null };
  assert.deepEqual(fetchPreviewInputs("https://example.test", options, vars).map(({ name, missing }) => [name, missing]), [
    ["token", false], ["object", false], ["nil", false], ["unknown", true],
  ]);
  assert.deepEqual(fetchPreviewInputs("https://example.test/\\{literal}", { ...options, method: "DELETE" }, vars).map((v) => v.name), ["token"]);
});

test("temporary explicit empty and dotted overrides are accepted without changing the samples", () => {
  const samples = { data: { value: undefined } };
  assert.equal(fetchPreviewInputs("https://example.test/{data.value}", {}, samples)[0].missing, true);
  assert.equal(fetchPreviewInputs("https://example.test/{data.value}", {}, { ...samples, "data.value": "" })[0].missing, false);
  assert.equal(samples.data.value, undefined);
});


test("real list-node scope keeps nested row values instead of page values and dotted aliases", () => {
  const doc = fetchScopeDoc("node");
  const groups = varGroupsAt(doc, "p", "act");
  assert.equal(groups[0].key, "item");
  const vars = variableChoiceSamples(groups);
  assert.equal(lookupVar(vars, "details.id"), "ROW-ID");
  assert.deepEqual(lookupVar(vars, "details"), { id: "ROW-ID" });
  assert.equal(Object.hasOwn(vars, "details.id"), false, "lower-scope dotted aliases cannot bypass the local root");
});

test("real loop leaf discovery also shadows object/array roots and empty containers", () => {
  const doc = fetchScopeDoc("loop");
  const sample = previewDataVars(doc, "p").rows;
  const fields = itemFieldsOf(sample);
  const roots = Object.keys(toListItems(sample)[0]);
  assert.ok(fields.includes("details.id"));
  assert.ok(!fields.includes("details"));
  assert.ok(!fields.includes("empty"));
  const scope = fetchPreviewScope("", [{ fields, roots }]);
  const vars = variableChoiceSamples(varGroupsAt(doc, "p", scope.nodeId), scope.localNames);
  for (const name of ["details", "details.id", "empty", "tags"]) assert.equal(lookupVar(vars, name), undefined, name);
  const inputs = fetchPreviewInputs("https://example.test/{details.id}/{empty}/{tags}", { method: "POST", body: '{"raw":{details}}' }, vars);
  assert.equal(inputs.length, 4); assert.ok(inputs.every((input) => input.missing));
});
});

describe("fetch-refetch", () => {
  before(() => {
    useEditor.setState({
      breakpoint: "base", customWidth: null, styleState: "default", mode: "design",
      pageTheme: "light", selection: null, selectedIds: [], editingComponentId: null, scriptEditor: null,
    });
  });
const { ScriptNodeCtx, ScriptOwnerCtx, LoopCtx } = scriptContexts;

// 実際のソースの FetchBody の入力の確定と useRefetch を動かす。DOM の代わりに、フックの状態を持つ。
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
    doc: useEditor.getState().doc, pageId: "p", scriptRootIds: options.roots ?? [], variableIndex: { names: [], byStep: new Map(), hasOther: () => false }, renameVar() {}, openPeek(...args: any[]) { opened.push(args); },
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
    useId() { return "test-id"; },
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
    const scripts = nodeId ? doc.nodes[nodeId]?.scripts ?? [] : doc.pages.p.pageScripts ?? [];
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
  return {
    requests, step, render, opened, browserDocument,
    action: () => render()[2],
    currentSample: () => mod.exports.hasCurrentSample(step()),
    values: () => render().find((v: any) => v?.type?.name === "FetchValues")?.props.state,
    compose(active: boolean) {
      const view = renderInstance(root, () => mod.exports.FetchBody({ step: step(selected) }));
      view.props[active ? "onCompositionStartCapture" : "onCompositionEndCapture"]();
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
    openPeek() { return this.result({ nodeId: "", localNames: [] })(); },
    cached: () => mod.exports.wholeCache.get(mod.exports.wholeKey(step())),
    wholeCache: mod.exports.wholeCache as Map<string, unknown>,
    setWholeCache: mod.exports.setWholeCache as (key: string, value: unknown) => void,
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
      // React の再描画より先に応答が返る場合も、古い設定の状態を表示しない。
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
  assert.equal(mounted.status().error, "Enter test values to continue");
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


test("one block action executes immediately, opens the result, then becomes view-only", async () => {
  const mounted = mount();
  assert.equal(mounted.action().props.children[1], "View data");
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 0);
  mounted.commitUrl("https://example.test/new");
  assert.equal(mounted.action().props.children[1], "Fetch data");
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 1, "no confirmation step before sending");
  assert.equal(mounted.opened.length, 2);
  mounted.action().props.onClick();
  assert.equal(mounted.requests.length, 1, "reopening a pending result does not send");
  await mounted.finish(0, latest);
  assert.equal(mounted.action().props.children[1], "View data");
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
  assert.equal(mounted.action().props.children[1], "Fetch data");
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
    useEditor.getState().updateDoc((doc) => { (doc.pages.p.pageScripts![0].steps[0] as FetchStep).preview!.fetchedAt = fetchedAt; });
    assert.equal(mounted.currentSample(), false);
    assert.equal(mounted.action().props.children[1], "Fetch data");
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
  // 取得した時刻の数字に偶然 "001" が含まれても、テストの値を保存したとは判定しない。
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
  assert.equal(mounted.action().props.children[1], "View data");
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


test("identical page and step IDs in a replacement document cannot inherit pending writes, errors, or attempts", async () => {
  for (const error of [undefined, "old document failed"]) {
    const mounted = mount(); mounted.setOptions({ method: "POST" }); mounted.action().props.onClick();
    const other = structuredClone(useEditor.getState().doc); other.siteName = "Different document";
    useEditor.getState().replaceDoc(other);
    assert.equal(mounted.status().busy, false);
    assert.equal(mounted.action().props.children[1], "Fetch data");
    await mounted.finish(0, latest, error);
    assert.deepEqual(useEditor.getState().doc, other);
    assert.equal(mounted.status().error, null);
    assert.equal(mounted.action().props.children[1], "Fetch data");
  }
});

test("restoring a backup with identical request IDs isolates late success, errors and attempts", async () => {
  for (const error of [undefined, "old document failed"]) {
    const mounted = mount(); mounted.setOptions({ method: "POST" });
    mounted.action().props.onClick();
    const restored = structuredClone(useEditor.getState().doc);
    (restored.pages.p.pageScripts![0].steps[0] as FetchStep).preview!.sample = [{ name: "Backup" }];
    const session = useEditor.getState().documentSession;
    useEditor.getState().restoreDoc(restored);
    assert.equal(useEditor.getState().documentSession, session + 1);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
    assert.equal(mounted.action().props.children[1], "Fetch data");
    const past = structuredClone(useEditor.getState().past);
    await mounted.finish(0, latest, error);
    assert.deepEqual(useEditor.getState().doc, restored);
    assert.deepEqual(useEditor.getState().past, past);
    assert.equal(mounted.cached(), undefined);
    assert.deepEqual(mounted.status(), { busy: false, error: null });
    assert.equal(mounted.action().props.children[1], "Fetch data");
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
  assert.equal(mounted.action().props.children[1], "Fetch data");
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
    (restored.pages.p.pageScripts![0].steps[0] as FetchStep).preview!.sample = [{ name: "Backup" }];
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
  assert.equal(mounted.action().props.children[1], "View data");
  mounted.action().props.onClick(); assert.equal(mounted.requests.length, 1);
  assert.match(mounted.status().error!, /request was sent/);
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
  doc.nodes.act = { ...makeText("Act"), id: "act", scripts: [{ id: "node-script", trigger: "click", steps: [fetch] }] };
  doc.pages.p.children = ["act"];
  return doc;
}

test("real duplicatePage assigns independent script and step IDs and keeps fetch responses on the authoring node", async () => {
  const mounted = mount({ doc: nodeFetchDoc(), nodeId: "act", owner: { nodeId: "act", scriptId: "node-script" } });
  useEditor.getState().duplicatePage("p");
  const copiedPage = useEditor.getState().activePageId;
  const copiedNode = useEditor.getState().doc.pages[copiedPage].children[0];
  const originalCopy = structuredClone(useEditor.getState().doc.nodes[copiedNode]);
  assert.notEqual(originalCopy.scripts![0].id, "node-script");
  assert.notEqual(originalCopy.scripts![0].steps[0].id, "fetch");
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
  useEditor.getState().updateDoc((doc) => { (doc.pages.p.pageScripts![0].steps[1] as FetchStep).preview!.sample = [{ name: "LATEST" }]; });
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
        (doc.pages.p.pageScripts![0].steps[1] as FetchStep).preview!.sample = [{ name: "Other", newfield: value }];
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

test("same-page nodes with copied identical script and step IDs remain separate request owners", async () => {
  const mounted = mount({ doc: nodeFetchDoc(), nodeId: "act", owner: { nodeId: "act", scriptId: "node-script" } });
  useEditor.getState().duplicatePage("p");
  const copiedPage = useEditor.getState().activePageId;
  const copiedNode = useEditor.getState().doc.pages[copiedPage].children[0];
  useEditor.getState().updateDoc((doc) => {
    doc.nodes[copiedNode].scripts = structuredClone(doc.nodes.act.scripts);
    doc.pages[copiedPage].children = [];
    doc.pages.p.children.push(copiedNode);
  });
  const copy = structuredClone(useEditor.getState().doc.nodes[copiedNode]);
  assert.equal(copy.scripts![0].id, "node-script"); assert.equal(copy.scripts![0].steps[0].id, "fetch");
  void mounted.run(); await mounted.finish(0, latest);
  assert.deepEqual(mounted.step()!.preview?.sample, latest); assert.deepEqual(useEditor.getState().doc.nodes[copiedNode], copy);
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

test("setWholeCache bounds whole-response cache size and refreshes updated entries", () => {
  const mounted = mount();
  mounted.wholeCache.clear();
  for (let i = 0; i < 16; i++) mounted.setWholeCache(`k-${i}`, i);
  assert.equal(mounted.wholeCache.size, 16);
  // Updating k-0 moves it to most-recently-used so k-1 becomes the oldest entry.
  mounted.setWholeCache("k-0", "refreshed");
  mounted.setWholeCache("k-16", 16);
  assert.equal(mounted.wholeCache.size, 16);
  assert.equal(mounted.wholeCache.get("k-0"), "refreshed");
  assert.equal(mounted.wholeCache.has("k-1"), false);
  assert.equal(mounted.wholeCache.get("k-16"), 16);
});
});

describe("interactive-fetch", () => {
const initial: ScriptStep = {
  id: "initial", kind: "fetch", url: "https://data.example.test/catalog", as: "initial",
  preview: { sample: [{ name: "seed" }] },
};
const later: ScriptStep = {
  id: "interactive", kind: "fetch", url: "https://data.example.test/{q}", as: "items",
  method: "POST", headers: [{ name: "X-Query", value: "{q}" }],
  body: '{"q":"{q}","index":{index}}',
  preview: { sample: [{ name: "sample" }] },
};

function site(): SiteDoc {
  const node = makeBox();
  node.id = "button";
  node.scripts = [{ id: "click", trigger: "click", steps: [
    { id: "if", kind: "if", cond: { subject: "var", left: "{ready}", op: "eq", value: "true", target: "" },
      then: [later], else: [] },
    { id: "after", kind: "set-var", into: "done", value: "{items.0.name}" },
  ] }];
  return {
    schemaVersion: 1, siteName: "Event-driven data", assets: {}, nodes: { button: node },
    pageOrder: ["p"], pages: { p: {
      id: "p", name: "Page", slug: "", description: "", title: "",
      children: ["button"], pageScripts: [{ id: "load", trigger: "load", steps: [initial] }],
    } },
  };
}

test("only page-load root fetches are server-executed; event fetches remain live", () => {
  const doc = site(), plan = pagePlan(doc, "p");
  assert.deepEqual(plan.steps.map((step) => step.id), ["initial"]);
  assert.ok(plan.serverIds.has("initial"));
  assert.ok(plan.clientVars.has("items"));
  assert.equal(plan.clientVars.has("initial"), false);

  const page = compileScripts({ scripts: doc.pages.p.pageScripts }, () => "/", undefined, false, plan.serverIds);
  assert.deepEqual(page, []);

  const actions = compileScripts(doc.nodes.button, () => "/");
  const nested = actions[0].steps[0] as { then: Array<Record<string, unknown>> };
  const actual = nested.then[0];
  assert.equal(actual.kind, "fetch");
  assert.equal(actual.url, later.url);
  assert.equal(actual.body, later.body);
  assert.equal(actual.as, "items");
  assert.equal("preview" in actual, false);
  assert.equal("id" in actual, false);
  const runtime = scriptsFile(doc);
  assert.match(runtime, /st\.kind === "fetch"/);
});

test("JSON request template preserves types and escapes string values", () => {
  const vars: Record<string, unknown> = { q: 'a"b\\c', index: 3, list: [1, 2] };
  const output = runtimeJsonBody(
    '{"query":"{q}","index":{index},"list":{list},"missing":{unknown}}',
    (name) => vars[name],
    (value) => value == null ? "" : String(value)
  );
  assert.deepEqual(JSON.parse(output), { query: vars.q, index: 3, list: [1, 2], missing: null });
});
});

describe("safe-fetch-lifecycle", () => {
const generatedModule = { exports: {} };
new Function("module", "exports", transformSync(SAFE_FETCH_SOURCE, {
  loader: "ts", format: "cjs",
}).code)(generatedModule, generatedModule.exports);
const runtimes = { source: source_2, generated: generatedModule.exports as typeof source_2 };

// 複製した Response は tee を使う。片方の枝を取り消すと、読まれていないもう一方の枝を待つ。
// 検証が終わるまでその枝を残し、後始末でデッドロックが隠れないようにする。
function clonedResponse(t: TestContext, init?: ResponseInit, request?: AbortController) {
  const original = new Response("unused body", init);
  t.after(() => {
    // fetch の模擬を元に戻した後に、中断したリダイレクトを再開してはならない。
    request?.abort();
    void original.body?.cancel().catch(() => {});
  });
  return original.clone();
}

async function withoutCancellationWait<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation is waiting for upstream cancellation")), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function selectNative(t: TestContext, worker: boolean) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: worker ? "Cloudflare-Workers" : "Node.js" },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
}

for (const [name, runtime] of Object.entries(runtimes)) {
  for (const [transport, url] of Object.entries({
    IPv4: "https://8.8.8.8/start",
    IPv6: "https://[2606:4700::1111]/start",
    Workers: "https://public.example.test/start",
  })) {
    test(`${name}: ${transport} rejects a private redirect without waiting for a cloned body`, async (t) => {
      selectNative(t, transport === "Workers");
      const response = clonedResponse(t, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      const outbound = t.mock.method(globalThis, "fetch", async () => response);
      await assert.rejects(withoutCancellationWait(runtime.fetchPublic(url, {})), runtime.BlockedUrlError);
      assert.equal(outbound.mock.callCount(), 1);
      assert.equal(response.bodyUsed, true, "discard the redirect body even though cancellation is pending");
    });

    test(`${name}: ${transport} rejects a malformed redirect Location with BlockedUrlError`, async (t) => {
      selectNative(t, transport === "Workers");
      const response = clonedResponse(t, { status: 302, headers: { location: "http://[::1:bad]" } });
      t.mock.method(globalThis, "fetch", async () => response);
      await assert.rejects(withoutCancellationWait(runtime.fetchPublic(url, {})), runtime.BlockedUrlError);
    });

    test(`${name}: ${transport} follows an allowed redirect without waiting for a cloned body`, async (t) => {
      selectNative(t, transport === "Workers");
      const request = new AbortController();
      const response = clonedResponse(t, { status: 302, headers: { location: "/next" } }, request);
      const sent: string[] = [];
      t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        sent.push(String(input));
        return sent.length === 1 ? response : new Response("ok");
      });
      const result = await withoutCancellationWait(runtime.fetchPublic(url, { signal: request.signal }));
      assert.equal(await result.text(), "ok");
      assert.deepEqual(sent, [url, new URL("/next", url).href]);
      assert.equal(response.bodyUsed, true);
    });
  }

  for (const advertised of [false, true]) {
    test(`${name}: text limit rejects a cloned body promptly (${advertised ? "declared" : "streamed"} size)`, async (t) => {
      const response = clonedResponse(t, advertised ? { headers: { "content-length": "11" } } : undefined);
      await assert.rejects(withoutCancellationWait(runtime.readTextLimited(response, 3)), runtime.TooLargeError);
      assert.equal(response.bodyUsed, true);
      assert.equal(response.body!.locked, false);
    });
  }

  test(`${name}: malformed UTF-8 cancels the remainder and releases the reader without awaiting cleanup`, async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(Uint8Array.of(0xff)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    }));
    await assert.rejects(withoutCancellationWait(runtime.readTextLimited(response, 10)), TypeError);
    assert.equal(cancelled, true, "stop the upstream after decoding fails");
    assert.equal(response.body!.locked, false);
  });

  test(`${name}: text reader releases its lock after success and upstream failure`, async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode("日本");
        controller.enqueue(bytes.subarray(0, 2));
        controller.enqueue(bytes.subarray(2));
        controller.close();
      },
    }));
    assert.equal(await runtime.readTextLimited(response, 6), "日本");
    assert.equal(response.body!.locked, false);
    const failure = new Error("upstream disconnected");
    const broken = new Response(new ReadableStream({ start(controller) { controller.error(failure); } }));
    await assert.rejects(runtime.readTextLimited(broken, 6), failure);
    assert.equal(broken.body!.locked, false);
  });
}
});

describe("safe-fetch-response-limits", () => {
const generatedModule = { exports: {} };
new Function("module", "exports", transformSync(SAFE_FETCH_SOURCE, {
  loader: "ts", format: "cjs",
}).code)(generatedModule, generatedModule.exports);
const runtimes = { source: source_3, generated: generatedModule.exports as typeof source_3 };

const nativeTargets = {
  "Node IPv4": "https://8.8.8.8/data",
  "Node IPv6": "https://[2606:4700::1111]/data",
  Workers: "https://public.example.test/data",
};

function selectNative(t: TestContext, name: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true, value: { userAgent: name === "Workers" ? "Cloudflare-Workers" : "Node.js" },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
}

for (const [runtimeName, runtime] of Object.entries(runtimes)) {
  for (const [transport, url] of Object.entries(nativeTargets)) {
    test(`${runtimeName}: ${transport} enforces actual body bytes and cancels overflow`, async (t) => {
      selectNative(t, transport);
      const headerCases: HeadersInit[] = [{}, { "content-length": "1" }, { "content-encoding": "gzip", "content-length": "2" }];
      for (const headers of headerCases) {
        let cancelled = false;
        let pulls = 0;
        // ネイティブの fetch は、デコードしたバイト列を返す。通信上の長さで上限を決めてはならない。
        t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
          pull(controller) { pulls++; controller.enqueue(new Uint8Array(3)); },
          cancel() { cancelled = true; },
        }), { headers }));
        await assert.rejects(runtime.fetchPublic(url, {}, 5, 5), runtime.TooLargeError);
        assert.equal(cancelled, true);
        assert.ok(pulls <= 3, "overflow must stop reading the upstream");
      }
    });

    test(`${runtimeName}: ${transport} permits the exact byte limit and preserves response data`, async (t) => {
      selectNative(t, transport);
      t.mock.method(globalThis, "fetch", async () => new Response("日本", {
        status: 201, statusText: "Created", headers: { "content-type": "text/plain", "x-result": "ok" },
      }));
      const response = await runtime.fetchPublic(url, {}, 5, 6);
      assert.equal(response.status, 201);
      assert.equal(response.statusText, "Created");
      assert.equal(response.headers.get("x-result"), "ok");
      assert.equal(await response.text(), "日本");
      t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
      assert.equal((await runtime.fetchPublic(url, {}, 5, 0)).status, 204);
    });

    test(`${runtimeName}: ${transport} cancels a stalled response body on abort`, async (t) => {
      selectNative(t, transport);
      const controller = new AbortController();
      let cancelled = false;
      const reason = new Error("request deadline");
      t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
        pull() { queueMicrotask(() => controller.abort(reason)); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 })));
      await assert.rejects(runtime.fetchPublic(url, { signal: controller.signal }), reason);
      assert.equal(cancelled, true);
    });

    test(`${runtimeName}: ${transport} bounds redirect responses without a location`, async (t) => {
      selectNative(t, transport);
      t.mock.method(globalThis, "fetch", async () => new Response("too large", { status: 302 }));
      await assert.rejects(runtime.fetchPublic(url, {}, 5, 5), runtime.TooLargeError);
    });

    test(`${runtimeName}: ${transport} removes compressed wire metadata from buffered bytes`, async (t) => {
      selectNative(t, transport);
      t.mock.method(globalThis, "fetch", async () => new Response("decoded", {
        headers: { "content-encoding": "gzip", "content-length": "27", "content-type": "text/plain" },
      }));
      const response = await runtime.fetchPublic(url, {}, 5, 7);
      assert.equal(await response.text(), "decoded");
      assert.equal(response.headers.get("content-type"), "text/plain");
      assert.equal(response.headers.has("content-encoding"), false);
      assert.equal(response.headers.has("content-length"), false);
    });

    test(`${runtimeName}: ${transport} does not wait for upstream cancellation on overflow`, { timeout: 1000 }, async (t) => {
      selectNative(t, transport);
      let cancelled = false;
      t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(6)); },
        cancel() { cancelled = true; return new Promise<void>(() => {}); },
      })));
      await assert.rejects(runtime.fetchPublic(url, {}, 5, 5), runtime.TooLargeError);
      assert.equal(cancelled, true);
    });

    test(`${runtimeName}: ${transport} cancels redirect bodies before validating the next destination`, async (t) => {
      selectNative(t, transport);
      let cancelled = false;
      const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
        cancel() { cancelled = true; },
      }), { status: 302, headers: { location: "http://127.0.0.1/private" } }));
      await assert.rejects(runtime.fetchPublic(url, {}, 5, 0), runtime.BlockedUrlError);
      assert.equal(cancelled, true);
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }

  for (const [encoding, compress] of Object.entries({ identity: (b: Buffer) => b, gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync })) {
    test(`${runtimeName}: Node hostname limits ${encoding} responses after decompression`, async (t) => {
      selectNative(t, "Node");
      const dns = process.getBuiltinModule("node:dns/promises");
      const http = process.getBuiltinModule("node:http");
      t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
      t.mock.method(http, "request", (_url: URL, _options: unknown, respond: Function) => {
        const bytes = compress(Buffer.from("x".repeat(1024)));
        const res = Object.assign(new PassThrough(), {
          statusCode: 200, headers: { "content-encoding": encoding, "content-length": String(bytes.length) },
        });
        return Object.assign(new EventEmitter(), {
          end() { queueMicrotask(() => { respond(res); res.end(bytes); }); },
          destroy() { res.destroy(); },
        });
      });
      await assert.rejects(runtime.fetchPublic("http://public.example.test/data", {}, 5, 1023), runtime.TooLargeError);
      const response = await runtime.fetchPublic("http://public.example.test/data", {}, 5, 1024);
      assert.equal(await response.text(), "x".repeat(1024));
      assert.equal(response.headers.has("content-encoding"), false);
      assert.equal(response.headers.has("content-length"), false);
    });
  }
}
});
