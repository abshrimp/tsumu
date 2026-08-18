import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { generateExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";
const doc: SiteDoc = { siteName: "Languages", lang: "ja", assets: {}, nodes: {}, pageOrder: ["home", "en"], pages: {
  home: { id: "home", name: "Home", title: "Home", description: "Japanese", slug: "", children: [] },
  en: { id: "en", name: "English", title: "English", description: "English page", lang: "en-GB", slug: "english", children: [] },
} };
test("Nuxt reactive useHead sets document language on SSR and route changes", () => {
  const files = generateExportProject(doc, "nuxt").files;
  const source = files["app/pages/index.vue"];
  const callback = /useHead\((\(\) => \(\{[\s\S]*?\}\))\);/.exec(source)?.[1];
  assert.ok(callback);
  const selected: any = { value: { title: "Home", description: "Japanese", language: "ja" } };
  const head = runInNewContext(callback, { selected });
  assert.equal(head().htmlAttrs?.lang, "ja");
  selected.value = { title: "English", description: "English page", language: "en-GB" };
  assert.equal(head().htmlAttrs?.lang, "en-GB");
  selected.value = null;
  assert.equal(head().htmlAttrs?.lang, "ja");
});
test("Svelte SSR hook selects and escapes the page language without duplicate static metadata", async () => {
  const files = generateExportProject(doc, "sveltekit").files;
  assert.ok(files["src/hooks.server.js"]);
  const routes: any = { URLSearchParams };
  runInNewContext(files["src/lib/site-routes.js"].replace(/\bexport /g, "") + "\nglobalThis.selectPage = selectPage;", routes);
  const context: any = { selectPage: routes.selectPage };
  runInNewContext(files["src/hooks.server.js"].replace(/^import .*;\n/m, "").replace(/\bexport /g, "") + "\nglobalThis.handle = handle;", context);
  for (const [path, lang] of [["/", "ja"], ["/english", "en-GB"], ["/missing", "ja"]]) {
    const html = await context.handle({ event: { url: new URL(path, "https://example.com") },
      resolve: (_: unknown, options: any) => options.transformPageChunk({ html: files["src/app.html"], done: true }) });
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(!html.includes("%page.language%"));
    assert.ok(!html.includes("<title>"));
    assert.ok(!html.includes('name="description"'));
  }
  context.selectPage = () => ({ language: 'en" onload="bad<&' });
  const escaped = await context.handle({ event: { url: new URL("https://example.com") }, resolve: (_: unknown, options: any) => options.transformPageChunk({ html: files["src/app.html"] }) });
  assert.ok(escaped.includes('lang="en&quot; onload=&quot;bad&lt;&amp;"'));
});
test("Svelte updates html lang when navigation replaces page data", () => {
  const files = generateExportProject(doc, "sveltekit").files;
  const source = files["src/routes/+page.svelte"];
  const effect = /\$effect\((\(\) => \{ document\.documentElement\.lang = data\.language; \})\);/.exec(source)?.[1];
  assert.ok(effect);
  const context: any = { data: { language: "ja" }, document: { documentElement: { lang: "" } } };
  const apply = runInNewContext(effect, context);
  apply(); assert.equal(context.document.documentElement.lang, "ja");
  context.data = { language: "en-GB" };
  apply(); assert.equal(context.document.documentElement.lang, "en-GB");
});
