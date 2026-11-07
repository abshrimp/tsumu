import type { SiteDoc } from "../types";
import type { GeneratedProject } from "../generator";
import type { ExportLanguage } from "../export-formats";
import { obfuscateVarNames } from "../data";
import { scriptsFile } from "../script-runtime";
import { PAGE_DATA_RUNTIME } from "./browser-data";
import { reactClientPageFragment } from "./html-export";
import { usedGoogleFonts } from "./css";

/**
 * Vue, Nuxt and SvelteKit run the existing browser-only data and event
 * engine inside framework components. The app/route markup is rendered by
 * the framework, not a hidden Next.js or React project.
 */
export type AdditionalFramework = "vue" | "nuxt" | "sveltekit";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function generatedRoutes(doc: SiteDoc): string {
  const pages = doc.pageOrder.map((id) => doc.pages[id])
    .filter((page) => page && !page.unpublished && page.slug.replace(/^\/+|\/+$/g, "") !== "404");
  const entries = pages.map((page) => ({
    path: "/" + page.slug.replace(/^\/+|\/+$/g, ""),
    query: Object.fromEntries(new URLSearchParams(page.query || "")),
    title: page.title || page.name,
    description: page.description,
    lang: page.lang || doc.lang || "ja",
    html: reactClientPageFragment(doc, page),
  }));
  return [
    "// Pages are data-driven DOM fragments with native browser event scripts.",
    "export const routes = " + json(entries) + ";",
    "export function currentPage() {",
    '  const path = (() => { try { return decodeURI(window.location.pathname); }',
    '    catch { return window.location.pathname; } })().replace(/\\/+$/, "") || "/";',
    "  const search = new URLSearchParams(window.location.search);",
    "  const candidates = routes.filter((route) => route.path === path);",
    "  const matched = candidates.filter((route) =>",
    "    Object.entries(route.query).every(([key, value]) => search.get(key) === value));",
    "  matched.sort((a, b) => Object.keys(b.query).length - Object.keys(a.query).length);",
    "  return matched[0] || candidates[0] || null;",
    "}",
    "export function pageTitle(route) {",
    "  return route ? route.title + ' | ' + " + json(doc.siteName) + " : " + json(doc.siteName) + ";",
    "}",
    "",
  ].join("\n");
}

