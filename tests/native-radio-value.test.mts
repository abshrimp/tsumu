import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { generateExportProject } from "../lib/export-formats";
import { nativeDataModule } from "../lib/generator/native-data";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
const context: any = {};
runInNewContext(nativeDataModule().replace(/\bexport /g, "") + "\nglobalThis.resolveText = resolveText;", context);

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  for (const label of ["Plan {choice}", "\\{choice}", "Static & safe"]) test(`${framework} radio submits the displayed resolved label: ${label}`, () => {
    const doc: SiteDoc = {
      siteName: "Radio", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["radio"] } },
      nodes: { radio: { ...makeBox(), id: "radio", type: "field", attrId: "selection", field: { kind: "radio", label, checked: true } } },
    };
    const files = generateExportProject(doc, framework).files;
    const path = framework === "nuxt" ? "app/generated/pages/Page0.vue" : framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
    const source = files[path];
    const input = parse(source).querySelector('input[type="radio"]');
    assert.ok(input);
    const expression = framework === "sveltekit"
      ? /\bvalue=\{(resolveText\([^\n]*?\))\}/.exec(source)?.[1]
      : (() => { const match = /:value="([^"]*)"/.exec(source); return match ? parse(`<div data-code="${match[1]}"></div>`).querySelector("div").getAttribute("data-code") : undefined; })();
    const scope = { choice: 'A & "B"' };
    const actual = expression ? new Function("resolveText", "scope", `return ${expression}`)(context.resolveText, scope) : input.getAttribute("value");
    assert.equal(actual, context.resolveText(label, scope));
  });
}
