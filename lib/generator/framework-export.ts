import type { SiteDoc } from "../types";
import type { GeneratedProject } from "../generator";
import type { ExportLanguage } from "../export-formats";
import { obfuscateVarNames } from "../data";
import { scriptsFile } from "../script-runtime";
import { usedGoogleFonts } from "./css";
import { applyNativeFramework } from "./native-scaffold";

/**
 * Vue, Nuxt and SvelteKit run the existing browser-only data and event
 * engine inside framework components. The app/route markup is rendered by
 * the framework, not a hidden Next.js or React project.
 */
export type AdditionalFramework = "vue" | "nuxt" | "sveltekit";

const escapeTemplateHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Quote a font name as a single CSS string token. */
function cssQuoted(value: string): string {
  return '"' + value.replace(/[\x00-\x1f\x7f"\\]/g, (char) =>
    "\\" + char.codePointAt(0)!.toString(16) + " ") + '"';
}

function fonts(doc: SiteDoc): string {
  const fonts = usedGoogleFonts(doc);
  const imports = fonts.map((font) =>
    '@import url("https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(font.value).replace(/%20/g, "+") +
    ':wght@' + (font.google?.weights?.length ? font.google.weights.join(";") : "400") +
    '&display=swap");');
  const declarations = fonts.filter((font) => /^--[\w-]+$/.test(font.google!.cssVar)).map((font) =>
    "  " + font.google!.cssVar + ": " + cssQuoted(font.value) + ", sans-serif;");
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
  files[assetPrefix + "scripts.js"] = scriptsFile(normalized, true);
  const baseCss = fonts(doc) + "\n" + next.files["app/globals.css"];
  const siteCss = next.files["styles/site.css"];
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
      '<meta name="description" content=""><title>' + escapeTemplateHtml(doc.siteName) + "</title></head>",
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
        allowJs: true, checkJs: false,
        strict: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true,
        allowImportingTsExtensions: true, noEmit: true, lib: ["ES2022", "DOM"] },
      include: ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"],
    });
    // Vite provides *.module.css ambient types. Without this reference,
    // Vue TS projects fail vue-tsc when CSS Modules are selected.
    if (ts) files["src/env.d.ts"] = '/// <reference types="vite/client" />\n';
  } else if (framework === "nuxt") {
    files["app/assets/globals.css"] = common.baseCss;
    files["app/assets/site.css"] = common.siteCss;
    files["nuxt.config." + ext] = [
      'export default defineNuxtConfig({',
      '  ssr: true,',
      '  css: ["~/assets/globals.css", "~/assets/site.css"],',
      '  app: { head: { title: ' + json(doc.siteName) + ', meta: [{ name: "description", content: "" }] } },',
      '});', "",
    ].join("\n");
    files["package.json"] = jsonIndent({
      name: packageName(doc), private: true, version: "0.1.0", type: "module",
      scripts: { dev: "nuxt dev", build: "nuxt build", generate: "nuxt generate",
        preview: "nuxt preview", postinstall: "nuxt prepare" },
      dependencies: { nuxt: "^4.6.4", vue: "^3.5.25" },
      // Bypass vulnerable older transitive glob/minimatch releases in Nuxt tooling.
      overrides: { glob: "^14.0.2", minimatch: "^11.0.1" },
      devDependencies: ts ? { typescript: "^5.9.3" } : {},
    });
  } else {
    files["src/globals.css"] = common.baseCss;
    files["src/site.css"] = common.siteCss;
    files["src/app.html"] = [
      "<!doctype html>", '<html lang="' + escapeTemplateHtml(doc.lang || "ja") + '">',
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="description" content=""><title>' + escapeTemplateHtml(doc.siteName) + '</title>',
      '%sveltekit.head%</head><body data-sveltekit-preload-data="hover">',
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
  return applyNativeFramework(doc, { files, binaries: common.binaries, remoteAssets: common.remoteAssets }, framework, language);
}
