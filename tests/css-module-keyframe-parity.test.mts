import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { splitCssModule } from "../lib/generator/style-export";
const require = createRequire(import.meta.url);
const postcss = require("postcss");
const local = require("next/dist/compiled/postcss-modules-local-by-default");
const scope = require("next/dist/compiled/postcss-modules-scope");
for (const prefix of ["", "-webkit-"]) test(`CSS Modules keeps ${prefix}keyframes paired with compiled animation names`, async () => {
  const source = `body { animation: shared 2s; }
.card { animation: shared 1s ease, other 2s linear; }
@${prefix}keyframes shared { from { opacity: 0; } to { opacity: 1; } }
@${prefix}keyframes other { from { transform: translateX(2px); } to { transform: none; } }`;
  const split = splitCssModule(source);
  const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(split.module, { from: "site.module.css" });
  const names: string[] = [];
  result.root.walkAtRules(/keyframes$/, (rule: any) => names.push(rule.params));
  assert.ok(names.includes("scoped_shared"), "module animation must have the matching local definition");
  assert.ok(names.includes("scoped_other"));
  assert.match(result.css, /animation: scoped_shared 1s ease, scoped_other 2s linear/);
  assert.ok(split.global.includes(`@${prefix}keyframes shared`), "global body animation retains its original definition");
});
test("responsive module keyframes retain their enclosing media condition", async () => {
  const split = splitCssModule('@media (max-width:600px) { .card { animation-name: narrow; } @keyframes narrow { to { opacity: 0; } } }');
  const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(split.module, { from: "site.module.css" });
  let checked = false;
  result.root.walkAtRules("keyframes", (rule: any) => {
    assert.equal(rule.params, "scoped_narrow");
    assert.equal(rule.parent.name, "media");
    assert.equal(rule.parent.params, "(max-width:600px)");
    checked = true;
  });
  assert.ok(checked);
});

test("an authored motion survives the actual CSS Modules export pipeline", async () => {
  const { generateExportProject } = await import("../lib/export-formats");
  const { makeBox } = await import("../lib/presets");
  const doc = { siteName: "Motion", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["box"] } },
    nodes: { box: { ...makeBox(), id: "box", motions: [{ id: "fade", trigger: "load" as const,
      keyframes: "custom", customKeyframes: "from { opacity: 0; } to { opacity: 1; }", duration: 1, delay: 0, easing: "ease" }] } },
  };
  for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
    const { files } = generateExportProject(doc, { framework, language: "typescript", style: "css-modules", scope: "project" });
    const module = Object.entries(files).find(([path]) => path.endsWith("site.module.css"))![1];
    const result = await postcss([local(), scope({ generateScopedName: (name: string) => "scoped_" + name })]).process(module, { from: "site.module.css" });
    const names: string[] = [];
    result.root.walkAtRules("keyframes", (rule: any) => names.push(rule.params));
    assert.ok(names.length > 0, framework);
    let matched = false;
    result.root.walkDecls(/^animation(?:-name)?$/, (decl: any) => {
      if (names.some(name => decl.value.includes(name))) matched = true;
    });
    assert.ok(matched, framework + " animation references its emitted scoped keyframes");
  }
});
