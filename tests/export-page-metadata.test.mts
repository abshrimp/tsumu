import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import type { Page, SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");
const page = (id: string, slug: string, fields: Partial<Page> = {}): Page => ({
  id, name: id, title: id, description: "About " + id, slug, children: [], ...fields,
});
const doc: SiteDoc = {
  schemaVersion: 1, siteName: "Journal", lang: "en", siteUrl: "https://journal.example",
  ogImage: { url: "https://images.example/default.png" }, nodes: {},
  assets: { winter: { id: "winter", name: "winter.png", mimeType: "image/png", width: 16, height: 16,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=" } },
  pageOrder: ["fr", "home", "base", "private", "missing"],
  pages: {
    fr: page("fr", "news/winter", { title: 'Hiver <Paris>', lang: "fr", query: "edition=fr", noindex: true, ogImage: { assetId: "winter" } }),
    home: page("home", "", { ogImage: { url: "https://images.example/home.png" } }),
    base: page("base", "news/winter", { lang: "de" }),
    private: page("private", "private", { noindex: true }),
    missing: page("missing", "404", { lang: "es", ogImage: { url: "https://images.example/missing.png" } }),
  },
};
const uploaded = "https://journal.example/assets/winter.png";

function metadata(html: string) {
  const root = parse(html);
  const meta = (selector: string) => root.querySelectorAll("head " + selector).map(
    (element: { getAttribute(name: string): string }) => element.getAttribute("content"));
  return { title: root.querySelector("title")?.text, lang: root.querySelector("html")?.getAttribute("lang"),
    description: meta('meta[name="description"]'), image: meta('meta[property="og:image"]'), robots: meta('meta[name="robots"]') };
}

test("HTML query variants use the unconditional head and carry each variant's own sharing image", async () => {
  const { files } = generateExportProject(doc, "html");
  const html = files["news/winter/index.html"];
  assert.deepEqual(metadata(html), { title: "base", lang: "de", description: ["About base"], image: ["https://images.example/default.png"], robots: [] });
  const variants = JSON.parse(parse(html).querySelector("script[data-page-variants]").textContent);
  assert.equal(variants.find((variant: { lang: string }) => variant.lang === "fr").ogImage, uploaded);
  const single = await prepareExportProject(doc, { framework: "single-html", language: "javascript", style: "css", scope: "page", pageId: "fr" });
  assert.deepEqual(metadata(single.files["index.html"]), { title: "Hiver <Paris>", lang: "fr", description: ["About fr"], image: [uploaded], robots: ["noindex,nofollow"] });
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(framework + " exports page sharing metadata through its actual route selection", () => {
    const { files } = generateExportProject(doc, framework);
    const path = { vue: "src/", nuxt: "app/generated/", sveltekit: "src/lib/" }[framework] + "site-routes.js";
    const module = { exports: {} as { selectPage(path: string, query: string): Page & { ogImage: string; language: string } } };
    new Function("module", "exports", transformSync(files[path], { format: "cjs" }).code)(module, module.exports);
    const select = (query: string) => module.exports.selectPage("/news/winter", query);
    for (const [query, title, image, language, noindex] of [
      ["", "base", "https://images.example/default.png", "de", false],
      ["edition=fr", "Hiver <Paris>", uploaded, "fr", true],
    ] as const) {
      const selected = select(query);
      assert.deepEqual([selected.title, selected.ogImage, selected.language, selected.noindex], [title, image, language, noindex]);
    }
  });
}

for (const target of ["production", "test"] as const) {
  test("React Vite fixed route documents preserve transformed assets, custom head, and " + target + " metadata", async () => {
    const authored = '<!--page-head--><meta name="author" content="Editor"><!--/page-head-->';
    const { files } = await prepareExportProject({ ...doc, customHeadHtml: authored }, "react", target);
    const source = transformSync(files["vite.config.ts"], { loader: "ts", format: "cjs",
      define: { "import.meta.url": JSON.stringify("file:///vite.config.ts") } }).code;
    const config = { exports: {} as any };
    new Function("module", "exports", "require", source)(config, config.exports,
      (id: string) => id === "vite" ? { defineConfig: (value: unknown) => value } : require(id));
    const plugin = config.exports.default.plugins.find((item: { name: string }) => item.name === "route-documents");
    const built = files["index.html"].replace('src="/src/main.tsx"', 'src="/assets/compiled.js"')
      .replace("</head>", '<link rel="stylesheet" href="/assets/compiled.css"></head>');
    const output = new Map<string, string>();
    plugin.generateBundle.handler.call({ emitFile: (file: { fileName: string; source: string }) => output.set(file.fileName, file.source) },
      {}, { "index.html": { type: "asset", source: built } });
    const preview = target === "test" ? ["noindex, nofollow, noarchive, nosnippet, noimageindex"] : [];
    assert.deepEqual(metadata(built), { title: "home | Journal", lang: "en", description: ["About home"], image: ["https://images.example/home.png"], robots: preview });
    const nested = output.get("news/winter/index.html")!;
    assert.deepEqual(metadata(nested), { title: "base | Journal", lang: "de", description: ["About base"], image: ["https://images.example/default.png"], robots: preview });
    assert.ok(nested.includes(authored));
    assert.ok(nested.includes('src="/assets/compiled.js"') && nested.includes('href="/assets/compiled.css"'));
    const blocked = target === "test" ? preview : ["noindex, nofollow"];
    assert.deepEqual(metadata(output.get("private/index.html")!).robots, blocked);
    assert.deepEqual(metadata(output.get("404.html")!), { title: "missing | Journal", lang: "es", description: ["About missing"], image: ["https://images.example/missing.png"], robots: blocked });
  });
}
