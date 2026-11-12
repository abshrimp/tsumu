import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { generateExportProject } from "../lib/export-formats";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { pageHrefOf, pageQueryVars } from "../lib/vars";
import { loadGeneratedRoute } from "./helpers/generated-route";

const require = createRequire(import.meta.url);
const queries = ["", "q=first&q=last", "q=last&q=first", "q=first&q=later&lang=ja",
  "=ignored&empty=", "__proto__=first&__proto__=last", "constructor=first&constructor=last",
  "%71=hello+world&q=later", "tag=&tag=later"];
const doc: SiteDoc = { siteName: "Query parity", nodes: {}, assets: {}, pages: {}, pageOrder: [] };
for (const [i, query] of queries.entries()) {
  const id = "variant" + i;
  doc.nodes[id] = { ...makeText(id), id };
  doc.pages[id] = { id, name: id, title: id, description: "Description " + id,
    slug: "", query, children: [id] };
  doc.pageOrder.push(id);
}
const original = structuredClone(doc);
const visits: [string, string][] = [
  ["q=first&q=last", "variant1"], ["q=last&q=first", "variant2"],
  ["q=first&q=other&lang=ja", "variant3"], ["empty=", "variant4"],
  ["=different&empty=", "variant4"], ["__proto__=first", "variant5"],
  ["__proto__=last", "variant0"], ["constructor=first", "variant6"],
  ["q=hello%20world&q=other", "variant7"], ["tag=", "variant8"],
  ["tag=later&tag=", "variant0"], ["q=missing", "variant0"], ["", "variant0"],
];

function nativeSelection(files: Record<string, string>, path: string, query: string) {
  const module = { exports: {} as any };
  const code = transformSync(files[path], { format: "cjs" }).code;
  new Function("module", "exports", "URLSearchParams", code)(module, module.exports, URLSearchParams);
  return module.exports.selectPage("/", query)?.id;
}

function reactSelection(files: Record<string, string>, query: string) {
  const module = { exports: {} as any };
  const document = { title: "", documentElement: { lang: "" }, querySelector: () => null };
  const code = transformSync(files["src/App.tsx"], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
  // ルーターは生成したコードそのものを実行し、関係の無いページの本文と副作用だけを置き換える。
  new Function("require", "module", "exports", "window", "document", code)((name: string) => {
    if (name === "react") return { useEffect: (fn: () => void, deps: unknown[]) => { if (deps.length) fn(); } };
    const page = /^\.\/pages\/Page(\d+)$/.exec(name);
    if (page) return { __esModule: true, default: () => "variant" + page[1] };
    if (name === "./NotFound") return { __esModule: true, default: () => "not-found" };
    return require(name);
  }, module, module.exports, { location: { pathname: "/", search: "?" + query } }, document);
  const id = renderToStaticMarkup(module.exports.default());
  assert.equal(document.title, id + " | Query parity");
  return id;
}

function htmlSelection(files: Record<string, string>, query: string) {
  const config = /<script type="application\/json" data-page-variants>([\s\S]*?)<\/script>/.exec(files["index.html"]);
  assert.ok(config);
  const host = { innerHTML: "", querySelectorAll: () => [] };
  const document = { title: "", documentElement: {}, currentScript: { getAttribute: () => "[]" },
    querySelector: (selector: string) => selector === "[data-variant-root]" ? host :
      selector === "script[data-page-variants]" ? { textContent: config[1] } : null };
  new Function("document", "location", "URLSearchParams", files["query-router.js"])(
    document, { search: "?" + query }, URLSearchParams);
  assert.ok(host.innerHTML.includes(document.title));
  return document.title;
}

const next = loadGeneratedRoute(generateExportProject(doc, "nextjs").files, "app/page.tsx");
for (const format of ["react", "html", "vue", "nuxt", "sveltekit"] as const) {
  test(`${format} query routing agrees with Next.js for repeated, empty and prototype-named keys`, async () => {
    const { files } = generateExportProject(doc, format);
    for (const [query, expected] of visits) {
      const params = new URLSearchParams(query);
      const searchParams = Object.fromEntries([...new Set(params.keys())].map(key => {
        const values = params.getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }));
      assert.equal((await next.generateMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) })).title, expected);
      const actual = format === "react" ? reactSelection(files, query) : format === "html" ? htmlSelection(files, query) :
        nativeSelection(files, (format === "vue" ? "src/" : format === "nuxt" ? "app/generated/" : "src/lib/") + "site-routes.js", query);
      assert.equal(actual, expected, `${format}: ?${query}`);
    }
    assert.deepEqual(doc, original);
  });
}

test("query routing fixes preserve authored links and last-value data variables", () => {
  assert.equal(pageHrefOf(doc.pages.variant1), "/?q=first&q=last");
  assert.deepEqual(pageQueryVars("q=first&q=last"), { q: "last" });
});
