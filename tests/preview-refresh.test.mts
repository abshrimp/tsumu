import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor, type EditorMode } from "../lib/store";
import { makeSample, previewDataVars } from "../lib/data";
import { previewRefreshDoc, previewRows } from "./helpers/preview-refresh";

// 実際のフックの状態と依存配列を持つ。実際の Canvas と DOM の操作は、e2e でも検証する。
function mount(initialMode: EditorMode = "preview", doc = previewRefreshDoc()) {
  useEditor.getState().replaceDoc(doc);
  let mode = initialMode;
  let pageId = "home";
  let cursor = 0;
  let writes = 0;
  const slots: any[] = [];
  const effects: (() => void)[] = [];
  const hooks = {
    ...React,
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { writes++; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn: () => any, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn: any, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { effect: true, deps, cleanup: fn() };
      });
    },
  };
  const requests: { input: any; signal: AbortSignal | null | undefined; finish: (response: Response) => void; fail: (error: Error) => void }[] = [];
  const fetch = (_url: string, options: RequestInit) => new Promise<Response>((finish, fail) => {
    requests.push({ input: JSON.parse(String(options.body)), signal: options.signal, finish, fail });
  });
  const require = createRequire(resolve("components/canvas/useCanvasData.ts"));
  const module = { exports: {} as any };
  const code = transformSync(readFileSync("components/canvas/useCanvasData.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", "fetch", code)(
    (id: string) => id === "react" ? hooks : id === "../../lib/store" ? { useEditor: (selector: any) => selector(useEditor.getState()) } : require(id),
    module, module.exports, fetch,
  );
  const render = () => {
    cursor = 0;
    const state = useEditor.getState();
    const result = module.exports.useCanvasData({ page: state.doc.pages[pageId], doc: state.doc, activePageId: pageId, previewIndex: 0, mode, setPreviewIndex: state.setPreviewIndex });
    effects.splice(0).forEach((effect) => effect());
    return result;
  };
  const tick = () => new Promise((done) => setTimeout(done, 0));
  render();
  return {
    render, requests, writes: () => writes,
    mode(next: EditorMode) { mode = next; render(); },
    page(next: string) {
      pageId = next;
      render();
    },
    unmount() { for (const slot of slots) if (slot?.effect) slot.cleanup?.(); },
    async finish(index: number, json: unknown, status = 200) {
      requests[index].finish(new Response(JSON.stringify({ json }), { status })); await tick();
    },
    async fail(index: number) { requests[index].fail(new Error("offline")); await tick(); },
  };
}

for (const order of ["newest-first", "oldest-first"] as const) {
  test(`repeated preview submits keep the latest data and its loading state (${order})`, async () => {
    const m = mount();
    m.render().setFieldValues({ q: "new search" });
    void m.render().refreshData();
    assert.equal(new URL(m.requests[1].input.url).searchParams.get("q"), "new search");
    if (order === "newest-first") {
      await m.finish(1, previewRows("new", 35));
      await m.finish(0, previewRows("old", 50));
    } else {
      await m.finish(0, previewRows("old", 50));
      assert.equal(m.render().refreshing, true);
      assert.equal(m.render().pageVars.response.label, "home saved");
      await m.finish(1, previewRows("new", 35));
    }
    assert.equal(m.render().pageVars.response.label, "new");
    assert.equal(m.render().pageVars.response.rows.length, 35, "preview retains full data");
    assert.equal(m.render().pageVars.total, 35);
    assert.equal(m.render().refreshing, false);
    m.mode("design");
    assert.equal(m.render().pageVars.response.rows.length, 20, "design keeps a compact sample");
    assert.equal(m.render().pageVars.total, 35, "sample totals belong to the latest response");
    m.unmount();
  });
}

for (const interruption of ["preview restart", "page round trip"] as const) {
  test(`${interruption} discards responses from the previous visit`, async () => {
    const m = mount();
    if (interruption === "preview restart") { m.mode("design"); m.mode("preview"); }
    else { m.page("other"); await m.finish(1, previewRows("other", 27)); m.page("home"); }
    const latest = m.requests.length - 1;
    await m.finish(latest, previewRows("new", 34));
    await m.finish(0, previewRows("old", 52));
    assert.equal(m.render().pageVars.response.label, "new");
    assert.equal(m.render().pageVars.total, 34);
    m.unmount();
  });
}

