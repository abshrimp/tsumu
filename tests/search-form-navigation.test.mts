import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import * as React from "react";
import { SEARCH_FORM_COMPONENT } from "../lib/generator/templates";
import { searchFormFiles } from "./helpers/search-form-navigation";

const require = createRequire(import.meta.url);
function evaluate(source: string, overrides: Record<string, unknown> = {}) {
  const mod = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)(
    (id: string) => id in overrides ? overrides[id] : require(id), mod, mod.exports
  );
  return mod.exports;
}

// 型・キー・位置が同じフォームは再利用される。入力の現在値と ref を描画間で保持する。
function mount() {
  const ref = { current: null as any };
  let effect: (() => void) | undefined;
  let previousDeps: unknown[] | undefined;
  let element: any;
  const window = { location: { pathname: "/search", search: "" }, addEventListener() {}, removeEventListener() {} };
  const hooks = {
    ...React,
    useRef: () => ref,
    useEffect(fn: typeof effect, deps: unknown[]) {
      if (!previousDeps || deps.some((value, index) => value !== previousDeps![index])) {
        effect = fn;
        previousDeps = deps;
      }
    },
  };
  const field = { name: "q", type: "text", value: "", defaultValue: "default" };
  const textarea = { name: "note", type: "textarea", value: "", defaultValue: "initial note" };
  const checkbox = { name: "stock", type: "checkbox", value: "true", checked: true, defaultChecked: true };
  const radios = ["S", "M"].map((value) => ({ name: "size", type: "radio", value, checked: value === "M", defaultChecked: value === "M" }));
  class Select {
    name = "sort";
    options = ["A", "B", "C"].map((value) => ({ value, defaultSelected: value === "B", selected: value === "B" }));
  }
  const select = new Select();
  // 選択状態は実DOM同様に1つだけにする。
  for (const option of select.options) {
    let selected = option.selected;
    Object.defineProperty(option, "selected", {
      get: () => selected,
      set: (value) => { selected = value; if (value) for (const other of select.options) if (other !== option) other.selected = false; },
    });
  }
  const events: Event[] = [];
  const form = { elements: [field, textarea, checkbox, ...radios, select], dispatchEvent: (event: Event) => events.push(event) };
  const replacements: string[] = [];
  class FormData {
    constructor(private form: typeof form) {}
    *entries() {
      for (const input of this.form.elements) {
        if (input instanceof Select) yield [input.name, input.options.find((o) => o.selected)?.value ?? ""];
        else if (!("checked" in input) || input.checked) yield [input.name, input.value];
      }
    }
  }
  const source = SEARCH_FORM_COMPONENT.replace('"use client";', '"use client";\nconst { window, HTMLSelectElement, FormData } = require("test-dom");');
  const Component = evaluate(source, {
    react: hooks,
    "next/navigation": {
      useRouter: () => ({ replace: (url: string) => replacements.push(url) }),
      usePathname: () => window.location.pathname,
      useSearchParams: () => new URLSearchParams(window.location.search),
    },
    "test-dom": { window, HTMLSelectElement: Select, FormData },
  }).default;
  function render(search: string, pathname = "/search") {
    effect = undefined;
    window.location = { search, pathname };
    element = Component({ children: React.createElement("input", { name: "q" }) });
    element.props.ref.current = form;
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node.type === "function") visit(node.type(node.props));
      else visit(node.props?.children);
    };
    visit(element.props.children);
    effect?.();
  }
  return { render, field, textarea, checkbox, radios, select, events, replacements,
    submit: () => element.props.onSubmit({ preventDefault() {}, currentTarget: form }),
  };
}

test("generated search results reuse the same SearchForm on query navigation", async () => {
  const files = searchFormFiles();
  const Form = () => null;
  const Page = evaluate(files["app/search/page.tsx"], {
    "@/components/SearchForm": Form,
    "next/link": () => null,
    "@/lib/vars": require("../lib/vars"),
    "@/lib/safe-fetch": {
      fetchPublic: async (url: string) => new Response(JSON.stringify({ q: new URL(url).searchParams.get("q") })),
      readTextLimited: (response: Response) => response.text(),
    },
  }).default;
  const first = await Page({ searchParams: Promise.resolve({ q: "first" }) });
  const next = await Page({ searchParams: Promise.resolve({ q: "next" }) });
  assert.equal(first.props.children[2].props.children, "API: first");
  assert.equal(next.props.children[2].props.children, "API: next");
  assert.equal(first.props.children[1].type, Form);
  assert.equal(next.props.children[1].type, Form);
  assert.equal(first.props.children[1].key, next.props.children[1].key);
});

test("search fields follow query links repeatedly without a popstate event", () => {
  const mounted = mount();
  for (const q of ["first", "next", "日本語 & +", "first"]) {
    mounted.render(`?q=${encodeURIComponent(q)}`);
    assert.equal(mounted.field.value, q);
  }
});

test("Back/Forward restores all field types and retains unrelated query parameters", () => {
  const mounted = mount();
  const first = "?tab=products&q=first&note=one&stock=true&size=S&sort=C";
  const second = "?tab=products&q=second&note=two&size=M&sort=A";
  for (const search of [first, second, first, second]) {
    mounted.render(search);
    const params = new URLSearchParams(search);
    assert.equal(mounted.field.value, params.get("q"));
    assert.equal(mounted.textarea.value, params.get("note"));
    assert.equal(mounted.checkbox.checked, params.has("stock"));
    assert.equal(mounted.radios.find((r) => r.checked)?.value, params.get("size"));
    assert.equal(mounted.select.options.find((o) => o.selected)?.value, params.get("sort"));
  }
  mounted.field.value = "日本語 & +";
  mounted.submit();
  const submitted = new URLSearchParams(mounted.replacements.at(-1));
  assert.equal(submitted.get("tab"), "products");
  assert.equal(submitted.get("q"), "日本語 & +");
  assert.equal(submitted.get("note"), "two");
  assert.equal(submitted.get("size"), "M");
  assert.equal(submitted.get("sort"), "A");
  assert.equal(submitted.has("stock"), false);
});

test("same-query renders and submissions do not erase in-progress edits", () => {
  const mounted = mount();
  const query = "?q=first&note=initial+note&stock=true&size=M&sort=B";
  mounted.render(query);
  mounted.submit();
  assert.equal(mounted.replacements[0], query);
  mounted.field.value = "still typing";
  mounted.render(query);
  assert.equal(mounted.field.value, "still typing");
  assert.equal(mounted.events.length, 1);
});

test("URL changes without a field value restore the current form defaults", () => {
  const mounted = mount();
  mounted.render("?q=first&note=typed&size=S&sort=C");
  mounted.field.defaultValue = "changed default";
  mounted.textarea.defaultValue = "changed note";
  mounted.render("?tab=other");
  assert.equal(mounted.field.value, "changed default");
  assert.equal(mounted.textarea.value, "changed note");
  assert.equal(mounted.checkbox.checked, true);
  assert.equal(mounted.radios.find((r) => r.checked)?.value, "M");
  assert.equal(mounted.select.options.find((o) => o.selected)?.value, "B");
});


test("changing paths with the same query restores the destination form", () => {
  const mounted = mount();
  mounted.render("?q=first", "/search");
  mounted.field.value = "unfinished edit";
  mounted.render("?q=first", "/other-search");
  assert.equal(mounted.field.value, "first");
});
