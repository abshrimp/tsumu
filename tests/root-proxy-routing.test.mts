import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { urlToHttpOptions } from "node:url";
import type { Rewrite, Redirect } from "next/dist/lib/load-custom-routes";
import type { FsOutput } from "next/dist/server/lib/router-utils/filesystem";
import { generateProject } from "../lib/generator";
import { runChecks } from "../lib/generator/checks";
import type { Page, SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
const { getResolveRoutes } = require("next/dist/server/lib/router-utils/resolve-routes");
const { buildCustomRoute } = require("next/dist/server/lib/router-utils/filesystem");
const { defaultConfig } = require("next/dist/server/config-shared");
const { getRouteMatcher } = require("next/dist/shared/lib/router/utils/route-matcher");
const { getRouteRegex } = require("next/dist/shared/lib/router/utils/route-regex");
const { checkCustomRoutes } = require("next/dist/lib/load-custom-routes");
const { prepareDestination } = require("next/dist/shared/lib/router/utils/prepare-destination");

type Rewrites = { beforeFiles: Rewrite[]; fallback?: Rewrite[] };
type Config = { rewrites?: () => Promise<Rewrites>; redirects?: () => Promise<Redirect[]> };

function page(id: string, slug: string, extra: Partial<Page> = {}): Page {
  return { id, slug, name: id, title: id, description: "", children: [], ...extra };
}

function fixture(pages = [page("home", "", { rewriteTo: "https://origin.example/base/" })]): SiteDoc {
  return { siteName: "Proxy test", lang: "ja", pages: Object.fromEntries(pages.map(p => [p.id, p])), pageOrder: pages.map(p => p.id), nodes: {}, assets: {} };
}

function generated(doc: SiteDoc, target: "production" | "test" = "production") {
  const before = structuredClone(doc);
  assert.deepEqual(runChecks(doc).filter(c => c.level === "error"), []);
  const project = generateProject(doc, target);
  const config: Config = new Function(project.files["next.config.mjs"].replace("export default nextConfig;", "return nextConfig;"))();
  assert.deepEqual(doc, before, "generation must not mutate the saved document");
  return { ...project, config };
}

async function rewritesOf(config: Config) {
  assert.ok(config.rewrites);
  const rewrites = await config.rewrites();
  for (const rules of [rewrites.beforeFiles, rewrites.fallback ?? []]) checkCustomRoutes(rules, "rewrite");
  return rewrites;
}

// ファイルの有無だけを代わりに用意し、一致・転送先・優先順位は、インストール済みの Next.js の本体で検証する。
// サーバーもブラウザも起動せず、外部へのリクエストも送らない。
async function resolver(config: Config, items = new Map<string, FsOutput>(), dynamicPaths: string[] = []) {
  const rewrites = config.rewrites ? await rewritesOf(config) : { beforeFiles: [] };
  const fsChecker = {
    buildId: "local-build", headers: [], onMatchHeaders: [],
    redirects: (await config.redirects?.() ?? []).map(r => buildCustomRoute("redirect", r, "")),
    rewrites: {
      beforeFiles: rewrites.beforeFiles.map(r => buildCustomRoute("rewrite", r, "")),
      afterFiles: [],
      fallback: (rewrites.fallback ?? []).map(r => buildCustomRoute("rewrite", r, "")),
    },
    getItem: async (path: string) => items.get(path) ?? null,
    getDynamicRoutes: () => dynamicPaths.map(path => ({ page: path, match: getRouteMatcher(getRouteRegex(path)) })),
    getMiddlewareMatchers: () => undefined,
    handleLocale: (pathname: string) => ({ pathname }),
  };
  const resolve = getResolveRoutes(fsChecker,
    { ...defaultConfig, experimental: { ...defaultConfig.experimental } }, () => "",
    { dev: false, minimalMode: false, dir: process.cwd(), port: 3000, hostname: "localhost" },
    undefined, undefined, undefined);
  return async (url: string) => {
    const req = new PassThrough();
    Object.assign(req, { url, method: "GET", headers: { host: "localhost" }, socket: {} });
    return resolve({ req, res: { setHeader() {} }, isUpgradeReq: false, invokedOutputs: new Set() });
  };
}

function localItems(paths: [string, FsOutput["type"]][]) {
  return new Map(paths.map(([itemPath, type]) => [itemPath, { type, itemPath }]));
}

test("a root-only proxy keeps its exact destination and adds a descendant fallback", async () => {
  for (const destination of ["https://example.com", "https://example.com/", "https://example.com/base", "https://example.com/base/", "  https://example.com/base/  "]) {
    const { files, config } = generated(fixture([page("home", "", { rewriteTo: destination })]));
    const trimmed = destination.trim();
    const rewrites = await rewritesOf(config);
    assert.deepEqual(rewrites, {
      beforeFiles: [{ source: "/", destination: trimmed }],
      fallback: [{ source: "/:proxyPath+", destination: `${trimmed.replace(/\/+$/, "")}/:proxyPath*` }],
    });
    assert.equal(files["app/page.tsx"], undefined);
    assert.equal(files["app/route.ts"], undefined);
    const match = buildCustomRoute("rewrite", rewrites.fallback![0], "").match;
    assert.equal(match("/"), false, "fallback must not claim the exact root");
    assert.deepEqual(match("/assets/site.css"), { proxyPath: ["assets", "site.css"] });
    const route = await resolver(config);
    const root = await route("/");
    assert.equal(root.parsedUrl.hostname, "example.com");
    assert.equal(root.parsedUrl.pathname || "/", new URL(trimmed).pathname);
    for (const path of ["/contact", "/assets/site.css", "/deep/nested/page"]) {
      const result = await route(`${path}?q=hello&tag=a&tag=b`);
      assert.equal(result.parsedUrl.pathname, `${new URL(trimmed).pathname.replace(/\/+$/, "")}${path}`);
      assert.deepEqual(result.parsedUrl.query, { q: "hello", tag: ["a", "b"] });
      assert.equal(result.parsedUrl.hostname, "example.com");
      assert.equal(result.finished, true);
      assert.equal(result.matchedOutput, undefined);
    }
  }
});

test("sites without published proxies still omit rewrites", async () => {
  for (const hidden of [
    page("hidden", "hidden"),
    page("hidden", "hidden", { rewriteTo: "https://hidden.example/", unpublished: true }),
    page("hidden", "", { rewriteTo: "https://hidden.example/", unpublished: true }),
  ]) {
    const { config } = generated(fixture([page("home", ""), hidden]));
    assert.equal(config.rewrites, undefined);
    const route = await resolver(config);
    const missing = await route("/missing");
    assert.equal(missing.finished, false);
    assert.ok(missing.parsedUrl.protocol == null);
  }
});

test("query and fragment destinations remain valid and exact-only for root and nonroot proxies", async () => {
  for (const slug of ["", "external"]) {
    for (const destination of ["https://example.com/?lang=ja", "https://example.com/base#intro", "https://example.com/base?lang=ja#intro", "https://example.com/base?", "https://example.com/base#"]) {
      const pages = [page("proxy", slug, { rewriteTo: destination })];
      if (slug) pages.unshift(page("home", ""));
      const { config } = generated(fixture(pages));
      const source = slug ? `/${slug}` : "/";
      assert.deepEqual(await rewritesOf(config), { beforeFiles: [{ source, destination }] });
      const route = await resolver(config);
      const exact = await route(`${source}?q=hello&lang=en`);
      assert.equal(exact.parsedUrl.pathname, new URL(destination).pathname);
      assert.deepEqual(exact.parsedUrl.query, { q: "hello", lang: destination.includes("?lang=ja") ? "ja" : "en" });
      assert.equal(exact.parsedUrl.hash || "", new URL(destination).hash);
      assert.equal(urlToHttpOptions(new URL(destination)).path!.includes("#"), false);
      const descendant = await route(`${source.replace(/\/$/, "")}/contact`);
      assert.equal(descendant.finished, false);
      assert.ok(descendant.parsedUrl.protocol == null);
    }
  }
  // クエリの後ろに単純にパスを足すと、パスではなくクエリの値が変わってしまう。
  const { parsedDestination } = prepareDestination({ destination: "https://example.com/base?lang=ja/:proxyPath*", params: { proxyPath: ["contact"] }, query: {}, appendParamsToQuery: true });
  assert.equal(parsedDestination.pathname, "/base");
  assert.equal(parsedDestination.query.lang, "ja/contact");
});

test("nonroot proxy order, descendants, and wildcard rules remain in beforeFiles", async () => {
  const doc = fixture([
    page("home", ""),
    page("shop", "shop", { rewriteTo: "https://shop.example/base/" }),
    page("nested", "shop/sale", { rewriteTo: "https://sale.example/" }),
    page("wildcard", "docs/:path*", { rewriteTo: "https://docs.example/:path*" }),
    page("dynamic", "users/[slug]", { rewriteTo: "https://users.example/:slug" }),
  ]);
  const { config } = generated(doc);
  assert.deepEqual(await rewritesOf(config), { beforeFiles: [
    { source: "/shop", destination: "https://shop.example/base/" },
    { source: "/shop/:proxyPath*", destination: "https://shop.example/base/:proxyPath*" },
    { source: "/shop/sale", destination: "https://sale.example/" },
    { source: "/shop/sale/:proxyPath*", destination: "https://sale.example/:proxyPath*" },
    { source: "/docs/:path*", destination: "https://docs.example/:path*" },
    { source: "/users/:slug", destination: "https://users.example/:slug" },
    { source: "/users/:slug/:proxyPath*", destination: "https://users.example/:slug/:proxyPath*" },
  ] });
  const route = await resolver(config);
  for (const [path, hostname, pathname] of [
    ["/shop/sale/item", "shop.example", "/base/sale/item"],
    ["/docs/a/b", "docs.example", "/a/b"],
    ["/users/alice/settings", "users.example", "/alice/settings"],
  ]) {
    const result = await route(path);
    assert.equal(result.parsedUrl.hostname, hostname);
    assert.equal(result.parsedUrl.pathname, pathname);
  }
});

for (const rootFirst of [true, false]) {
  test(`root fallback respects local routes, public files, explicit proxies, and redirects (${rootFirst ? "root first" : "root last"})`, async () => {
    const doc = fixture([
      page("home", "", { rewriteTo: "https://origin.example/base/" }),
      page("about", "about"),
      page("raw", "landing", { rawHtml: "<html><body>Local HTML</body></html>" }),
      page("blog", "blog/[slug]"),
      page("shop", "shop", { rewriteTo: "https://shop.example/" }),
      page("shopLocal", "shop/local"),
      page("old", "old", { redirectTo: "/about" }),
      page("shopOld", "shop/old", { redirectTo: "/about" }),
      page("hidden", "hidden", { unpublished: true }),
      page("hiddenProxy", "hidden-proxy", { rewriteTo: "https://hidden.example/", unpublished: true }),
    ]);
    doc.pwa = { enabled: true };
    if (!rootFirst) doc.pageOrder.push(doc.pageOrder.shift()!);
    const { config, files } = generated(doc, "test");
    for (const path of ["app/about/page.tsx", "app/landing/route.ts", "app/blog/[slug]/page.tsx", "app/shop/local/page.tsx", "app/manifest.ts", "public/sw.js", "public/pwa.js", "public/robots.txt"]) assert.ok(files[path], path);
    for (const path of ["app/page.tsx", "app/shop/page.tsx", "app/old/page.tsx", "app/hidden/page.tsx", "app/hidden-proxy/page.tsx"]) assert.equal(files[path], undefined, path);
    const rewrites = await rewritesOf(config);
    assert.deepEqual(rewrites.fallback, [{ source: "/:proxyPath+", destination: "https://origin.example/base/:proxyPath*" }]);
    assert.equal(rewrites.beforeFiles.length, 3);
    assert.equal(rewrites.beforeFiles[rootFirst ? 0 : 2].source, "/");
    // 公開のときに残る利用者が作ったファイルや、Next.js の予約されたエンドポイントも、列挙による除外なしで優先される。
    const items = localItems([
      ["/about", "appFile"], ["/landing", "appFile"], ["/blog/[slug]", "appFile"],
      ["/shop/local", "appFile"], ["/api/ping", "appFile"], ["/manifest.webmanifest", "appFile"],
      ["/assets/site.css", "publicFolder"], ["/assets/photo.png", "publicFolder"],
      ["/scripts.js", "publicFolder"], ["/sw.js", "publicFolder"], ["/pwa.js", "publicFolder"],
      ["/robots.txt", "publicFolder"], ["/user-authored.txt", "publicFolder"],
      ["/_next/static/chunks/local.js", "nextStaticFolder"], ["/_next/image", "nextImage"],
    ]);
    const route = await resolver(config, items, ["/blog/[slug]"]);
    for (const path of items.keys()) {
      if (path === "/shop/local" || path === "/blog/[slug]") continue;
      const result = await route(`${path}?v=2`);
      assert.equal(result.matchedOutput?.itemPath, path, path);
      assert.ok(result.parsedUrl.protocol == null, path);
    }
    const dynamic = await route("/blog/hello");
    assert.equal(dynamic.matchedOutput?.itemPath, "/blog/[slug]");
    assert.equal(dynamic.matchedOutput?.params.slug, "hello");
    // 存在しない Next.js のリソースは中継できるが、外部の Next.js のアプリ全体との互換性を保証するものではない。
    for (const path of ["/", "/contact", "/assets/missing.css", "/hidden", "/hidden-proxy", "/_next/static/chunks/upstream.js", "/_next/data/foreign-build/contact.json"]) {
      const result = await route(path);
      assert.equal(result.parsedUrl.hostname, "origin.example", path);
      assert.equal(result.parsedUrl.pathname, `/base${path}`, path);
      assert.equal(result.matchedOutput, undefined, path);
    }
    for (const path of ["/shop", "/shop/local", "/shop/item"]) {
      const result = await route(path);
      assert.equal(result.parsedUrl.hostname, "shop.example", path);
      assert.equal(result.parsedUrl.pathname, path.slice(5) || "/", path);
    }
    for (const path of ["/old", "/shop/old"]) {
      const result = await route(path);
      assert.equal(result.statusCode, 301, path);
      assert.equal(result.parsedUrl.pathname, "/about", path);
      assert.ok(result.parsedUrl.protocol == null, path);
    }
  });
}

test("a local dynamic catch-all added to the exported project owns descendants before the root fallback", async () => {
  // エディタは [slug] だけを許すが、書き出した Next.js のプロジェクトには catch-all も追加できる。
  const { config } = generated(fixture([page("home", "", { rewriteTo: "https://origin.example/" })]));
  const route = await resolver(config, localItems([["/[...path]", "appFile"]]), ["/[...path]"]);
  for (const path of ["/contact", "/assets/missing.css", "/deep/path"]) {
    const result = await route(path);
    assert.equal(result.matchedOutput?.itemPath, "/[...path]");
    assert.deepEqual(result.matchedOutput?.params.path, path.slice(1).split("/"));
    assert.ok(result.parsedUrl.protocol == null);
  }
  const root = await route("/");
  assert.equal(root.parsedUrl.hostname, "origin.example");
});