function startup(scripts: string[]): string {
  return [
    "/** Load optional browser behaviors after the framework mounts the page. */",
    "export async function startPage() {",
    "  for (const src of " + json(scripts) + ") {",
    "    await new Promise((resolve) => {",
    '      const script = document.createElement("script");',
    "      script.src = src;",
    "      script.onload = () => resolve();",
    "      script.onerror = () => resolve();",
    "      document.body.appendChild(script);",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function fonts(doc: SiteDoc): string {
  const fonts = usedGoogleFonts(doc);
  const imports = fonts.map((font) =>
    '@import url("https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(font.value).replace(/%20/g, "+") +
    ':wght@' + (font.google?.weights?.length ? font.google.weights.join(";") : "400") +
    '&display=swap");');
  const declarations = fonts.map((font) =>
    "  " + font.google!.cssVar + ': "' + font.value.replace(/"/g, '\\"') + '", sans-serif;');
  return imports.join("\n") + (declarations.length ? "\n:root {\n" +
    declarations.join("\n") + "\n}\n" : "");
}

function packageName(doc: SiteDoc): string {
  return doc.siteName.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "website";
}

function commonFiles(doc: SiteDoc, next: GeneratedProject, framework: AdditionalFramework) {
  const files: Record<string, string> = {};
  const assetPrefix = framework === "sveltekit" ? "static/" : "public/";
  const normalized = obfuscateVarNames(doc);
  for (const [path, content] of Object.entries(next.files)) {
    if (path.startsWith("public/")) files[assetPrefix + path.slice(7)] = content;
  }
  const binaries = Object.fromEntries(Object.entries(next.binaries).map(([path, b64]) =>
    [path.startsWith("public/") ? assetPrefix + path.slice(7) : path, b64]));
  const remoteAssets = Object.fromEntries(Object.entries(next.remoteAssets).map(([path, source]) =>
    [path.startsWith("public/") ? assetPrefix + path.slice(7) : path, source]));
  files[assetPrefix + "data-loader.js"] = PAGE_DATA_RUNTIME;
  files[assetPrefix + "scripts.js"] = scriptsFile(normalized, true);
  const scriptPaths = ["inview.js", "data-loader.js", "scripts.js", "pwa.js"]
    .filter((file) => !!files[assetPrefix + file]).map((name) => "/" + name);
  files[assetPrefix + "browser-start.js"] = startup(scriptPaths);
  const baseCss = fonts(doc) + "\n" + next.files["app/globals.css"];
  const siteCss = next.files["styles/site.css"];
  files["README.md"] = [
    "# " + (framework === "vue" ? "Vue 3 + Vite" : framework === "nuxt" ? "Nuxt 4" : "SvelteKit") + " export",
    "", "Generated website project.", "",
    "Run npm install and npm run dev to start; npm run build creates production files.",
    "Pages use a browser-side data runner: public APIs must permit CORS.",
    "The generated app uses client-side routing. Configure your host to fall back",
    "to the application entry point for deep links. It does not provide SSR.",
    "",
  ].join("\n");
  return { files, binaries, remoteAssets, baseCss, siteCss };
}

const jsonIndent = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function buildAdditionalFramework(
  doc: SiteDoc, next: GeneratedProject, framework: AdditionalFramework,
  language: ExportLanguage,
): GeneratedProject {
  const common = commonFiles(doc, next, framework);
  const files = common.files;
  const ts = language === "typescript";
  const ext = ts ? "ts" : "js";
  const root = framework === "nuxt" ? "app/" : "src/";
  const routesPath = root + "site-routes." + ext;
  files[routesPath] = generatedRoutes(doc);
  files[root + "browser-start." + ext] = files[(framework === "sveltekit" ? "static/" : "public/") +
    "browser-start.js"];
  delete files[(framework === "sveltekit" ? "static/" : "public/") + "browser-start.js"];

  if (framework === "vue") {
    files["src/globals.css"] = common.baseCss;
    files["src/site.css"] = common.siteCss;
    files["src/App.vue"] = [
      '<script setup' + (ts ? ' lang="ts"' : "") + '>',
      'import { onMounted, nextTick, ref } from "vue";',
      'import { currentPage, pageTitle } from "./site-routes";',
      'import { startPage } from "./browser-start";',
      ts ? 'const current = ref<ReturnType<typeof currentPage>>(null);' : 'const current = ref(null);',
      'onMounted(async () => {',
      '  current.value = currentPage();',
      '  document.title = pageTitle(current.value);',
      '  document.documentElement.lang = current.value?.lang || ' + json(doc.lang || "ja") + ";",
      '  const meta = document.querySelector(\'meta[name="description"]\');',
      '  if (meta) meta.setAttribute("content", current.value?.description || "");',
      '  await nextTick();',
      '  await startPage();',
      '});',
      '</script>',
      '<template>',
      '  <main v-if="current" style="display:contents" v-html="current.html"></main>',
      '  <main v-else><h1>Not Found</h1></main>',
      '</template>', "",
    ].join("\n");
    files["src/main." + ext] = [
      'import { createApp } from "vue";',
      'import App from "./App.vue";',
      'import "./globals.css";',
      'import "./site.css";',
      'createApp(App).mount("#app");', "",
    ].join("\n");
    files["index.html"] = [
      "<!doctype html>", '<html lang="' + (doc.lang || "ja") + '">',
      '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="description" content=""><title>' + doc.siteName.replace(/[<>&"]/g, "") + "</title></head>",
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
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
        strict: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true,
        allowImportingTsExtensions: true, noEmit: true, lib: ["ES2022", "DOM"] },
      include: ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"],
    });
  } else if (framework === "nuxt") {
    files["app/assets/globals.css"] = common.baseCss;
    files["app/assets/site.css"] = common.siteCss;
    files["app/app.vue"] = [
      '<script setup' + (ts ? ' lang="ts"' : "") + '>',
      'import { ref, onMounted, nextTick } from "vue";',
      'import { currentPage, pageTitle } from "./site-routes";',
      'import { startPage } from "./browser-start";',
      'const current = ref(null);',
      'onMounted(async () => {',
      '  current.value = currentPage();',
      '  document.title = pageTitle(current.value);',
      '  document.documentElement.lang = current.value?.lang || ' + json(doc.lang || "ja") + ";",
      '  const meta = document.querySelector(\'meta[name="description"]\');',
      '  if (meta) meta.setAttribute("content", current.value?.description || "");',
      '  await nextTick();',
      '  await startPage();',
      '});',
      '</script>',
      '<template>',
      '  <main v-if="current" style="display:contents" v-html="current.html"></main>',
      '  <main v-else><h1>Not Found</h1></main>',
      '</template>', "",
    ].join("\n");
    files["nuxt.config." + ext] = [
      'export default defineNuxtConfig({',
      '  ssr: false,',
      '  css: ["~/assets/globals.css", "~/assets/site.css"],',
      '  app: { head: { title: ' + json(doc.siteName) + ', meta: [{ name: "description", content: "" }] } },',
      '});', "",
    ].join("\n");
    files["package.json"] = jsonIndent({
      name: packageName(doc), private: true, version: "0.1.0", type: "module",
      scripts: { dev: "nuxt dev", build: "nuxt build", generate: "nuxt generate",
        preview: "nuxt preview", postinstall: "nuxt prepare" },
      dependencies: { nuxt: "^4.3.0", vue: "^3.5.25" },
      devDependencies: ts ? { typescript: "^5.9.3" } : {},
    });
  } else {
    files["src/globals.css"] = common.baseCss;
    files["src/site.css"] = common.siteCss;
    files["src/app.html"] = [
      "<!doctype html>", '<html lang="' + (doc.lang || "ja") + '">',
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="description" content=""><title>' + doc.siteName.replace(/[<>&"]/g, "") + '</title>',
      '%sveltekit.head%</head><body data-sveltekit-preload-data="hover">',
      '<div style="display:contents">%sveltekit.body%</div></body></html>', "",
    ].join("\n");
    files["src/routes/+layout." + ext] = 'export const ssr = false;\nexport const prerender = false;\n';
    files["src/routes/+page.svelte"] = [
      '<script' + (ts ? ' lang="ts"' : "") + '>',
      'import { onMount, tick } from "svelte";',
      'import "../globals.css";',
      'import "../site.css";',
      'import { currentPage, pageTitle } from "../site-routes";',
      'import { startPage } from "../browser-start";',
      'let html = "";',
      'onMount(async () => {',
      '  const current = currentPage();',
      '  html = current?.html || "<h1>Not Found</h1>";',
      '  document.title = pageTitle(current);',
      '  document.documentElement.lang = current?.lang || ' + json(doc.lang || "ja") + ";",
      '  const meta = document.querySelector(\'meta[name="description"]\');',
      '  if (meta) meta.setAttribute("content", current?.description || "");',
      '  await tick();',
      '  await startPage();',
      '});',
      '</script>',
      '{@html html}', "",
    ].join("\n");
    files["svelte.config.js"] = [
      'import adapter from "@sveltejs/adapter-static";',
      'import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";',
      'export default { preprocess: vitePreprocess(), kit: {',
      '  adapter: adapter({ fallback: "200.html" }),',
      '  prerender: { entries: [] },',
      '} };', "",
    ].join("\n");
    files["vite.config." + ext] = [
      'import { defineConfig } from "vite";',
      'import { sveltekit } from "@sveltejs/kit/vite";',
      'export default defineConfig({ plugins: [sveltekit()] });', "",
    ].join("\n");
    files["package.json"] = jsonIndent({
      name: packageName(doc), private: true, version: "0.1.0", type: "module",
      scripts: { dev: "vite dev", build: "vite build", preview: "vite preview",
        ...(ts ? { check: "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json" } : {}) },
      dependencies: { "@sveltejs/kit": "^2.48.0", svelte: "^5.43.0" },
      devDependencies: { "@sveltejs/adapter-static": "^3.0.10",
        "@sveltejs/vite-plugin-svelte": "^6.2.1", vite: "^7.3.1",
        ...(ts ? { typescript: "^5.9.3", "svelte-check": "^4.3.0" } : {}) },
    });
    if (ts) files["tsconfig.json"] = jsonIndent({
      extends: "./.svelte-kit/tsconfig.json",
      compilerOptions: { allowJs: true, checkJs: false, esModuleInterop: true,
        skipLibCheck: true, resolveJsonModule: true, strict: true, moduleResolution: "bundler" },
    });
  }
  files[".gitignore"] = "node_modules/\ndist/\n.nuxt/\n.output/\n.svelte-kit/\nbuild/\n";
  return { files, binaries: common.binaries, remoteAssets: common.remoteAssets };
}
