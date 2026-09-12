import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import * as React from "react";
import { generateProject } from "../lib/generator";
import { PAGE_HTML_COMPONENT } from "../lib/generator/templates";
import { deferRunnableScripts } from "../lib/generator/defer-scripts";
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

/** Read only the script fixtures needed for the fake DOM, without treating a
 * tag-matching regex as an HTML sanitizer. The real browser parses this markup. */
function scriptFixtures(html: string): { src: string | null; text: string }[] {
  const lower = html.toLowerCase();
  const result: { src: string | null; text: string }[] = [];
  let index = 0;
  while (index < html.length) {
    const open = lower.indexOf("<script", index);
    if (open < 0) break;
    const next = lower[open + 7];
    if (next && !/\s|>/.test(next)) { index = open + 7; continue; }
    let end = open + 7;
    let quote = "";
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === "'" || char === '"') quote = char;
      else if (char === ">") break;
    }
    if (end === html.length) break;
    const close = lower.indexOf("</script", end + 1);
    if (close < 0) break;
    const closeEnd = lower.indexOf(">", close + 8);
    if (closeEnd < 0) break;
    const attributes = html.slice(open + 7, end);
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
    result.push({ src: src ? (src[1] ?? src[2] ?? "") : null, text: html.slice(end + 1, close) });
    index = closeEnd + 1;
  }
  return result;
}


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
    const element = Component({ html, staticHtml: deferRunnableScripts(html) });
    element.props.ref.current = {
      querySelectorAll: () => scriptFixtures(html).map((part) => ({
        attributes: [
          { name: "type", value: "application/x-tsumu-deferred" },
          { name: "data-tsumu-deferred", value: "" },
          ...(part.src ? [{ name: "src", value: part.src }] : []),
        ],
        getAttribute: () => null,
        text: part.text,
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
  assert.deepEqual(mounted.executed, ["a"]); // 最初のスクリプトも hydration 後に初めて実行する。
  mounted.render(second.props.html);
  assert.deepEqual(mounted.executed, ["a", "b"]);
});

test("hydration runs initial scripts once, even with effect replay; later changes rerun", () => {
  const mounted = mount(true);
  mounted.render(inline("a"), true);
  mounted.render(inline("a")); // 同じHTMLを再描画しても再実行しない。
  assert.deepEqual(mounted.executed, ["a"]);
  for (const name of ["b", "a", "c"]) mounted.render(inline(name));
  assert.deepEqual(mounted.executed, ["a", "b", "a", "c"]);
  mounted.render(inline("c"));
  assert.deepEqual(mounted.executed, ["a", "b", "a", "c"]);
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
  assert.deepEqual(mounted.executed, ["server"]);
  mounted.pending[1].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["server", "new tail"]);
  mounted.render('<script src="/last.js"></script>' + inline("unmounted tail"));
  mounted.unmount();
  mounted.pending[2].onload!();
  await Promise.resolve();
  assert.deepEqual(mounted.executed, ["server", "new tail"]);
});
