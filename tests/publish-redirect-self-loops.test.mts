import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import { loadDicts, translate } from "../lib/i18n";
import { createInitialDoc } from "../lib/presets";

const require = createRequire(import.meta.url);
// Next.js の実際のルーターと同じ条件で、書き出した規則を判定する。
// エディタの本体からは、Next.js の内部のモジュールを読み込まない。
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
const { modifyRouteRegex } = require("next/dist/lib/redirect-status");
const { prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination");
const { formatUrl } = require("next/dist/shared/lib/router/utils/format-url");
const { normalizeRepeatedSlashes } = require("next/dist/shared/lib/utils");

type Redirect = { source: string; destination: string; statusCode: number };
function matcher(rule: Redirect) {
  return getPathMatch(rule.source, {
    strict: true,
    removeUnnamedParams: true,
    sensitive: false,
    regexModifier: (regex: string) => modifyRouteRegex(regex, ["/_next"]),
  });
}

function fixture(slug: string, redirectTo: string) {
  const doc = createInitialDoc();
  if (slug.replace(/^\/+|\/+$/g, "") === "") {
    const home = doc.pageOrder.find(id => doc.pages[id].slug === "")!;
    Object.assign(doc.pages[home], { name: "Old URL", redirectTo });
  } else {
    doc.pages.old = { id: "old", name: "Old URL", slug, redirectTo, title: "", description: "", children: [] };
    doc.pageOrder.push("old");
  }
  return doc;
}
const errors = (doc: ReturnType<typeof fixture>) => runChecks(doc).filter(c => c.level === "error");
async function redirects(doc: ReturnType<typeof fixture>): Promise<Redirect[]> {
  const config = generateProject(doc).files["next.config.mjs"];
  return new Function(config.replace("export default nextConfig;", "return nextConfig;"))().redirects();
}

// クエリと # は、pathname の判定に関係しない。転送をくり返して、実際のループを確かめる。
function assertLoops(rule: Redirect, initialPath: string) {
  let url = new URL(initialPath, "https://site.example");
  for (let i = 0; i < 3; i++) {
    const params = matcher(rule)(url.pathname);
    assert.notEqual(params, false, `${rule.source} must still match ${url.pathname}`);
    const { parsedDestination } = prepareDestination({
      destination: rule.destination, params,
      query: Object.fromEntries(url.searchParams), appendParamsToQuery: false,
    });
    parsedDestination.pathname = normalizeRepeatedSlashes(parsedDestination.pathname);
    url = new URL(formatUrl({ ...parsedDestination, search: undefined }), url);
  }
}

for (const [slug, destination, request] of [
  ["About", "/about", "/About"],
  ["about", "/about", "/about"],
  ["/Docs/Team/", " /docs/team/ ", "/Docs/Team"],
  ["About", "/about?tab=new#details", "/About?tab=old"],
  ["About", "/ABOUT/#details", "/about"],
  ["Docs/Team", "/docs//team//?tab=new", "/Docs/Team"],
  ["_Old-123", "/_old-123/", "/_Old-123"],
  ["", "/?lang=en#top", "/"],
  ["Blog/[slug]", "/blog/new?from=old#top", "/Blog/old"],
  ["Blog/[slug]", "/blog/:slug/?tab=new#top", "/Blog/Article"],
  ["[slug]/Details", "/:slug/details", "/Article/Details"],
  ["[slug]", "/:slug", "/article"],
] as const) {
  test(`preflight blocks self-matching redirect ${slug || "/"} → ${destination}`, async () => {
    const doc = fixture(slug, destination);
    const before = structuredClone(doc);
    const [rule] = await redirects(doc);
    assertLoops(rule, request);
    const checks = errors(doc);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].help, "page-redirect");
    assert.match(checks[0].message, /Old URL/);
    assert.ok(checks[0].message.includes(destination.trim()));
    assert.match(checks[0].message, /redirect loop/);
    assert.deepEqual(doc, before, "checks and generation preserve the saved URL and destination");
  });
}

