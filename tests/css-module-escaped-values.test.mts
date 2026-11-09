import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { splitCssModule } from "../lib/generator/style-export";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
const postcss = require("postcss");
const local = require("next/dist/compiled/postcss-modules-local-by-default");
const scope = require("next/dist/compiled/postcss-modules-scope");
const compile = (css: string) => postcss([
  local(), scope({ generateScopedName: (name: string) => "scoped_" + name }),
]).process(css, { from: "site.module.css" });

function declarations(css: string): [string, string][] {
  const values: [string, string][] = [];
  postcss.parse(css).walkDecls((decl: { prop: string; value: string; parent: { selector: string } }) => {
    if (decl.parent.selector !== ":export" && decl.prop !== "display") values.push([decl.prop, decl.value]);
  });
  return values;
}

for (const value of [
  String.raw`url(/assets/owner\'s-photo.png)`,
  String.raw`url(/assets/icon\"small.png)`,
  String.raw`url(/assets/icon\{small.png)`,
  String.raw`url(/assets/icon\}small.png)`,
]) {
  for (const responsive of [false, true]) {
    test(`CSS Modules preserves escaped CSS tokens ${value} (responsive=${responsive})`, async () => {
      const rules = `.card { --authored: ${value}; color: red; }\n.after { color: blue; }`;
      const source = responsive ? `@media (max-width: 600px) { ${rules} }` : rules;
      const expected = declarations(source);
      const split = splitCssModule(source);
      assert.ok(split.module.includes(`--authored: ${value};`));
      const result = await compile(split.module);
      assert.deepEqual(declarations(result.css), expected);
      assert.match(result.css, /\.scoped_siteRoot \.after/);
      assert.equal(split.global.trim(), "");
      if (responsive) {
        result.root.walkDecls("--authored", (decl: any) => {
          assert.equal(decl.parent.parent.name, "media");
          assert.equal(decl.parent.parent.params, "(max-width: 600px)");
        });
      }
    });
  }
}

for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
  test(`${framework} CSS Modules exports valid escaped URLs from authored styles`, async () => {
    const image = String.raw`url(/assets/owner\'s-photo.png)`;
    const narrowImage = String.raw`url(/assets/icon\}small.png)`;
    const doc: SiteDoc = {
      siteName: "Escaped CSS", assets: {}, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["card", "after"],
        bodyStyles: { base: { default: { backgroundImage: image } } } } },
      nodes: {
        card: { ...makeBox(), id: "card", customCss: `background-image: ${image};`,
          styles: { sm: { default: { backgroundImage: narrowImage } } } },
        after: { ...makeBox(), id: "after", styles: { base: { default: { color: "blue" } } } },
      },
    };
    const options = { framework, language: "typescript", scope: "project" } as const;
    const original = generateExportProject(doc, { ...options, style: "css" });
    const originalCss = Object.entries(original.files).find(([path]) => path.endsWith("/site.css"))![1];
    const generated = generateExportProject(doc, { ...options, style: "css-modules" });
    const module = Object.entries(generated.files).find(([path]) => path.endsWith("site.module.css"))![1];
    const global = Object.entries(generated.files).find(([path]) => path.endsWith("site-global.css"))![1];
    const compiled = await compile(module);
    assert.deepEqual(declarations(global + compiled.css), declarations(originalCss));
    assert.equal(declarations(compiled.css).filter(([prop]) => prop === "background-image").length, 2);
    assert.ok(global.includes(image));
  });
}