test("leaving preview cancels its pending result and loading indicator", async () => {
  const m = mount();
  m.mode("design");
  assert.equal(m.render().refreshing, false);
  await m.finish(0, previewRows("abandoned"));
  assert.equal(m.render().pageVars.response.label, "home saved");
  assert.equal(m.render().pageVars.total, 1);
  m.unmount();
});

test("an older failure cannot end a current refresh; newest failure keeps the last valid data", async () => {
  for (const network of [false, true]) {
    const m = mount();
    await m.finish(0, previewRows("valid", 31));
    void m.render().refreshData();
    void m.render().refreshData();
    if (network) await m.fail(1); else await m.finish(1, null, 502);
    assert.equal(m.render().refreshing, true);
    assert.equal(m.render().pageVars.response.label, "valid");
    await m.finish(2, null, 502);
    assert.equal(m.render().refreshing, false);
    assert.equal(m.render().pageVars.response.rows.length, 31);
    assert.equal(m.render().pageVars.total, 31);
    m.unmount();
  }
});

test("a failed new session uses saved samples instead of accepting an abandoned success", async () => {
  const m = mount();
  m.page("other");
  await m.fail(1);
  assert.equal(m.render().pageVars.response.label, "other saved");
  await m.finish(0, previewRows("abandoned home"));
  assert.equal(m.render().pageVars.response.label, "other saved");
  m.page("home");
  await m.fail(2);
  assert.equal(m.render().pageVars.response.label, "home saved");
  m.unmount();
});

test("unrelated document edits and unsubmitted form changes do not discard a valid refresh", async () => {
  const m = mount("design");
  void m.render().refreshData();
  useEditor.getState().updateDoc((doc) => { doc.siteName = "Unrelated title"; doc.nodes.result.styles.base.color = "red"; });
  m.render().setFieldValues({ q: "not submitted" });
  await m.finish(0, previewRows("valid", 33));
  assert.equal(m.requests.length, 1);
  assert.equal(m.render().pageVars.response.label, "valid");
  assert.equal(m.render().pageVars.response.rows.length, 20);
  assert.equal(m.render().pageVars.total, 33);
  m.unmount();
});

test("unmount prevents late result and loading-state writes", async () => {
  const m = mount();
  m.unmount();
  const writes = m.writes();
  await m.finish(0, previewRows("late"));
  assert.equal(m.writes(), writes);
});

test("parallel fetch blocks settle as one refresh and retain independent fallback data", async () => {
  const m = mount("design");
  useEditor.getState().updateDoc((doc) => { doc.pages.home.pageScripts![0].steps.push({ id: "auxiliary", kind: "fetch", url: "https://example.test/aux", as: "aux", preview: { sample: { label: "aux sample" } } }); });
  void m.render().refreshData();
  await m.finish(0, previewRows("main", 40));
  assert.equal(m.render().refreshing, true);
  assert.equal(m.render().pageVars.response.label, "home saved", "wait for this refresh's other blocks");
  await m.fail(1);
  assert.equal(m.render().refreshing, false);
  assert.equal(m.render().pageVars.response.label, "main");
  assert.equal(m.render().pageVars.aux.label, "aux sample");
  m.unmount();
});

test("a successful obsolete request cannot replace the newest request's failure fallback", async () => {
  const m = mount();
  void m.render().refreshData();
  await m.fail(1);
  assert.equal(m.render().refreshing, false);
  await m.finish(0, previewRows("obsolete success", 45));
  assert.equal(m.render().pageVars.response.label, "home saved");
  assert.equal(m.render().pageVars.total, 1);
  void m.render().refreshData();
  await m.finish(2, previewRows("retry", 32));
  assert.equal(m.render().pageVars.response.label, "retry");
  m.unmount();
});

// 件数の補正は、切り詰めた見本と同じ取得の結果にだけ適用する。
for (const length of [0, 1, 2, 20, 21, 50]) {
  test(`a successful ${length}-row response replaces the previous sample total`, async () => {
    const m = mount();
    await m.finish(0, previewRows("large", 35));
    void m.render().refreshData();
    await m.finish(1, previewRows("latest", length));
    assert.equal(m.render().pageVars.response.rows.length, length, "preview uses the full response");
    assert.equal(m.render().pageVars.total, length);
    m.mode("design");
    assert.equal(m.render().pageVars.response.rows.length, Math.min(length, 20));
    assert.equal(m.render().pageVars.total, length, "design uses the latest response's total");
    m.unmount();
  });
}