test("a case-only redirect cannot hide the real lower-case page at publication", async () => {
  const doc = fixture("About", "/about");
  doc.pages.about = { id: "about", name: "About us", slug: "about", title: "About us", description: "", children: [] };
  doc.pageOrder.push("about");
  assert.ok(generateProject(doc).files["app/about/page.tsx"]);
  assertLoops((await redirects(doc))[0], "/about");
  assert.equal(errors(doc).length, 1);
});

for (const [slug, destination, request] of [
  ["old-about", "/about?from=old#team", "/old-about"],
  ["About", "/about-us", "/About"],
  ["About", "/about/team", "/About"],
  ["K", "/K", "/K"],
  ["old/[slug]", "/new/:slug", "/old/article"],
  ["old/[slug]", "/old", "/old/article"],
  // 1回だけ再び一致しても、その次で別の URL へ移るものは拒否しない。
  ["[slug]/a", "/b/:slug", "/a/a"],
  ["About", "https://other.example/about", "/About"],
] as const) {
  test(`ordinary redirect remains valid: ${slug} → ${destination}`, async () => {
    const doc = fixture(slug, destination);
    assert.deepEqual(errors(doc), []);
    const [rule] = await redirects(doc);
    assert.deepEqual(rule, { source: `/${slug.replace("[slug]", ":slug")}`, destination, statusCode: 301 });
    let url = new URL(request, "https://site.example");
    for (let i = 0; i < 3; i++) {
      const params = matcher(rule)(url.pathname);
      if (params === false || url.origin !== "https://site.example") return;
      const { parsedDestination } = prepareDestination({ destination: rule.destination, params, query: {}, appendParamsToQuery: false });
      url = new URL(formatUrl({ ...parsedDestination, search: undefined }), url);
    }
    assert.fail("ordinary redirect must leave the source rule");
  });
}

test("Next's protected /_next paths are not self-matching custom redirects", async () => {
  for (const [slug, target] of [["_next/file", "/_next/file"], ["[slug]", "/_NEXTish"]]) {
    const doc = fixture(slug, target);
    assert.equal(matcher((await redirects(doc))[0])(target), false);
    assert.deepEqual(errors(doc), []);
  }
});

test("draft redirects, proxy pages, and distinct case-sensitive normal pages stay valid", () => {
  const doc = fixture("About", "/about");
  doc.pages.old.unpublished = true;
  assert.deepEqual(errors(doc), []);
  assert.equal(generateProject(doc).files["next.config.mjs"].includes("async redirects"), false);
  doc.pages.old.unpublished = false;
  delete doc.pages.old.redirectTo;
  doc.pages.old.rewriteTo = "https://other.example/About";
  assert.deepEqual(errors(doc), []);
  delete doc.pages.old.rewriteTo;
  doc.pages.about = { id: "about", name: "Lower case", slug: "about", title: "", description: "", children: [] };
  doc.pageOrder.push("about");
  assert.deepEqual(errors(doc), []);
  const { files } = generateProject(doc);
  assert.ok(files["app/About/page.tsx"]);
  assert.ok(files["app/about/page.tsx"]);
});

test("the self-loop error has an English translation with the page and destination", async () => {
  const error = errors(fixture("About", "/about"))[0];
  assert.ok(error);
  // runChecks の日本語の文から辞書のキーに戻し、実際の翻訳の経路を通す。
  const key = error.message.replace("Old URL", "{name}").replace("/about", "{destination}");
  const translated = translate("en", await loadDicts("en"), key, { name: "Old URL", destination: "/about" });
  assert.match(translated, /Old URL/);
  assert.match(translated, /\/about/);
  assert.match(translated, /redirect loop/);
  assert.match(translated, /different path/);
});

