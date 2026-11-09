import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { generateExportProject } from "../lib/export-formats";
import { nativeDataModule } from "../lib/generator/native-data";
import { fieldInitialValue } from "../lib/fields";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const context: any = {};
runInNewContext(nativeDataModule().replace(/\bexport /g, "") + "\nglobalThis.resolveText = resolveText;", context);
const cases: Array<{ options: string[]; defaultValue: string; scope: Record<string, unknown>; row?: Record<string, unknown>; expectedIndex?: number }> = [
  { options: ["A", "B"], defaultValue: "{choice}", scope: { choice: "B" } },
  { options: ["A", "{second}"], defaultValue: "B", scope: { second: "B" } },
  { options: ["A", "{second}"], defaultValue: "{choice}", scope: { second: "B", choice: "B" } },
  { options: ["A", "{missing}"], defaultValue: "{choice}", scope: {} },
  { options: ["{first}", "B"], defaultValue: "{choice}", scope: { first: "Fallback", choice: "missing" } },
  { options: ["A", "\\{literal}"], defaultValue: "\\{literal}", scope: {} },
  { options: ["A", "B"], defaultValue: "B", scope: {} },
  { options: ["{first}", "{second}"], defaultValue: "{choice}", scope: { first: "B", second: "B", choice: "B" }, expectedIndex: 0 },
  { options: ["B", "A", "B"], defaultValue: "B", scope: {}, expectedIndex: 0 },
  { options: [], defaultValue: "{choice}", scope: { choice: "B" }, expectedIndex: -1 },
  { options: ["A", "{second}"], defaultValue: "{choice}", scope: { choice: "A", second: "Wrong" }, row: { choice: "B", second: "B" }, expectedIndex: 1 },
];
for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  cases.forEach((sample, i) => test(`${framework}: select resolves default and options before selecting (${i})`, () => {
    const field = { kind: "select" as const, options: sample.options, defaultValue: sample.defaultValue };
    const doc: SiteDoc = {
      siteName: "Select", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["select"] } },
      nodes: { select: { ...makeBox(), id: "select", type: "field", field } },
    };
    if (sample.row) {
      doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: ["select"] };
      doc.pages.p.children = ["list"];
    }
    const files = generateExportProject(doc, framework).files;
    const path = framework === "nuxt" ? "app/generated/pages/Page0.vue" : framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
    const source = files[path];
    const optionTags = [...source.matchAll(/<option\b([^>]*)>/g)].map(m => m[1]);
    const evaluate = (code: string) => runInNewContext(code, { ...context, scope: sample.scope, row0: sample.row });
    const selectedFlags = optionTags.map(attrs => {
      const dynamic = framework === "sveltekit" ? /selected=\{(.*)\}/.exec(attrs)?.[1] : /:selected="([^"]*)"/.exec(attrs)?.[1];
      if (dynamic) {
        const decoded = framework === "sveltekit" ? dynamic : parse(`<div data-code="${dynamic}"></div>`).querySelector("div").getAttribute("data-code");
        return evaluate(decoded);
      }
      return /\bselected\b/.test(attrs);
    });
    const selected = selectedFlags.indexOf(true);
    assert.equal(selectedFlags.filter(Boolean).length, sample.options.length ? 1 : 0, "select exactly one option");
    if (sample.expectedIndex !== undefined) assert.equal(selected, sample.expectedIndex);
    if (!sample.options.length) return;
    assert.ok(selected >= 0, "must select a matching option or first fallback");
    const scope = { ...sample.scope, ...sample.row };
    assert.equal(context.resolveText(sample.options[selected], scope), fieldInitialValue(field, scope));
  }));
}