test("design refreshes replace nested and aliased totals, including removed or changed array paths", async () => {
  const doc = previewRefreshDoc();
  doc.pages.home.pageScripts![0].steps.push(
    { id: "nested-alias", kind: "set-var", value: "{response.nested}", into: "nested" },
    { id: "nested-count", kind: "transform", source: "nested.rows", into: "nestedTotal", transform: { kind: "length" } },
  );
  const m = mount("design", doc);
  const responses = [
    { rows: previewRows("a", 35).rows, nested: { rows: previewRows("a", 43).rows } },
    { rows: previewRows("b", 2).rows, nested: { rows: [] } },
    { rows: previewRows("c", 22).rows, nested: { rows: previewRows("c", 31).rows } },
    { rows: [], nested: { rows: previewRows("d", 24).rows } },
    { rows: "not an array", nested: { replacement: [1, 2] } },
    { rows: [1], nested: { rows: [1, 2, 3] } },
  ];
  for (const [index, response] of responses.entries()) {
    void m.render().refreshData();
    await m.finish(index, response);
    assert.equal(m.render().pageVars.total, Array.isArray(response.rows) ? response.rows.length : undefined);
    assert.equal(m.render().pageVars.nestedTotal, response.nested.rows?.length);
  }
  m.unmount();
});

test("a root array response clears its previous root sample total", async () => {
  const doc = previewRefreshDoc();
  const count = doc.pages.home.pageScripts![0].steps.find((step) => step.id === "home-count")!;
  if (count.kind === "transform") count.source = "response";
  const m = mount("design", doc);
  for (const [index, length] of [32, 3, 0, 23].entries()) {
    void m.render().refreshData();
    await m.finish(index, Array.from({ length }, (_, id) => ({ id })));
    assert.equal(m.render().pageVars.total, length);
    assert.equal(m.render().pageVars.response.length, Math.min(length, 20));
  }
  m.unmount();
});

test("successful blocks clear only their own totals while failed blocks retain live or saved fallbacks", async () => {
  const doc = previewRefreshDoc();
  const main = doc.pages.home.pageScripts![0].steps[0];
  if (main.kind === "fetch") {
    const made = makeSample(previewRows("saved main", 61));
    main.preview = { sample: made.sample, totals: made.totals };
  }
  const savedAux = makeSample(previewRows("saved aux", 67));
  doc.pages.home.pageScripts![0].steps.push(
    { id: "auxiliary", kind: "fetch", url: "https://example.test/aux", as: "aux", preview: { sample: savedAux.sample, totals: savedAux.totals } },
    { id: "aux-count", kind: "transform", source: "aux.rows", into: "auxTotal", transform: { kind: "length" } },
  );
  const m = mount("design", doc);
  void m.render().refreshData();
  await m.fail(0); await m.finish(1, null, 502);
  assert.equal(m.render().pageVars.total, 61, "initial failure retains saved sample totals");
  assert.equal(m.render().pageVars.auxTotal, 67);
  void m.render().refreshData();
  await m.finish(2, previewRows("main", 35)); await m.finish(3, previewRows("aux", 41));
  void m.render().refreshData();
  await m.finish(4, previewRows("small main", 2)); await m.fail(5);
  assert.equal(m.render().pageVars.total, 2);
  assert.equal(m.render().pageVars.auxTotal, 41, "unrelated network failure retains its live total");
  void m.render().refreshData();
  await m.finish(6, null, 502); await m.finish(7, previewRows("empty aux", 0));
  assert.equal(m.render().pageVars.total, 2, "HTTP failure retains the last successful small response");
  assert.equal(m.render().pageVars.auxTotal, 0);
  assert.equal(m.render().pageVars.response.label, "small main");
  assert.equal(m.render().pageVars.aux.label, "empty aux");
  m.unmount();
});


test("replacing a preview refresh aborts all requests in the old batch", async () => {
  const doc = previewRefreshDoc();
  doc.pages.home.pageScripts![0].steps.push({ id: "aux", kind: "fetch", url: "https://example.test/aux" });
  const m = mount("preview", doc);
  assert.equal(m.requests.length, 2);
  void m.render().refreshData();
  assert.equal(m.requests.length, 4);
  assert.equal(m.requests[0].signal?.aborted, true);
  assert.equal(m.requests[1].signal?.aborted, true);
  assert.equal(m.requests[2].signal?.aborted, false);
  assert.equal(m.requests[3].signal?.aborted, false);
  m.unmount();
});

