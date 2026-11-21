import type { SiteDoc } from "../types";
import type { GeneratedProject, PublishTarget } from "../generator";
import type { ExportLanguage } from "./export-options";
import { googleFontsCss, usedAdobeFonts } from "./css";
import { adobeFontHead, adobeFontLoader, adobeFontProjects } from "./adobe-fonts";
import { buildAssetNames } from "./names";
import { imageRefSrc } from "./render-helpers";
import { buildPwaManifest } from "./templates";
import { applyNativeFramework } from "./native-scaffold";

/**
 * Vue・Nuxt・SvelteKit では、既存のブラウザ専用のデータとイベントの仕組みを、
 * フレームワークのコンポーネントの中で動かす。アプリとルートのマークアップは、
 * 隠れた Next.js や React のプロジェクトではなく、そのフレームワークが描画する。
 */
type AdditionalFramework = "vue" | "nuxt" | "sveltekit";

const escapeTemplateHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function frameworkHeadTags(doc: SiteDoc, assetNames = buildAssetNames(doc)): string {
  const favicon = imageRefSrc(assetNames, doc.favicon);
  const appleIcon = imageRefSrc(assetNames, doc.appleTouchIcon);
  const ogSrc = imageRefSrc(assetNames, doc.ogImage);
  const pwaThemeColor = doc.pwa?.enabled ? doc.pwa.themeColor?.trim() : "";
  return [
    doc.pwa?.enabled ? '<link rel="manifest" href="/manifest.webmanifest">' : "",
    pwaThemeColor ? '<meta name="theme-color" content="' + escapeTemplateHtml(pwaThemeColor) + '">' : "",
    favicon ? '<link rel="icon" href="' + escapeTemplateHtml(favicon) + '">' : "",
    appleIcon ? '<link rel="apple-touch-icon" href="' + escapeTemplateHtml(appleIcon) + '">' : "",
    ogSrc ? '<meta property="og:image" content="' + escapeTemplateHtml(ogSrc) + '">' : "",
    ogSrc ? '<meta name="twitter:card" content="summary_large_image">' : "",
  ].filter(Boolean).join("");
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function packageName(doc: SiteDoc): string {
  return doc.siteName.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "website";
}

function commonFiles(doc: SiteDoc, next: GeneratedProject, framework: AdditionalFramework) {
  const files: Record<string, string> = {};
  const assetPrefix = framework === "sveltekit" ? "static/" : "public/";
  for (const [path, content] of Object.entries(next.files)) {
    if (path.startsWith("public/")) files[assetPrefix + path.slice(7)] = content;
  }
  const assetNames = buildAssetNames(doc);
  const manifest = buildPwaManifest(doc, assetNames);
  if (manifest) {
    files[assetPrefix + "manifest.webmanifest"] = JSON.stringify(manifest, null, 2) + "\n";
  }
  const binaries = Object.fromEntries(Object.entries(next.binaries).map(([path, b64]) =>
    [path.startsWith("public/") ? assetPrefix + path.slice(7) : path, b64]));
  const remoteAssets = Object.fromEntries(Object.entries(next.remoteAssets).map(([path, source]) =>
    [path.startsWith("public/") ? assetPrefix + path.slice(7) : path, source]));
  const baseCss = googleFontsCss(doc) + next.files["app/globals.css"];
  const siteCss = next.files["styles/site.css"];
  return { files, binaries, remoteAssets, baseCss, siteCss, assetNames };
}

const jsonIndent = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function buildAdditionalFramework(
  doc: SiteDoc, next: GeneratedProject, framework: AdditionalFramework,
  language: ExportLanguage, target: PublishTarget = "production", classes?: Map<string, string>,
): GeneratedProject {
  const common = commonFiles(doc, next, framework);
  const files = common.files;
  const ts = language === "typescript";
  const ext = ts ? "ts" : "js";
  const headExtras = frameworkHeadTags(doc, common.assetNames);
  if (framework === "vue") {
    files["src/globals.css"] = common.baseCss;
    files["src/site.css"] = common.siteCss;
    files["src/main." + ext] = [
      'import { createApp } from "vue";',
      'import App from "./App.vue";',
      'import "./globals.css";',
      'import "./site.css";',
      'createApp(App).mount("#app");', "",
    ].join("\n");
    files["index.html"] = [
      "<!doctype html>", '<html lang="' + escapeTemplateHtml(doc.lang || "ja") + '">',
      '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="description" content="">' + headExtras + '<title>' + escapeTemplateHtml(doc.siteName) + "</title></head>",
      '<body><div id="app"></div><script type="module" src="/src/main.' + ext + '"></script></body>',
      '</html>', "",
    ].join("\n");
    files["vite.config." + ext] = [
      'import { defineConfig } from "vite";',
      'import vue from "@vitejs/plugin-vue";',
      'export default defineConfig({ plugins: [vue()] });', "",
    ].join("\n");
    files["package.json"] = jsonIndent({
      name: packageName(doc), private: true, version: "0.1.0", type: "module",
      scripts: { dev: "vite", build: ts ? "vue-tsc --noEmit && vite build" : "vite build", preview: "vite preview" },
      dependencies: { vue: "^3.5.25" },
      devDependencies: { "@vitejs/plugin-vue": "^6.0.2", vite: "^7.3.1",
        ...(ts ? { typescript: "^5.9.3", "vue-tsc": "^3.1.0" } : {}) },
    });
    if (ts) files["tsconfig.json"] = jsonIndent({
      compilerOptions: { target: "ES2024", module: "ESNext", moduleResolution: "Bundler",
        allowJs: true, checkJs: false,
        strict: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true,
        allowImportingTsExtensions: true, noEmit: true, lib: ["ES2024", "DOM"] },
      include: ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"],
    });
    // Vite は *.module.css の環境の型を提供する。この参照が無いと、CSS Modules を選んだ
    // Vue の TS のプロジェクトで vue-tsc が失敗する。
    if (ts) files["src/env.d.ts"] = '/// <reference types="vite/client" />\n';
  } else if (framework === "nuxt") {
    files["app/assets/globals.css"] = common.baseCss;
    files["app/assets/site.css"] = common.siteCss;
    // Nuxt には、共通のプレビューの後処理で使う HTML の入口のファイルが無い。
    // すべての SSR のルートが受け取れるよう、全体の head に指定を置く。
    const adobe = adobeFontProjects(usedAdobeFonts(doc));
    const favicon = imageRefSrc(common.assetNames, doc.favicon);
    const appleIcon = imageRefSrc(common.assetNames, doc.appleTouchIcon);
    const ogSrc = imageRefSrc(common.assetNames, doc.ogImage);
    const pwaThemeColor = doc.pwa?.enabled ? doc.pwa.themeColor?.trim() : "";
    const links: Array<{ rel: string; href: string }> = [
      ...(doc.pwa?.enabled ? [{ rel: "manifest", href: "/manifest.webmanifest" }] : []),
      ...(favicon ? [{ rel: "icon", href: favicon }] : []),
      ...(appleIcon ? [{ rel: "apple-touch-icon", href: appleIcon }] : []),
      ...adobe.filter(p => p.loading === "css").map(p => ({
        rel: "stylesheet", href: `https://use.typekit.net/${p.kitId}.css`,
      })),
    ];
    const adobeScripts = adobe.filter(p => p.loading === "dynamic").map(p => ({
      innerHTML: adobeFontLoader(p.kitId),
    }));
    const meta: Array<Record<string, string>> = [
      { name: "description", content: "" },
      ...(pwaThemeColor ? [{ name: "theme-color", content: pwaThemeColor }] : []),
      ...(ogSrc ? [{ property: "og:image", content: ogSrc }, { name: "twitter:card", content: "summary_large_image" }] : []),
      ...(target === "test"
        ? [{ name: "robots", content: "noindex, nofollow, noarchive, nosnippet, noimageindex" }] : []),
    ];
    files["nuxt.config." + ext] = [
      'export default defineNuxtConfig({',
      '  ssr: true,',
      '  css: ["~/assets/globals.css", "~/assets/site.css"],',
      '  app: { head: { title: ' + json(doc.siteName) + ', meta: ' + json(meta) +
        ', link: ' + json(links) + ', script: ' + json(adobeScripts) + ' } },',
      '});', "",
    ].join("\n");
    files["package.json"] = jsonIndent({
      name: packageName(doc), private: true, version: "0.1.0", type: "module",
      scripts: { dev: "nuxt dev", build: "nuxt build", generate: "nuxt generate",
        preview: "nuxt preview", postinstall: "nuxt prepare" },
      dependencies: { nuxt: "^4.6.4", vue: "^3.5.25" },
      // Keep generated Nuxt installs reproducible when an upstream package
      // requests an unpublished @babel/parser patch version.
      // Also avoid vulnerable old glob/minimatch transitive dependencies.
      overrides: { glob: "^14.0.2", minimatch: "^11.0.1", "@babel/parser": "7.29.14", "@babel/types": "7.29.14" },
      devDependencies: ts ? { typescript: "^5.9.3" } : {},
    });
  } else {
    files["src/globals.css"] = common.baseCss;
    files["src/site.css"] = common.siteCss;
    files["src/app.html"] = [
      "<!doctype html>", '<html lang="%page.language%">',
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      headExtras + adobeFontHead(doc) + '%sveltekit.head%</head><body data-sveltekit-preload-data="hover">',
      '<div style="display:contents">%sveltekit.body%</div></body></html>', "",
    ].join("\n");
    files["src/routes/+layout." + ext] = 'export const ssr = true;\nexport const prerender = false;\n';
    files["vite.config." + ext] = [
      'import adapter from "@sveltejs/adapter-node";',
      'import { sveltekit } from "@sveltejs/kit/vite";',
      'import { defineConfig } from "vite";',
      'export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })] });', "",
    ].join("\n");
    files["package.json"] = jsonIndent({
      name: packageName(doc), private: true, version: "0.1.0", type: "module",
      scripts: { dev: "vite dev", build: "vite build", preview: "vite preview",
        ...(ts ? { check: "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json" } : {}) },
      dependencies: { "@sveltejs/kit": "^3.1.1", svelte: "^5.57.1" },
      devDependencies: {
        "@sveltejs/adapter-node": "^6.0.0",
        "@sveltejs/vite-plugin-svelte": "^7.3.1", vite: "^8.0.12",
        typescript: "^6.0.0",
        ...(ts ? { "svelte-check": "^4.3.0" } : {}),
      },
      imports: { "#lib": "./src/lib/index.js", "#lib/*": "./src/lib/*" },
    });
    if (ts) files["tsconfig.json"] = jsonIndent({
      extends: "$app/tsconfig",
      compilerOptions: { allowJs: true, checkJs: false, esModuleInterop: true,
        skipLibCheck: true, resolveJsonModule: true, strict: true, moduleResolution: "bundler" },
    });
  }
  files[".gitignore"] = "node_modules/\ndist/\n.nuxt/\n.output/\n.svelte-kit/\nbuild/\n";
  return applyNativeFramework(doc, { files, binaries: common.binaries, remoteAssets: common.remoteAssets }, framework, language, target, classes);
}