// Next.js は、pageOrder の先頭から転送を探す。候補の規則だけでなく、その順序も実行する。
function traceRedirects(rules: Redirect[], initialPath: string) {
  let url = new URL(initialPath, "https://site.example");
  const seen = new Set<string>();
  const paths: string[] = [];
  for (let i = 0; i < 10; i++) {
    paths.push(url.pathname);
    if (seen.has(url.href)) return { loop: true, paths };
    seen.add(url.href);
    if (url.origin !== "https://site.example") return { loop: false, paths };
    const rule = rules.find(rule => matcher(rule)(url.pathname) !== false);
    if (!rule) return { loop: false, paths };
    const { parsedDestination } = prepareDestination({
      destination: rule.destination, params: matcher(rule)(url.pathname),
      query: Object.fromEntries(url.searchParams), appendParamsToQuery: false,
    });
    parsedDestination.pathname = normalizeRepeatedSlashes(parsedDestination.pathname);
    url = new URL(formatUrl({ ...parsedDestination, search: undefined }), url);
  }
  assert.fail("the ordered redirect fixture must terminate or repeat a URL");
}

for (const [source, target, firstSource, firstTarget, request, expectedPaths] of [
  ["blog/[slug]", "/blog/new", "blog/new", "/archive/new", "/blog/article", ["/blog/article", "/blog/new", "/archive/new"]],
  ["About", "/about", "about", "/archive/about", "/About", ["/About", "/archive/about"]],
  ["About", "/about", "[slug]", "/archive/:slug", "/About", ["/About", "/archive/About"]],
  ["Blog/[slug]", "/blog/:slug", "blog/[slug]", "/archive/:slug", "/Blog/article", ["/Blog/article", "/archive/article"]],
] as const) {
  test(`earlier ${firstSource} escape takes precedence over ${source} → ${target}`, async () => {
    const doc = fixture(source, target);
    doc.pages.escape = { id: "escape", name: "Escape", slug: firstSource, redirectTo: firstTarget, title: "", description: "", children: [] };
    doc.pageOrder.splice(doc.pageOrder.indexOf("old"), 0, "escape");
    assert.deepEqual(traceRedirects(await redirects(doc), request), { loop: false, paths: [...expectedPaths] });
    assert.deepEqual(errors(doc), []);

    doc.pageOrder = doc.pageOrder.filter(id => id !== "escape");
    doc.pageOrder.push("escape");
    assert.equal(traceRedirects(await redirects(doc), request).loop, true, "a later escape cannot override the first matching rule");
    assert.equal(errors(doc).length, 1);
    assert.match(errors(doc)[0].message, /Old URL/);
  });
}

test("unpublished redirects and rewrites do not shadow a redirect", () => {
  for (const patch of [{ redirectTo: "/archive/new", unpublished: true }, { rewriteTo: "https://other.example/blog/new" }]) {
    const doc = fixture("blog/[slug]", "/blog/new");
    doc.pages.escape = { id: "escape", name: "Escape", slug: "blog/new", title: "", description: "", children: [], ...patch };
    doc.pageOrder.unshift("escape");
    assert.equal(errors(doc).length, 1);
    assert.match(errors(doc)[0].message, /Old URL/);
  }
});

test("earlier disjoint redirects do not conceal deterministic loops", () => {
  const doc = fixture("blog/[slug]", "/blog/new");
  doc.pages.escape = { id: "escape", name: "Escape", slug: "other/[slug]", redirectTo: "/archive/:slug", title: "", description: "", children: [] };
  doc.pageOrder.unshift("escape");
  assert.equal(errors(doc).length, 1);
});

test("partially intercepted parameter targets are conservatively left undecided", async () => {
  const doc = fixture("Blog/[slug]", "/blog/:slug");
  doc.pages.escape = { id: "escape", name: "Escape", slug: "blog/new", redirectTo: "/archive/new", title: "", description: "", children: [] };
  doc.pageOrder.unshift("escape");
  const rules = await redirects(doc);
  assert.equal(traceRedirects(rules, "/Blog/new").loop, false);
  assert.equal(traceRedirects(rules, "/Blog/other").loop, true);
  // 一部の変数の値だけを遮る先の規則がある場合、すべての値について安全かは判定しない。
  assert.deepEqual(errors(doc), []);
});
