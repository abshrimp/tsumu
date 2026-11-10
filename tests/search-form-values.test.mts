import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import * as React from "react";
import { SEARCH_FORM_COMPONENT } from "../lib/generator/templates";
import { REACT_SEARCH_FORM } from "../lib/generator/react-form";

const require = createRequire(import.meta.url);
function mount(source: string) {
  const ref = { current: null as any };
  let effect: (() => void) | undefined;
  let element: any;
  const navigations: string[] = [];
  const window = {
    location: { pathname: "/search", search: "", hash: "", assign: (url: string) => navigations.push(url) },
    addEventListener() {}, removeEventListener() {},
  };
  const field = { name: "q", type: "text", value: "seed", defaultValue: "seed" };
  const checkboxes = ["a", "b", "on"].map((value) => ({ name: "tag", type: "checkbox", value, checked: value === "a", defaultChecked: value === "a" }));
  const radios = ["S", "M"].map((value) => ({ name: "size", type: "radio", value, checked: value === "M", defaultChecked: value === "M" }));
  class Select {
    name = "color";
    multiple = true;
    options = ["red", "green", "blue"].map((value) => ({ value, defaultSelected: value === "red", selected: value === "red" }));
  }
  const select = new Select();
  const upload = { name: "upload", type: "file", get value() { return ""; }, set value(_: string) { throw new Error("File input must not be restored"); } };
  const form = { elements: [field, ...checkboxes, ...radios, select, upload], dispatchEvent() {} };
  class FormData {
    constructor(private form: typeof form) {}
    *entries() {
      for (const input of this.form.elements) {
        if (input instanceof Select) {
          for (const option of input.options) if (option.selected) yield [input.name, option.value];
        } else if (input.type === "file") yield [input.name, new File(["fixture"], "fixture.txt")];
        else if (!("checked" in input) || input.checked) yield [input.name, input.value];
      }
    }
  }
  const overrides: Record<string, unknown> = {
    react: { ...React, useRef: () => ref, useEffect: (fn: typeof effect) => { effect = fn; } },
    "next/navigation": {
      useRouter: () => ({ replace: (url: string) => navigations.push(url) }),
      usePathname: () => window.location.pathname,
      useSearchParams: () => new URLSearchParams(window.location.search),
    },
  };
  const mod = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", "window", "HTMLSelectElement", "FormData", code)(
    (id: string) => overrides[id] ?? require(id), mod, mod.exports, window, Select, FormData
  );
  function render(search: string) {
    window.location.search = search;
    element = mod.exports.default({});
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
  return { render, field, checkboxes, radios, select,
    selected: () => select.options.filter((option) => option.selected).map((option) => option.value),
    checked: () => checkboxes.filter((input) => input.checked).map((input) => input.value),
    submit: () => {
      element.props.onSubmit({ preventDefault() {}, currentTarget: form });
      return new URL(navigations.at(-1)!, "https://example.test/search").searchParams;
    },
  };
}

for (const [format, source] of [["Next.js", SEARCH_FORM_COMPONENT], ["React", REACT_SEARCH_FORM]]) {
  test(`${format} preserves empty fields and repeated checkbox/select values on submission`, () => {
    const view = mount(source);
    view.render("?tab=products&tab=offers&q=old&tag=old&color=old&upload=old");
    view.field.value = "";
    view.checkboxes.forEach((input) => { input.checked = input.value !== "on"; });
    view.select.options.forEach((option) => { option.selected = option.value !== "green"; });
    const params = view.submit();
    assert.deepEqual(params.getAll("tab"), ["products", "offers"]);
    assert.deepEqual(params.getAll("tag"), ["a", "b"]);
    assert.deepEqual(params.getAll("color"), ["red", "blue"]);
    assert.equal(params.get("q"), "");
    assert.equal(params.has("upload"), false);
    view.render("?" + params);
    assert.equal(view.field.value, "");
    assert.deepEqual(view.checked(), ["a", "b"]);
    assert.deepEqual(view.selected(), ["red", "blue"]);
  });

  test(`${format} restores repeated choices exactly and clears stale selections`, () => {
    const view = mount(source);
    for (const [query, checked, selected] of [
      ["?q=&tag=a&tag=b&color=red&color=blue", ["a", "b"], ["red", "blue"]],
      ["?q=&tag=on&color=green", ["on"], ["green"]],
      ["?q=&tag=b&color=blue", ["b"], ["blue"]],
      ["?q=&color=missing", [], []],
      ["?tab=products", ["a"], ["red"]],
    ] as const) {
      view.render(query);
      assert.deepEqual(view.checked(), checked);
      assert.deepEqual(view.selected(), selected);
    }
    assert.equal(view.field.value, "seed");
  });
}
