import { build, transformSync } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const require = createRequire(resolve("package.json"));
const layoutPath = resolve("app/sites/[id]/layout.tsx");
// 修正前の構造でも同じ再現を実行する（エディタ専用レイアウトは無かった）。
const layoutSource = existsSync(layoutPath) ? readFileSync(layoutPath, "utf8") :
  "export const metadata = {}; export default function Layout({ children }) { return children; }";
const errorPath = resolve("app/sites/[id]/error.tsx");
const hasScopedError = existsSync(errorPath);
const rootErrorSource = readFileSync(resolve("app/error.tsx"), "utf8");
const errorSource = hasScopedError ? readFileSync(errorPath, "utf8") : rootErrorSource;
// Keep exercising the real loading UI after it was extracted for the document-loading phase.
const loadingPath = resolve("components/EditorLoading.tsx");
const loadingSource = existsSync(loadingPath) ? readFileSync(loadingPath, "utf8") : null;
const pageSource = readFileSync(resolve("app/sites/[id]/page.tsx"), "utf8").replace(
  /import EditorLoading from "\.\.\/\.\.\/\.\.\/components\/EditorLoading";/,
  loadingSource ? 'import { glyphs } from "../../../components/Glyph";\n' + loadingSource.replace(/^import .*;$/gm, "").replace(/export default function/, "function") : "",
);

function evaluate(source: string, mocks: Record<string, unknown>) {
  const module = { exports: {} as any };
  const code = transformSync(source, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
  new Function("require", "module", "exports", code)(
    (name: string) => name in mocks ? mocks[name] : require(name), module, module.exports,
  );
  return module.exports;
}

export async function editorTitleFixture() {
  const root = evaluate(readFileSync(resolve("app/layout.tsx"), "utf8"), {
    "./globals.css": {},
    "../lib/i18n-server": { serverTr: async () => (s: string) => s, serverLang: async () => "ja" },
  });
  const layout = evaluate(layoutSource, {});
  const rootMetadata = await root.generateMetadata();
  const { resolveTitle } = require("next/dist/lib/metadata/resolvers/resolve-title");
  const inheritedTitle = resolveTitle(
    Object.hasOwn(layout.metadata ?? {}, "title") ? layout.metadata.title : rootMetadata.title, null,
  ).absolute;
  return { Layout: layout.default, rootMetadata, inheritedTitle };
}

export async function editorTitleBundle() {
  const { inheritedTitle } = await editorTitleFixture();
  return (await build({
    stdin: {
      contents: `
import React, { Suspense, use, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { ErrorBoundaryHandler } from "next/dist/client/components/error-boundary";
import SitePage from "title-page";
import SiteLayout from "title-layout";
import ErrorPage from "title-error";
let finishMetadata;
const metadata = new Promise((resolve) => { finishMetadata = resolve; });
function Metadata() {
  use(metadata);
  useEffect(() => { window.metadataReady = true; }, []);
  return ${JSON.stringify(inheritedTitle)} ? React.createElement("title", null, ${JSON.stringify(inheritedTitle)}) : null;
}
window.finishMetadata = () => finishMetadata();
function EditorRoute() {
  const page = React.createElement(SitePage);
  const boundary = (children) => React.createElement(ErrorBoundaryHandler,
    { pathname: "/sites/title-test", errorComponent: ErrorPage }, children);
  return ${JSON.stringify(hasScopedError)}
    ? React.createElement(SiteLayout, null, boundary(page))
    : boundary(React.createElement(SiteLayout, null, page));
}
window.titleHydrationErrors = [];
window.titleCaughtErrors = [];
const options = {
  onRecoverableError: (error) => window.titleHydrationErrors.push(error.message),
  onCaughtError: (error) => window.titleCaughtErrors.push(error.message),
};
let root;
if (window.titleHydrate) {
  root = hydrateRoot(document, React.createElement("html", null,
    React.createElement("head"), React.createElement("body", null,
      React.createElement("div", { id: "app" }, React.createElement(EditorRoute)))), options);
} else {
  root = createRoot(document.getElementById("app"), options);
  root.render(React.createElement(React.Fragment, null,
    React.createElement(EditorRoute),
    React.createElement(Suspense, { fallback: null }, React.createElement(Metadata)),
  ));
}
window.disposeTitleFixture = () => root.unmount();
`,
      loader: "tsx", sourcefile: "editor-title-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env.__NEXT_APP_NAV_FAIL_HANDLING": "false" },
    plugins: [{
      name: "title-fixture",
      setup(build) {
        // Next のクライアントビルドと同じ、サーバー専用ストレージのブラウザ版を使う。
        build.onResolve({ filter: /\/server-async-storage$/ }, () => ({
          path: require.resolve("next/dist/client/components/server-async-storage.browser"),
        }));
        build.onResolve({ filter: /^(title-page|title-layout|title-error)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
        build.onResolve({ filter: /^\.\.\/\.\.\/error$/, namespace: "fixture" }, () => ({ path: "title-root-error", namespace: "fixture" }));
        build.onResolve({ filter: /^\.\.\/lib\/i18n$/, namespace: "fixture" }, (args) => ({ path: args.path, namespace: "fixture" }));
        build.onResolve({ filter: /^\.\.\/\.\.\/\.\.\//, namespace: "fixture" }, (args) => ({ path: args.path, namespace: "fixture" }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
          let contents: string;
          if (args.path === "title-page") contents = `const fetch = window.titleFetch;\n${pageSource}`;
          else if (args.path === "title-layout") contents = layoutSource;
          else if (args.path === "title-error") contents = errorSource;
          else if (args.path === "title-root-error") contents = rootErrorSource;
          else if (args.path.endsWith("/Editor")) contents = `
import { useLayoutEffect, useState } from "react";
export default function Editor({ onReady }) {
  useLayoutEffect(() => { onReady?.(); }, [onReady]);
  const [, refresh] = useState(0);
  window.failTitleEditor = () => { window.titleEditorFailed = true; refresh((n) => n + 1); };
  if (window.titleEditorFailed) throw new Error("title fixture editor failure");
  return <div data-editor-ready="true">editor</div>;
}`;
          else if (args.path.endsWith("/BrandMark")) contents = "export default function BrandMark() { return null; }";
          else if (args.path.endsWith("/Glyph")) contents = "export const glyphs = (value) => value;";
          else if (args.path.endsWith("/i18n")) contents = "export const tr = (value) => value; export const loadLocale = async () => {};";
          else if (args.path.endsWith("/site")) contents = 'export const currentSiteId = () => "title-test"; export const loadLocalSites = () => window.titleLocalSites || [];';
          else throw new Error(`Unexpected fixture import: ${args.path}`);
          return { contents, loader: "tsx", resolveDir: resolve(".") };
        });
      },
    }],
  })).outputFiles[0].text;
}

/** 実際の読み込み画面を SSR し、同じページとレイアウトをブラウザで hydration する。 */
export async function editorTitleHydrationHtml() {
  const { Layout } = await editorTitleFixture();
  const { default: Page } = evaluate(pageSource, {
    "../../../components/BrandMark": { default: () => null, __esModule: true },
    "../../../components/Glyph": { glyphs: (value: string) => value },
    "../../../lib/i18n": { tr: (value: string) => value, loadLocale: async () => {} },
    "../../../lib/site": { currentSiteId: () => "title-test", loadLocalSites: () => [] },
  });
  return "<!DOCTYPE html>" + renderToString(createElement("html", null,
    createElement("head"), createElement("body", null,
      createElement("div", { id: "app" }, createElement(Layout, null, createElement(Page))))));
}
