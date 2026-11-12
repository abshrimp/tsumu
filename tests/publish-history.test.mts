import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import * as React from "react";
import { useEditor } from "../lib/store";

const require = createRequire(new URL("../components/PublishModal.tsx", import.meta.url));
const source = readFileSync(new URL("../components/PublishModal.tsx", import.meta.url), "utf8") + "\nexport { PublishHistory };";
const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
const conf = {
  site: "example", configured: true, previewEnabled: true,
  production: { repo: "example/site", branch: "main", url: null, error: null },
  test: { repo: "example/site", branch: "preview", url: null, error: null },
};
const history = (label: string) => ({ head: `${label}-head`, commits: [
  { sha: `${label}-old`, message: `${label} commit`, date: "2026-11-01T00:00:00Z", url: `https://example.com/${label}` },
] });

type Instance = { type: unknown; values: any[]; deps: unknown[][]; cleanups: (() => void)[]; alive: boolean };

// 実際のコンポーネントを実行し、フックの状態を、型・位置・key ごとに持つ。
// 通信を保留して、応答が届く順序とタブの操作を決める（外部への通信もブラウザも使わない）。
function fixture(holdWrites = false, holdConfirmation = false) {
  let branch = "main";
  let confirm: ((yes: boolean) => void) | undefined;
  const alerts: any[] = [];
  const instances = new Map<string, Instance>();
  let current: Instance;
  let cursor = 0;
  let dirty = true;
  let tree: any;
  let effects: (() => void)[] = [];
  const changed = (deps: unknown[], previous?: unknown[]) => !previous || deps.some((d, i) => !Object.is(d, previous[i]));
  const hooks = {
    ...React,
    useState(initial: any) {
      const instance = current;
      const index = cursor++;
      if (!(index in instance.values)) instance.values[index] = typeof initial === "function" ? initial() : initial;
      return [instance.values[index], (value: any) => {
        if (!instance.alive) return;
        instance.values[index] = typeof value === "function" ? value(instance.values[index]) : value;
        dirty = true;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in current.values)) current.values[index] = { current: initial };
      return current.values[index];
    },
    useCallback(fn: any, deps: unknown[]) {
      const index = cursor++;
      if (changed(deps, current.deps[index])) {
        current.values[index] = fn;
        current.deps[index] = deps;
      }
      return current.values[index];
    },
    useEffect(fn: () => void | (() => void), deps: unknown[]) {
      const instance = current;
      const index = cursor++;
      if (changed(deps, instance.deps[index])) {
        instance.deps[index] = deps;
        effects.push(() => {
          instance.cleanups[index]?.();
          instance.cleanups[index] = fn() || (() => {});
        });
      }
    },
  };
  const reads: { url: string; target: string; resolve: (data: unknown, status?: number) => void; reject: (error: Error) => void }[] = [];
  const writes: any[] = [];
  const pendingWrites: (() => void)[] = [];
  const request = (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      if (branch !== "main") return Promise.resolve(Response.json({ error: "Destination changed. Close and reopen." }, { status: 409 }));
      return holdWrites ? new Promise<Response>((resolve) => pendingWrites.push(() => resolve(Response.json({ ok: true }))))
        : Promise.resolve(Response.json({ ok: true }));
    }
    return new Promise<Response>((resolve, reject) => reads.push({
      url, target: new URL(url, "https://example.com").searchParams.get("target")!,
      resolve: (data, status = 200) => resolve(Response.json(data, { status })), reject,
    }));
  };
  const mocks: Record<string, unknown> = {
    react: hooks,
    "../lib/export-formats": {}, // 履歴のパネルは、書き出しの生成を使わない。
    "./controls": { Seg: (props: any) => React.createElement("tabs", props) },
    "../lib/dialog": { showConfirm: () => holdConfirmation ? new Promise<boolean>(resolve => { confirm = resolve; }) : Promise.resolve(true), showAlert: async (...args: any[]) => { alerts.push(args); } },
    "../lib/site": {
      siteApi: (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`,
      sitePublishFields: () => ({ site: "example", ...(holdConfirmation ? { dest: { repo: "example/site", branch, previewBranch: "preview" } } : {}) }),
    },
    "../lib/i18n": { tr: (text: string) => text, getLang: () => "en" },
  };
  // 実際の、読み込み中の操作のフックを、このレンダラーのフックの枠と実際のストアで実行する。
  // レンダラーの外で React を呼ばせることはしない。
  hooks.useLayoutEffect = hooks.useEffect;
  const store = { useEditor: Object.assign((select: (state: ReturnType<typeof useEditor.getState>) => unknown) => select(useEditor.getState()), { getState: useEditor.getState }) };
  const pendingCode = transformSync(readFileSync(new URL("../lib/use-pending-import.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
  const pendingModule = { exports: {} as any };
  new Function("require", "module", "exports", pendingCode)(
    (name: string) => name === "react" ? hooks : name === "./store" ? store : require(name), pendingModule, pendingModule.exports,
  );
  mocks["../lib/use-pending-import"] = pendingModule.exports;
  mocks["../lib/store"] = store;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "fetch", code)(
    (name: string) => name in mocks ? mocks[name] : require(name), module, module.exports, request,
  );
  const Root = module.exports.PublishHistory;

  function render() {
    dirty = false;
    effects = [];
    const seen = new Set<string>();
    function visit(element: any, path: string): any {
      if (element == null || typeof element !== "object") return element;
      if (Array.isArray(element)) return element.map((child, i) => visit(child, `${path}.${i}`));
      if (typeof element.type === "function" && !/lucide/.test(element.type.displayName ?? "")) {
        path += `:${element.key ?? ""}`;
        seen.add(path);
        let instance = instances.get(path);
        if (!instance || instance.type !== element.type) {
          if (instance) instance.alive = false;
          instance = { type: element.type, values: [], deps: [], cleanups: [], alive: true };
          instances.set(path, instance);
        }
        current = instance;
        cursor = 0;
        return visit(element.type(element.props), `${path}.render`);
      }
      return { ...element, props: { ...element.props, children: visit(element.props?.children, `${path}.children`) } };
    }
    tree = visit(React.createElement(Root, { conf, onDone() {} }), "root");
    for (const [path, instance] of instances) {
      if (seen.has(path)) continue;
      instance.alive = false;
      instance.cleanups.forEach((cleanup) => cleanup());
      instances.delete(path);
    }
    for (const effect of effects) effect();
  }
  function flush() {
    let turns = 0;
    while (dirty) {
      assert.ok(turns++ < 20, "render must settle");
      render();
    }
  }
  function elements(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap((child) => elements(child));
    return [element, ...elements(element.props?.children)];
  }
  const text = (value: any): string => value == null || typeof value === "boolean" ? "" :
    typeof value !== "object" ? String(value) : Array.isArray(value) ? value.map(text).join("") : text(value.props?.children);
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); flush(); };
  flush();
  return {
    reads, writes, pendingWrites, settle, alerts,
    changeBranch() { branch = "release"; },
    confirm() { assert.ok(confirm); confirm(true); },
    rollbackDisabled: () => elements(tree).find((e) => e.type === "button" && text(e) === "Restore site")?.props.disabled,
    text: () => text(tree),
    select(target: string) { elements(tree).find((e) => e.type === "tabs").props.onChange(target); flush(); },
    async restore() {
      const button = elements(tree).find((e) => e.type === "button" && text(e) === "Restore edits");
      assert.ok(button, "a restore button must be present");
      button.props.onClick();
      await settle();
    },
    async rollback() {
      const button = elements(tree).find((e) => e.type === "button" && text(e) === "Restore site");
      assert.ok(button, "a rollback button must be present");
      button.props.onClick();
      await settle();
    },
  };
}

test("history tabs ignore older responses and roll back only a commit from the displayed target", async () => {
  const f = fixture();
  assert.equal(f.reads[0].target, "production");
  f.select("test");
  f.reads[1].resolve(history("test"));
  await f.settle();
  assert.match(f.text(), /test commit/);
  f.reads[0].resolve(history("production"));
  await f.settle();
  await f.rollback();
  assert.deepEqual(f.writes, [{ site: "example", target: "test", sha: "test-old", expectedHead: "test-head", expected: { site: "example", target: "test", repo: "example/site", branch: "preview", productionBranch: "main" } }]);
  assert.equal(f.reads[2].target, "test", "a successful rollback refreshes its own history");
  f.reads[2].resolve(history("updated-test"));
  await f.settle();
  assert.doesNotMatch(f.text(), /production commit/);
  assert.match(f.text(), /updated-test commit/);
});

test("rapid target changes cannot show an obsolete response from an earlier visit to the same tab", async () => {
  const f = fixture();
  f.select("test");
  f.select("production");
  assert.deepEqual(f.reads.map((r) => r.target), ["production", "test", "production"]);
  f.reads[2].resolve(history("latest-production"));
  await f.settle();
  f.reads[1].resolve(history("test"));
  f.reads[0].resolve(history("old-production"));
  await f.settle();
  assert.match(f.text(), /latest-production commit/);
  assert.doesNotMatch(f.text(), /test commit|old-production commit/);
});

test("late failures from another target do not hide the active target's history", async () => {
  const f = fixture();
  f.select("test");
  f.reads[1].resolve(history("test"));
  await f.settle();
  f.reads[0].reject(new Error("本番の履歴を読み込めませんでした"));
  await f.settle();
  assert.match(f.text(), /test commit/);
  assert.doesNotMatch(f.text(), /本番の履歴を読み込めませんでした/);
});


test("switching targets during rollback keeps every target disabled until the operation finishes", async () => {
  const f = fixture(true);
  f.reads[0].resolve(history("production"));
  await f.settle();
  await f.rollback();
  assert.equal(f.rollbackDisabled(), true);
  f.select("test");
  f.reads[1].resolve(history("test"));
  await f.settle();
  assert.equal(f.rollbackDisabled(), true);
  f.select("production");
  f.reads[2].resolve(history("new-production"));
  await f.settle();
  assert.equal(f.rollbackDisabled(), true, "remounting the original target must not unlock rollback");
  f.pendingWrites[0]();
  await f.settle();
  assert.equal(f.reads[3].target, "production");
  f.reads[3].resolve(history("old-operation-refresh"));
  await f.settle();
  assert.equal(f.rollbackDisabled(), false);
  assert.match(f.text(), /new-production commit/);
  assert.doesNotMatch(f.text(), /old-operation-refresh commit/);
});


test("rollback confirmation keeps the displayed identity and head when Home settings change", async () => {
  const f = fixture(false, true);
  const query = new URL(f.reads[0].url, "https://example.com").searchParams;
  assert.deepEqual(JSON.parse(query.get("expected")!), { site: "example", target: "production", repo: "example/site", branch: "main", productionBranch: "main" });
  f.reads[0].resolve(history("production")); await f.settle();
  await f.rollback(); assert.equal(f.writes.length, 0);
  f.changeBranch(); f.confirm(); await f.settle();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].dest.branch, "release");
  assert.equal(f.writes[0].expected.branch, "main");
  assert.equal(f.writes[0].expectedHead, "production-head");
  assert.equal(f.reads.length, 1, "a conflicted rollback is not automatically retried or refreshed into another destination");
  assert.match(f.text(), /Destination changed/);
  assert.ok(f.alerts.every(args => args[1].title !== "Rolled back"));
});


test("real pending-import cleanup prevents a previous target's delayed restore", async () => {
  const f = fixture();
  f.reads[0].resolve(history("production")); await f.settle();
  await f.restore();
  const before = useEditor.getState().doc;
  f.select("test");
  f.reads[2].resolve(history("test")); await f.settle();
  f.reads[1].resolve({ ...before, siteName: "Obsolete backup" }); await f.settle();
  assert.equal(useEditor.getState().doc, before);
  assert.match(f.text(), /test commit/);
  assert.equal(f.rollbackDisabled(), false);
  assert.deepEqual(f.alerts, []);
});