for (const interruption of ["mode", "page", "unmount"] as const) {
  test(`${interruption} aborts preview requests before they download abandoned data`, () => {
    const m = mount();
    if (interruption === "mode") m.mode("design");
    else if (interruption === "page") m.page("other");
    else m.unmount();
    assert.equal(m.requests[0].signal?.aborted, true);
    if (interruption === "page") assert.equal(m.requests[1].signal?.aborted, false);
    if (interruption !== "unmount") m.unmount();
  });
}

test("the first refresh on another page uses its own field defaults", async () => {
  const doc = previewRefreshDoc();
  doc.nodes["other-query"] = { ...structuredClone(doc.nodes.query), id: "other-query", field: { kind: "input", defaultValue: "other default" } };
  doc.pages.other.children.push("other-query");
  const m = mount("preview", doc);
  m.render().setFieldValues({ q: "home private input" });
  m.page("other");
  assert.equal(new URL(m.requests[1].input.url).searchParams.get("q"), "other default");
  assert.equal(m.render().pageVars.q, "other default");
  m.render().setFieldValues({ q: "other private input" });
  m.page("home");
  assert.equal(new URL(m.requests[2].input.url).searchParams.get("q"), "initial");
  m.unmount();
});


test("a late field callback from the old page cannot overwrite the current page", () => {
  const m = mount();
  const old = m.render();
  m.page("other");
  m.render().setFieldValues({ q: "current" });
  old.setFieldValues({ q: "stale" });
  assert.equal(m.render().pageVars.q, "current");
  m.unmount();
});

test("an obsolete response is skipped before JSON parsing", async () => {
  const m = mount();
  void m.render().refreshData();
  let parsed = false;
  const response = new Response("{}");
  response.json = async () => { parsed = true; return { json: previewRows("stale") }; };
  m.requests[0].finish(response);
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(parsed, false);
  assert.equal(m.render().refreshing, true);
  m.unmount();
});

test("preview variable copies follow same-page script edits and Undo", () => {
  const m = mount("design");
  try {
    assert.equal(m.render().pageVars.copied, undefined);
    const state = useEditor.getState();
    state.updateNode("result", { scripts: [{
      id: "click-copy", trigger: "click", pos: { x: 0, y: 0 },
      steps: [{ id: "copy", kind: "set-var", value: "{response.label}", into: "copied" }],
    }] });
    assert.equal(m.render().pageVars.copied, "home saved");
    state.undo();
    assert.equal(m.render().pageVars.copied, undefined);
  } finally {
    m.unmount();
  }
});

test("preview copies resolve nested destinations and backward references without retrying forever", () => {
  const doc = previewRefreshDoc();
  const copies = [
    ["result", "nested.value"],
    ["nested.value", "later"],
    ["later", "response.label"],
    ["nested.value", "response.rows"],
    ["response.rows.5", "response.label"],
    ["response.label", "response.rows"],
    ["__proto__", "response.label"],
    ["constructor", "response.rows"],
    ["missing", "otherMissing"],
    ["otherMissing", "missing"],
  ];
  doc.nodes.result.scripts = [{
    id: "copies", trigger: "click", pos: { x: 0, y: 0 },
    steps: copies.map(([into, src], i) => ({ id: String(i), kind: "set-var", into, value: `{${src}}` })),
  }];
  // 同期ループが再発してもテストプロセス全体を停止させない。
  const vars = runInNewContext('previewDataVars(doc, "home")', { previewDataVars, doc }, { timeout: 2000 });
  assert.deepEqual(vars.nested.value, [{ id: "saved" }], "first available source wins");
  assert.deepEqual(vars.result, vars.nested.value, "earlier steps see later destinations");
  assert.equal(vars.response.label, "home saved", "keep existing nested values");
  assert.deepEqual(vars.response.rows, [{ id: "saved" }], "invalid array writes stay unapplied");
  assert.equal(Object.getPrototypeOf(vars), Object.prototype);
  assert.ok(Object.hasOwn(vars, "__proto__") && Object.hasOwn(vars, "constructor"));
  assert.equal(vars.__proto__, "home saved");
  assert.deepEqual(vars.constructor, [{ id: "saved" }]);
  assert.ok(!Object.hasOwn(vars, "missing") && !Object.hasOwn(vars, "otherMissing"));
});
