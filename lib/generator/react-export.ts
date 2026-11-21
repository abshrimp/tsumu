import type { SiteDoc } from "../types";
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
  const pages = doc.pageOrder.map((id) => doc.pages[id])
    .filter((page) => page && !page.unpublished && page.slug.replace(/^\/+|\/+$/g, "") !== "404");
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
    "type Route = { path: string; query: Record<string, string>; title: string; description: string; noindex: boolean; lang: string; Component: ComponentType };",
    "const routes: Route[] = [", ...entries, "];", "",
    "export default function App() {",
    '  const pathname = (() => {',
    '    try { return decodeURI(window.location.pathname); }',
    '    catch { return window.location.pathname; }',
    '  })().replace(/\\/+$/, "") || "/";',
    '  const search = new URLSearchParams(window.location.search);',
    '  const matches = routes.filter((item) => item.path === pathname && Object.entries(item.query).every(([key, value]) => search.get(key) === value));',
    '  const route = matches.sort((a, b) => Object.keys(b.query).length - Object.keys(a.query).length)[0] ?? routes.find((item) => item.path === pathname);',
    '  const Page = route?.Component ?? NotFound;',
    '  useEffect(() => {',
    '    document.title = route ? route.title + " | " + SITE_NAME : SITE_NAME;',
    '    document.documentElement.lang = route?.lang ?? ' + JSON.stringify(doc.lang || "ja") + ";",
    '    document.querySelector(\'meta[name="description"]\')?.setAttribute("content", route?.description ?? "");',
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
    '      {route?.noindex && <meta name="robots" content="noindex, nofollow" />}',
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

  const assetNames = buildAssetNames(doc);
  const favicon = imageRefSrc(assetNames, doc.favicon);
  const appleIcon = imageRefSrc(assetNames, doc.appleTouchIcon);
  const ogSrc = imageRefSrc(assetNames, doc.ogImage);
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
    ogSrc ? '<meta property="og:image" content="' + esc(ogSrc) + '">' : "",
    ogSrc ? '<meta name="twitter:card" content="summary_large_image">' : "",
  ].filter(Boolean).join("\n    ");
  files["index.html"] = [
    "<!doctype html>", '<html lang="' + esc(doc.lang || "ja") + '">', "  <head>",
    '    <meta charset="UTF-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '    <meta name="description" content="">',
    "    " + icons,
    "    <title>" + esc(doc.siteName) + "</title>",
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
  files["vite.config.ts"] = [
    'import { defineConfig } from "vite";',
    'import { fileURLToPath } from "node:url";', "",
    "export default defineConfig({",
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
    "On a static host, configure fallback to index.html for deep links.",
    "Use the Next.js format for dynamic data, redirects, reverse proxies or SEO-sensitive pages.", "",
  ].join("\n");
  return { files, binaries: { ...next.binaries }, remoteAssets: { ...next.remoteAssets } };
}
