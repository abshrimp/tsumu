import { socialImageSrc, UPDATE_SOCIAL_IMAGE } from "./social-image";
import { isPortableOutputPath } from "./output-paths";
import type { Page, SiteDoc } from "../types";
import { pagePlan } from "../data";
import { scriptsFile } from "../script-runtime";
import { PAGE_DATA_RUNTIME } from "./browser-data";
import { createReactPageRenderer } from "./html-export";
import type { GeneratedProject, PublishTarget } from "../generator";
import { googleFontsCss } from "./css";
import { adobeFontHead } from "./adobe-fonts";
import { buildAssetNames, buildClassNames } from "./names";
import { imageRefSrc } from "./render-helpers";
import { buildPwaManifest } from "./templates";
import { REACT_SEARCH_FORM } from "./react-form";
import { indexQueryVariants } from "./page";
import { pageQueryConditions, routeDir } from "../page-query";

const esc = (value: string) =>
  value.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/**
 * 同期的に動く、Next.js 向けに生成した JSX だけを変換する。サーバーコンポーネントや高度な
 * ルーティングは、この関数を呼ぶ前に exportLimitations が明示的に拒否する。
 */
export function reactSource(source: string): string {
  // 生成した宣言は LF で区切った行から始まり、書かれた文字列は JSON や JSX の形でエスケープされている。
  // その文字列の中のテキストを、ソースとして解釈してはいけない（/m が行として扱う
  // Unicode の行区切りの文字そのものも含む）。
  const result = source
    .replace(/(^|\n)import type \{ Metadata \} from "next";\r?\n/g, "$1")
    .replace(/(^|\n)export const metadata: Metadata = \{[\s\S]*?\n\};[ \t\r\n]*/g, "$1")
    .replace(/(^|\n)import (?:Link|Image) from "next\/(?:link|image)";(?=\r?\n|$)/g, "$1")
    .replace(/(^|\n)export default async function Page\([\s\S]*?\)\s*\{/g, "$1export default function Page() {")
    .replace(/(^|\n)([ \t]*)const sp = await searchParams;/g, "$1$2const sp = Object.fromEntries(new URLSearchParams(window.location.search));")
    // インラインの JSX を変換するときは、生成した文字列リテラルとコメントを飛ばす。
    // 生の HTML やテキストの例には、まったく同じタグの綴りが含まれることがある。
    .replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|<(\/?)(Link|Image)(?=[\s/>])/g,
      (whole, closing: string | undefined, tag: string | undefined) =>
        tag ? "<" + closing + (tag === "Link" ? "a" : "img") : whole)
    .replace(/(^|\n)[ \t]*preload[ \t]*(?=\r?\n|$)/g, "$1");
  if (/(?:^|\n)import[ \t]+(?:[^;\r\n]*[ \t]+from[ \t]+)?["']next(?:\/|["'])/.test(result))
    throw new Error("Next.js-only imports cannot be used in React exports.");
  return result;
}

export function needsReactPageRuntime(doc: SiteDoc, pageId: string): boolean {
  const plan = pagePlan(doc, pageId);
  return plan.steps.length > 0 || plan.listOps.size > 0 || plan.clientVars.size > 0;
}

/** Output a client-rendered Vite application with static client routes and assets. */
export function buildReactProject(
  doc: SiteDoc, next: GeneratedProject, target: PublishTarget, classes = buildClassNames(doc),
): GeneratedProject {
  const files: Record<string, string> = {};
  for (const [path, source] of Object.entries(next.files)) {
    if (path.startsWith("public/")) files[path] = source;
    else if (path === "components/SearchForm.tsx") {
      files["src/components/SearchForm.tsx"] = REACT_SEARCH_FORM;
    } else if (path === "components/SmartLink.tsx") {
      files["src/components/SmartLink.tsx"] = [
        'import type { ComponentPropsWithoutRef } from "react";',
        'export default function SmartLink({ href, ...props }: Omit<ComponentPropsWithoutRef<"a">, "href"> & { href: string }) {',
        '  return <a href={href} {...props} />;',
        '}', '',
      ].join("\n");
    } else if (path.startsWith("components/")) files["src/" + path] = reactSource(source);
    else if (path === "lib/vars.ts") files["src/lib/vars.ts"] = source;
  }
  const published = doc.pageOrder.map(id => doc.pages[id]).filter(page => page && !page.unpublished);
  const is404 = (page: Page) => page.slug.replace(/^\/+|\/+$/g, "") === "404";
  const missingPage = published.find(is404);
  const pages = published.filter(page => !is404(page));
  const assetNames = buildAssetNames(doc);
  const missingImage = socialImageSrc(doc, missingPage, assetNames);
  const hasSocialImages = !!missingImage || pages.some(page => !!socialImageSrc(doc, page, assetNames));
  const imports: string[] = [];
  const entries: string[] = [];
  // Data-dependent pages are populated by the shared browser runtime. Other
  // pages keep their normal generated JSX component trees.
  // Even without a fetch step, a client-owned variable or a list-display
  // operation requires the DOM/runtime renderer. The Next.js JSX fallback
  // cannot reproduce those browser-side data dependencies.
  const variants = indexQueryVariants(pages);
  const clientPages = new Set(pages.filter((page) => needsReactPageRuntime(doc, page.id)).map((page) => page.id));
  const clientRenderer = clientPages.size ? createReactPageRenderer(doc, classes) : undefined;
  if (clientRenderer) {
    files["public/data-loader.js"] = PAGE_DATA_RUNTIME;
    files["public/scripts.js"] = scriptsFile(clientRenderer.doc, true);
  }
  for (const [i, page] of pages.entries()) {
    const slug = page.slug.replace(/^\/+|\/+$/g, "");
    const dir = routeDir(slug);
    // Locate JSX using Next.js's filesystem routes; retain the authored slug
    // below for the React router. Distinct slugs can share a Next.js directory.
    const variant = variants.get(page.id);
    const generatedPath = "app/" + (dir ? dir + "/" : "") +
      (variant ? "_q/p" + variant.index + ".tsx" : "page.tsx");
    const generated = next.files[generatedPath];
    if (!generated) throw new Error("Missing generated page: " + generatedPath);
    if (clientRenderer && clientPages.has(page.id)) {
      const body = clientRenderer.renderPage(page.id);
      files["src/pages/Page" + i + ".tsx"] = [
        "/** Client-side JSON data and DOM effects; no server is required. */",
        "export default function Page() {",
        '  return <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: ' +
          JSON.stringify(body) + ' }} />;',
        "}", "",
      ].join("\n");
    } else {
      files["src/pages/Page" + i + ".tsx"] = reactSource(generated);
    }
    imports.push('import Page' + i + ' from "./pages/Page' + i + '";');
    const query = pageQueryConditions(page.query);
    entries.push("  { path: " + JSON.stringify(slug ? "/" + slug : "/") +
      ", query: Object.fromEntries(" + JSON.stringify(query) + ")" +
      ", title: " + JSON.stringify(page.title || page.name) +
      ", description: " + JSON.stringify(page.description) +
      ", ogImage: " + JSON.stringify(socialImageSrc(doc, page, assetNames)) +
      ", noindex: " + (target === "production" && !!page.noindex) +
      ", lang: " + JSON.stringify(page.lang || doc.lang || "ja") +
      ", Component: Page" + i + " },");
  }
  const notFound = next.files["app/not-found.tsx"];
  if (!notFound) throw new Error("Missing generated 404 page");
  files["src/NotFound.tsx"] = reactSource(notFound);
  imports.push('import NotFound from "./NotFound";');

  const loading = Boolean(files["src/components/SiteLoadingScreen.tsx"]);
  if (loading) imports.push('import SiteLoadingScreen from "./components/SiteLoadingScreen";');
  // スクリプトの DOM の検索が実際の要素を見つけられるよう、ブラウザのランタイムは
  // React の最初のマウントの後に登録する。
  const scripts = ["inview.js", "data-loader.js", "scripts.js", "pwa.js"].filter((name) => !!files["public/" + name]);
  const app = [
    'import { useEffect, type ComponentType } from "react";',
    ...imports, "",
    "const SITE_NAME = " + JSON.stringify(doc.siteName) + ";",
    "const scripts: string[] = " + JSON.stringify(scripts.map((name) => "/" + name)) + ";",
    "type Route = { path: string; query: Record<string, string>; title: string; description: string; ogImage: string | null; noindex: boolean; lang: string; Component: ComponentType };",
    "const routes: Route[] = [", ...entries, "];", "",
    "export default function App() {",
    '  let pathname = (() => {',
    '    try { return decodeURI(window.location.pathname); }',
    '    catch { return window.location.pathname; }',
    '  })().replace(/\\/+$/, "") || "/";',
    '  if (pathname.endsWith("/index.html") && !routes.some(item => item.path === pathname)) {',
    '    pathname = pathname.slice(0, -"/index.html".length) || "/";',
    '  }',
    '  const search = new URLSearchParams(window.location.search);',
    '  const matches = routes.filter((item) => item.path === pathname && Object.entries(item.query).every(([key, value]) => search.get(key) === value));',
    '  const route = matches.sort((a, b) => Object.keys(b.query).length - Object.keys(a.query).length)[0] ?? routes.find((item) => item.path === pathname);',
    '  const Page = route?.Component ?? NotFound;',
    '  useEffect(() => {',
    '    document.title = route ? route.title + " | " + SITE_NAME : ' + JSON.stringify(missingPage ? (missingPage.title || missingPage.name) + " | " + doc.siteName : doc.siteName) + ";",
    '    document.documentElement.lang = route?.lang ?? ' + JSON.stringify(missingPage?.lang || doc.lang || "ja") + ";",
    '    document.querySelector(\'meta[name="description"]\')?.setAttribute("content", route?.description ?? ' + JSON.stringify(missingPage?.description || "") + ");",
    ...(hasSocialImages ? [
      '    const image = route ? (route.ogImage || "") : ' + JSON.stringify(missingImage || "") + ";",
      UPDATE_SOCIAL_IMAGE,
    ] : []),
    ...(target === "production" ? [
      '    const robots = document.querySelector("meta[data-route-noindex]");',
      '    if (route && !route.noindex) robots?.remove();',
      '    else if (!robots) {',
      '      const meta = document.createElement("meta");',
      '      meta.name = "robots"; meta.content = "noindex, nofollow";',
      '      meta.setAttribute("data-route-noindex", ""); document.head.appendChild(meta);',
      '    }',
    ] : []),
    '  }, [route]);',
    '  useEffect(() => {',
    '    // Mount scripts in order, after the React tree has been committed.',
    '    let cancelled = false;',
    '    const attached: HTMLScriptElement[] = [];',
    '    async function install() {',
    '      for (const src of scripts) {',
    '        if (cancelled) return;',
    '        await new Promise<void>((resolve) => {',
    '          const script = document.createElement("script");',
    '          script.src = src;',
    '          script.onload = () => resolve();',
    '          script.onerror = () => resolve();',
    '          document.body.appendChild(script);',
    '          attached.push(script);',
    '        });',
    '      }',
    '    }',
    '    void install();',
    '    return () => { cancelled = true; for (const script of attached) script.remove(); };',
    '  }, []);',
    '  return (',
    '    <>',
    loading ? '      <SiteLoadingScreen />' : '',
    '      <Page />',
    doc.customBodyEndHtml?.trim() ? '      <div dangerouslySetInnerHTML={{ __html: ' + JSON.stringify(doc.customBodyEndHtml) + ' }} />' : '',
    '    </>',
    '  );',
    '}', "",
  ].filter((line) => line !== "").join("\n");
  files["src/App.tsx"] = app;
  files["src/main.tsx"] = [
    'import { createRoot } from "react-dom/client";',
    'import App from "./App";',
    'import "./globals.css";',
    'import "./site.css";', '',
    'const root = document.getElementById("root");',
    'if (!root) throw new Error("Missing React root");',
    'createRoot(root).render(<App />);', '',
  ].join("\n");

  files["src/globals.css"] = googleFontsCss(doc) + next.files["app/globals.css"];
  files["src/site.css"] = next.files["styles/site.css"];

  const favicon = imageRefSrc(assetNames, doc.favicon);
  const appleIcon = imageRefSrc(assetNames, doc.appleTouchIcon);
  const pwaThemeColor = doc.pwa?.enabled ? doc.pwa.themeColor?.trim() : "";
  // Vite ではマニフェストと Service Worker は public のアセットなので、Next.js のルートは不要。
  const manifest = buildPwaManifest(doc, assetNames);
  if (manifest) {
    files["public/manifest.webmanifest"] = JSON.stringify(manifest, null, 2) + "\n";
  }
  const icons = [
    doc.pwa?.enabled ? '<link rel="manifest" href="/manifest.webmanifest">' : "",
    pwaThemeColor ? '<meta name="theme-color" content="' + esc(pwaThemeColor) + '">' : "",
    favicon ? '<link rel="icon" href="' + esc(favicon) + '">' : "",
    appleIcon ? '<link rel="apple-touch-icon" href="' + esc(appleIcon) + '">' : "",
  ].filter(Boolean).join("\n    ");
  // A static host serves one HTML document for each path, independent of its query.
  // Its initial metadata describes the unconditional page. React selects query variants on mount.
  const groups = new Map<string, Page[]>();
  for (const page of pages) {
    const path = "/" + page.slug.replace(/^\/+|\/+$/g, "");
    const group = groups.get(path) ?? [];
    group.push(page);
    groups.set(path, group);
  }
  const headOf = (page: Page | undefined, noindex: boolean) => {
    const image = socialImageSrc(doc, page, assetNames);
    return {
      lang: esc(page?.lang || doc.lang || "ja"),
      head: [
        '<title>' + esc(page ? (page.title || page.name) + " | " + doc.siteName : doc.siteName) + '</title>',
        '<meta name="description" content="' + esc(page?.description || "") + '">',
        image ? '<meta property="og:image" content="' + esc(image) + '" data-route-social>' : "",
        image ? '<meta name="twitter:card" content="summary_large_image" data-route-social>' : "",
        noindex && target === "production" ? '<meta name="robots" content="noindex, nofollow" data-route-noindex>' : "",
      ].filter(Boolean).join("\n"),
    };
  };
  const heads = Array.from(groups, ([path, group]) => ({
    path, ...headOf(group.find(page => !pageQueryConditions(page.query).length) ?? group[0], group.every(page => page.noindex)),
  }));
  const missing = headOf(missingPage, true);
  const home = heads.find(entry => entry.path === "/") ?? missing;
  files["index.html"] = [
    "<!doctype html>", '<html lang="' + home.lang + '">', "  <head>",
    '    <meta charset="UTF-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "    <!--page-head-->" + home.head + "<!--/page-head-->",
    "    " + icons,
    "    " + adobeFontHead(doc),
    "    " + (doc.customHeadHtml ?? ""),
    "  </head>", "  <body>", '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    "  </body>", "</html>", "",
  ].join("\n");

  const slug = doc.siteName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "my-site";
  files["package.json"] = JSON.stringify({
    name: slug, private: true, version: "0.1.0", type: "module",
    scripts: { dev: "vite", build: "tsc --noEmit && vite build", preview: "vite preview" },
    dependencies: { react: "^19.3.1", "react-dom": "^19.3.1" },
    devDependencies: {
      "@types/node": "^26.6.5", "@types/react": "^19.3.0",
      "@types/react-dom": "^19.3.0", typescript: "^7.0.2", vite: "^7.3.1",
    },
  }, null, 2) + "\n";
  // Build additional route documents from Vite's finished index so asset hashes,
  // transformed custom head code, and project-wide preview directives are preserved.
  // Non-portable paths or paths overlapping an authored public file keep the SPA fallback.
  const publicPaths = [...Object.keys(files), ...Object.keys(next.binaries), ...Object.keys(next.remoteAssets)]
    .filter(path => path.startsWith("public/")).map(path => path.slice(7));
  const canon = (path: string) => path.normalize("NFC").toLowerCase();
  const outputs = ["index.html", ...publicPaths];
  const outputFor = (name: string) => {
    if (!isPortableOutputPath(name) || outputs.some(existing => {
      const a = canon(existing), b = canon(name);
      return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    })) return null;
    outputs.push(name);
    return name;
  };
  const routeHeads = heads.map(entry => ({ ...entry,
    file: entry.path === "/" ? null : outputFor(entry.path.slice(1) + "/index.html"),
  }));
  const missingFile = outputFor("404.html");
  files["vite.config.ts"] = [
    'import { defineConfig, type Plugin } from "vite";',
    'import { fileURLToPath } from "node:url";',
    'import { readFile } from "node:fs/promises";',
    'import { resolve } from "node:path";', "",
    'const heads: { path: string; lang: string; head: string; file: string | null }[] = ' + JSON.stringify(routeHeads, null, 2) + ';',
    'const missing = ' + JSON.stringify(missing) + ';',
    'function withHead(html: string, page: { head: string; lang: string }) {',
    `  return html.replace(/<html lang="[^"]*">/, () => '<html lang="' + page.lang + '">')`,
    '    .replace(/<!--page-head-->[\\s\\S]*?<!--\\/page-head-->/, () => page.head);',
    '}',
    'function routeFor(url: string) {',
    '  let path = new URL(url, "http://localhost").pathname;',
    '  try { path = decodeURI(path); } catch { /* Keep the original path. */ }',
    '  path = path.replace(/\\/+$/, "") || "/";',
    '  return heads.find(page => page.path === path) ?? (path.endsWith("/index.html")',
    '    ? heads.find(page => page.path === (path.slice(0, -"/index.html".length) || "/")) : undefined);',
    '}',
    'const routeDocuments: Plugin = {',
    '  name: "route-documents", enforce: "post",',
    '  transformIndexHtml(html, context) {',
    '    if (!context.server) return;',
    '    return withHead(html, routeFor(context.originalUrl || context.path) ?? missing);',
    '  },',
    '  configureServer(server) {',
    '    return () => server.middlewares.use(async (req, res, next) => {',
    '      if (req.url !== "/index.html" || !req.originalUrl || routeFor(req.originalUrl)) return next();',
    '      try {',
    '        const source = await readFile(resolve(server.config.root, "index.html"), "utf8");',
    '        const html = await server.transformIndexHtml(req.originalUrl, source);',
    '        res.statusCode = 404; res.setHeader("Content-Type", "text/html; charset=utf-8");',
    '        res.end(req.method === "HEAD" ? undefined : html);',
    '      } catch (error) { next(error); }',
    '    });',
    '  },',
    '  configurePreviewServer(server) {',
    '    // Vite falls back to the root index for a slashless directory URL.',
    '    // Run after its asset middleware so public files keep their normal behavior.',
    '    return () => server.middlewares.use(async (req, res, next) => {',
    '      if (req.url !== "/index.html" || !req.originalUrl || req.originalUrl === "/index.html") return next();',
    '      const page = routeFor(req.originalUrl);',
    '      if (page?.file) { req.url = encodeURI("/" + page.file); return next(); }',
    '      if (page?.path === "/") return next();',
    '      try {',
    '        const index = await readFile(resolve(server.config.root, server.config.build.outDir, "index.html"), "utf8");',
    '        res.statusCode = page ? 200 : 404;',
    '        res.setHeader("Content-Type", "text/html; charset=utf-8");',
    '        res.end(req.method === "HEAD" ? undefined : withHead(index, page ?? missing));',
    '      } catch (error) { next(error); }',
    '    });',
    '  },',
    '  generateBundle: { order: "post", handler(_, bundle) {',
    '    const index = bundle["index.html"];',
    '    if (!index || index.type !== "asset" || typeof index.source !== "string") this.error("Missing built index.html");',
    '    const shell = index.source;',
    '    for (const page of heads) if (page.file) this.emitFile({ type: "asset", fileName: page.file, source: withHead(shell, page) });',
    ...(missingFile ? ['    this.emitFile({ type: "asset", fileName: "404.html", source: withHead(shell, missing) });'] : []),
    '  } },',
    '};',
    "export default defineConfig({",
    '  plugins: [routeDocuments],',
    '  esbuild: { jsx: "automatic" },',
    '  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },',
    "});", "",
  ].join("\n");
  files["tsconfig.json"] = JSON.stringify({
    compilerOptions: {
      target: "ES2024", lib: ["DOM", "DOM.Iterable", "ES2024"],
      module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx",
      strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, resolveJsonModule: true,
      types: ["vite/client", "node"], paths: { "@/*": ["./src/*"] },
    },
    include: ["src", "vite.config.ts"],
  }, null, 2) + "\n";
  files[".gitignore"] = "node_modules/\ndist/\n";
  files["README.md"] = [
    "# React + Vite export", "",
    "Generated by Tsumu (https://github.com/abshrimp/tsumu).", "",
    "Run npm install and npm run dev, or npm run build to create dist/.",
    "This is a client-rendered SPA (no SSR). Public API requests run in the browser and require CORS.",
    "The build includes HTML metadata for fixed routes and a 404.html. Configure your static host to serve directory indexes and its error document.",
    "Use the Next.js format for dynamic data, redirects, reverse proxies or SEO-sensitive pages.", "",
  ].join("\n");
  return { files, binaries: { ...next.binaries }, remoteAssets: { ...next.remoteAssets } };
}
