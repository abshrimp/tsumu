import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import * as React from "react";
import { SEARCH_FORM_COMPONENT } from "../lib/generator/templates";
import { REACT_SEARCH_FORM } from "../lib/generator/react-form";

const require = createRequire(import.meta.url);
for (const [framework, source] of [["nextjs", SEARCH_FORM_COMPONENT], ["react", REACT_SEARCH_FORM]]) {
  for (const selected of ["on", "off", "missing"]) {
    test(`${framework} restores only the radio matching query value ${selected}`, () => {
      const radios = ["on", "off"].map(value => ({ name: "mode", type: "radio", value, checked: false, defaultChecked: false }));
      for (const radio of radios) {
        let checked = false;
        Object.defineProperty(radio, "checked", { get: () => checked, set(value) { checked = value; if (value) for (const other of radios) if (other !== radio) other.checked = false; } });
      }
      const form = { elements: radios, dispatchEvent() {} };
      const ref = { current: form };
      const effects: (() => void)[] = [];
      const hooks = { ...React, useRef: () => ref, useEffect: (fn: () => void) => effects.push(fn) };
      const window = { location: { pathname: "/", search: `?mode=${selected}` }, addEventListener() {}, removeEventListener() {} };
      const module = { exports: {} as any };
      const compiled = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
      new Function("require", "module", "exports", "window", "HTMLSelectElement", compiled)(
        (id: string) => id === "react" ? hooks : id === "next/navigation" ? {
          usePathname: () => "/", useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({}),
        } : require(id), module, module.exports, window, class Select {},
      );
      const node = module.exports.default({ children: null });
      const visit = (item: any): void => {
        if (!item) return;
        if (Array.isArray(item)) return item.forEach(visit);
        if (typeof item.type === "function") visit(item.type(item.props));
        else visit(item.props?.children);
      };
      visit(node);
      for (const effect of effects) effect();
      assert.deepEqual(radios.filter(radio => radio.checked).map(radio => radio.value), selected === "missing" ? [] : [selected]);
    });
  }
}
