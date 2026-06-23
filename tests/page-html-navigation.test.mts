import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import * as React from "react";
import { generateProject } from "../lib/generator";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";
import type { SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
function evaluate(source: string, overrides: Record<string, unknown> = {}) {
  const mod = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)(
    (id: string) => id in overrides ? overrides[id] : require(id), mod, mod.exports
  );
  return mod.exports;
}
const inline = (name: string) => `<script>${name}</script>`;

// ブラウザなしで、生成したコンポーネントのフックと DOM 操作を実行する。
// React と同じく、型・キー・位置が同じコンポーネントの ref を描画間で保つ。
function mount(fromServer: boolean) {
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let hydrating = fromServer;
  let effect: (() => (() => void) | undefined) | undefined;
  let previousDeps: unknown[] | undefined;
  let cleanup: (() => void) | undefined;
  const executed: string[] = [];
  const pending: { onload?: () => void; onerror?: () => void }[] = [];
  const hooks = {
    ...React,
    useRef(value: unknown) {
      const index = cursor++;
      return refs[index] ?? (refs[index] = { current: value });
    },
    useSyncExternalStore: () => hydrating,
    useEffect(fn: typeof effect, deps: unknown[]) {
      if (!previousDeps || deps.some((value, index) => value !== previousDeps![index])) {
        effect = fn;
        previousDeps = deps;
      }
    },
  };
  const document = {
    createElement: () => ({
      text: "", src: "", onload: undefined, onerror: undefined,
      setAttribute(name: string, value: string) { (this as any)[name] = value; },
    }),
  };
  // このモジュールだけに document を渡し、グローバル DOM やほかのテストに影響させない。
  const source = PAGE_HTML_COMPONENT.replace('"use client";', '"use client";\nconst document = require("test-document");');
  const Component = evaluate(source, { react: hooks, "test-document": document }).default;
  function render(html: string, replay = false) {
    cursor = 0;
    effect = undefined;
    const element = Component({ html });
    element.props.ref.current = {
      querySelectorAll: () => [...html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)].map((match) => ({
        attributes: match[1] ? [{ name: "src", value: match[1] }] : [],
        text: match[2],
        replaceWith(script: any) {
          if (script.src) pending.push(script);
          else executed.push(script.text);
        },
      })),
    };
    if (effect) {
      cleanup?.();
      cleanup = effect();
      if (replay) {
        cleanup?.();
        cleanup = effect();
      }
    }
    hydrating = false;
  }
  return { render, executed, pending, unmount: () => cleanup?.() };
}

test("query variants reuse the generated PageHtml component position", async () => {
  const doc: SiteDoc = {
    siteName: "Query pages", pages: {}, pageOrder: ["a", "b"], nodes: {}, assets: {},
  };
  for (const name of doc.pageOrder) {
    doc.pages[name] = {
      id: name, name, slug: "", query: name === "a" ? "" : "tab=b",
      title: name, description: "", children: [], customTopHtml: inline(name),
    };
  }
  const { files } = generateProject(doc);
  const PageHtml = () => null;
  const variants = Object.fromEntries(doc.pageOrder.map((_, index) => [
    `./_q/p${index}`, evaluate(files[`app/_q/p${index}.tsx`], { "@/components/PageHtml": PageHtml }),
  ]));
  const page = evaluate(files["app/page.tsx"], variants).default;
  const render = async (query: Record<string, string>) =>
    (await page({ params: Promise.resolve({}), searchParams: Promise.resolve(query) })).props.children[1];
  const first = await render({});
  const second = await render({ tab: "b" });
  assert.equal(first.type, PageHtml);
  assert.equal(first.type, second.type);
  assert.equal(first.key, second.key);
  const mounted = mount(true);
  mounted.render(first.props.html, true);
  assert.deepEqual(mounted.executed, []); // サーバーの HTML のスクリプトはブラウザが実行済み。
  mounted.render(second.props.html);
  assert.deepEqual(mounted.executed, ["b"]);
});

test("hydration and effect replay skip server scripts, but later changes including the initial HTML run", () => {
  const mounted = mount(true);
  mounted.render(inline("a"), true);
  mounted.render(inline("a")); // useSyncExternalStore がブラウザ側の値に切り替わる。
  assert.deepEqual(mounted.executed, []);
  for (const name of ["b", "a", "c"]) mounted.render(inline(name));
  assert.deepEqual(mounted.executed, ["b", "a", "c"]);
  mounted.render(inline("c"));
  assert.deepEqual(mounted.executed, ["b", "a", "c"]);
});

test("client-only mounts still execute scripts on mount and prop changes", () => {
  const mounted = mount(false);
  for (const name of ["a", "b", "a"]) mounted.render(inline(name));
  assert.deepEqual(mounted.executed, ["a", "b", "a"]);
});

test("navigation cancels the old external-script sequence and preserves new script order", async () => {
  const mounted = mount(true);
  mounted.render(inline("server"), true);
  mounted.render('<script src="/old.js"></script>' + inline("old tail"));
  assert.equal(mounted.pending.length, 1);
  mounted.render('<script src="/new.js"></script>' + inline("new tail"));
  assert.equal(mounted.pending.length, 2);
  mounted.pending[0].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, []);
  mounted.pending[1].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["new tail"]);
  mounted.render('<script src="/last.js"></script>' + inline("unmounted tail"));
  mounted.unmount();
  mounted.pending[2].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["new tail"]);
});
