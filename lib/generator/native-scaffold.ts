import type { SiteDoc } from "../types";
import type { GeneratedProject } from "../generator";
import type { ExportLanguage } from "../export-formats";
import { generateNativeFiles } from "./native-components";
import { nativeDataModule } from "./native-data";
import { withVueSsr } from "./vue-ssr";

type Framework = "vue" | "nuxt" | "sveltekit";
const json = JSON.stringify;

function routesFile(pages: ReturnType<typeof generateNativeFiles>["pages"]): string {
  const plain = pages.map(({ id, name, title, description, slug, query, language, plan }) =>
    ({ id, name, title, description, path: "/" + slug.replace(/^\/+|\/+$/g, ""), query, language, plan }));
  return [
    "export const pages = " + json(plain) + ";",
    "export function selectPage(pathname, query) {",
    '  const path = String(pathname || "/").replace(/\\/+$/, "") || "/";',
    "  const search = new URLSearchParams(query);",
    "  const matches = pages.filter((page) => page.path === path);",
    "  const eligible = matches.filter((page) => Object.entries(page.query).every(",
    "    ([key, value]) => search.get(key) === value));",
    "  eligible.sort((a,b) => Object.keys(b.query).length - Object.keys(a.query).length);",
    "  return eligible[0] || matches[0] || null;",
    "}", "",
  ].join("\n");
}

function serverRequestSource(pages: ReturnType<typeof generateNativeFiles>["pages"]): string {
  const origins = new Set<string>();
  for (const page of pages) for (const step of page.plan.steps) {
    if (step.kind !== "fetch") continue;
    try {
      const url = new URL(step.url);
      if (url.hostname.includes("{") || !/^https?:$/.test(url.protocol)) continue;
      origins.add(url.origin);
    } catch {}
  }
  return [
    "const allowed = new Set(" + json([...origins]) + ");",
    "function publicHost(host) {",
    "  const name = host.toLowerCase().replace(/\\.$/, '');",
    "  if (!name.includes('.') || /(?:^|\\.)(?:localhost|local|internal|intranet|lan)$/.test(name)) return false;",
    "  if (/^(?:10|127|0|169\\.254|192\\.168|172\\.(?:1[6-9]|2\\d|3[01]))\\./.test(name)) return false;",
    "  if (/^(?:\\[|::|fc|fd|fe80)/i.test(name)) return false;",
    "  return true;",
    "}",
    "export async function requestPublic(uri, init, base, localFetch) {",
    "  const origin = new URL(base);",
    "  const target = new URL(uri, origin);",
    "  if (target.origin === origin.origin) return localFetch(target.href, init);",
    '  if (!allowed.has(target.origin) || !publicHost(target.hostname))',
    '    throw new Error("Server data origin is not allowed: " + target.origin);',
    "  // Refuse redirects so an external API cannot redirect SSR requests to an internal service.",
    '  return fetch(target.href, { ...init, redirect: "error", credentials: "omit",',
    "    signal: AbortSignal.timeout(15000) });",
    "}", "",
  ].join("\n");
}

function browserStarter(assetPaths: string[]): string {
  return [
    "export async function startPage(vars, update) {",
    "  window.__pageDataReady = Promise.resolve(vars);",
    "  window.__siteVarsOnChange = update;",
    "  for (const src of " + json(assetPaths) + ") {",
    "    await new Promise((resolve) => {",
    '      const script = document.createElement("script");',
    "      script.src = src;",
    "      script.onload = resolve;",
    "      script.onerror = resolve;",
    "      document.body.appendChild(script);",
    "    });",
    "  }",
    "}", "",
  ].join("\n");
}

function vueApp(pages: ReturnType<typeof generateNativeFiles>["pages"],
  framework: "vue" | "nuxt", lang: ExportLanguage, siteName: string): string {
  const isNuxt = framework === "nuxt";
  const rel = isNuxt ? "../generated/" : "./";
  const js = [
    '<script setup' + (lang === "typescript" ? ' lang="ts"' : "") + '>',
    'import { ref, computed, watch, onMounted, nextTick } from "vue";',
    'import { pages, selectPage } from "' + rel + 'site-routes.js";',
    'import { loadPageData } from "' + rel + 'site-data.js";',
    'import { startPage } from "' + rel + 'browser-start.js";',
    ...(isNuxt ? ['import { requestPublic } from "' + rel + 'server-request.js";'] : []),
    ...pages.map((page) => 'import ' + page.name + ' from "' + rel + 'pages/' + page.name + '.vue";'),
  ];
  if (isNuxt) {
    js.push(
      "const route = useRoute();",
      "const requestUrl = useRequestURL();",
      "const query = computed(() => new URLSearchParams(route.fullPath.split('?')[1] || ''));",
      "const selected = computed(() => selectPage(route.path, query.value));",
      'const { data: loaded } = await useAsyncData(() => "page-" + route.fullPath,',
      "  async () => {",
      "    const current = selected.value;",
      "    if (!current) return { vars: {} };",
      "    const vars = await loadPageData(current.plan, query.value,",
      "      (url, init) => requestPublic(url, init, requestUrl.origin,",
      "        (u, options) => fetch(u, options)));",
      "    return { vars };",
      "  }, { default: () => ({ vars: {} }) });",
      lang === "typescript"
        ? "const vars = ref<Record<string, unknown>>(loaded.value?.vars || {});"
        : "const vars = ref(loaded.value?.vars || {});",
      "watch(loaded, (next) => { vars.value = next?.vars || {}; });",
      "useHead(() => ({",
      "  title: selected.value ? selected.value.title + ' | ' + " + json(siteName) + " : " + json(siteName) + ",",
      "  meta: [{ name: 'description', content: selected.value?.description || '' }],",
      "}));",
    );
  } else {
    js.push(
      lang === "typescript" ? 'const selected = ref<(typeof pages)[number] | null>(null);'
        : 'const selected = ref(null);',
      lang === "typescript" ? 'const vars = ref<Record<string, unknown>>({});'
        : 'const vars = ref({});',
    );
  }
  js.push(
    "onMounted(async () => {",
    ...(!isNuxt ? [
      "  selected.value = selectPage(window.location.pathname, window.location.search);",
      "  if (selected.value) {",
      "    vars.value = await loadPageData(selected.value.plan, window.location.search);",
      "  }",
    ] : []),
    "  await nextTick();",
    "  await startPage(vars.value, (name" + (lang === "typescript" ? ": string" : "") + ", value" + (lang === "typescript" ? ": unknown" : "") + ") => {",
    "    vars.value = { ...vars.value, [name]: value };",
    "  });",
    "});",
    "</script>",
    "<template>",
    ...pages.map((page, i) => {
      const condition = (isNuxt ? "selected?.id" : "selected?.id") + " === " + json(page.id);
      return "  <" + page.name + ' v-' + (i ? "else-if" : "if") +
        '="' + condition.replace(/"/g, "&quot;") + '" :scope="vars" />';
    }),
    '  <main v-else><h1>Not Found</h1></main>',
    "</template>", "",
  );
  return js.join("\n");
}

function sveltePage(pages: ReturnType<typeof generateNativeFiles>["pages"], lang: ExportLanguage, siteName: string): string {
  return [
    '<script' + (lang === "typescript" ? ' lang="ts"' : "") + '>',
    'import { onMount } from "svelte";',
    'import { startPage } from "$lib/browser-start.js";',
    ...pages.map((page) => 'import ' + page.name + ' from "$lib/pages/' + page.name + '.svelte";'),
    lang === "typescript"
      ? 'let { data }: { data: { id: string; vars: Record<string, unknown>; title: string; description: string; language: string } } = $props();'
      : "let { data } = $props();",
    'let scope = $state(data.vars || {});',
    '$effect(() => { scope = data.vars || {}; });',
    'onMount(() => {',
    '  void startPage(scope, (name, value) => { scope = { ...scope, [name]: value }; });',
    '});',
    '</script>',
    '<svelte:head>',
    '  <title>{data.title} | ' + siteName.replace(/[<>&]/g, "") + '</title>',
    '  <meta name="description" content={data.description} />',
    '</svelte:head>',
    ...pages.map((page, i) => (i ? "{:else if " : "{#if ") + "data.id === " + json(page.id) + "}",
      // Note that Svelte's template syntax requires 'if' after ':else'.
    ).flatMap((condition, i) => [condition, "<" + pages[i].name + " {scope} />"]),
    '{:else}<h1>Not Found</h1>{/if}',
    "",
  ].join("\n");
}

export function applyNativeFramework(
  doc: SiteDoc, project: GeneratedProject, framework: Framework, language: ExportLanguage,
): GeneratedProject {
  const native = generateNativeFiles(doc, language);
  const files = { ...project.files };
  const root = framework === "vue" ? "src/" : framework === "nuxt" ? "app/generated/" : "src/lib/";
  const ext = framework === "sveltekit" ? ".svelte" : ".vue";
  for (const [name, source] of Object.entries(framework === "sveltekit" ? native.sveltePages : native.vuePages)) {
    files[root + "pages/" + name + ext] = source;
  }
  for (const [name, source] of Object.entries(framework === "sveltekit" ? native.svelteComponents : native.vueComponents)) {
    files[root + "components/" + name + ext] = source;
  }
  files[root + "site-routes.js"] = routesFile(native.pages);
  files[root + "site-data.js"] = nativeDataModule();
  const assetRoot = framework === "sveltekit" ? "static/" : "public/";
  delete files[assetRoot + "data-loader.js"];
  delete files[assetRoot + "scripts.js"];
  const scriptFiles = ["inview.js", "scripts.js", "pwa.js"].filter((file) =>
    file === "scripts.js" || Boolean(files[assetRoot + file])).map((file) => "/" + file);
  files[root + "browser-start.js"] = browserStarter(scriptFiles);
  // Use the already-generated event runtime, but seed it from framework state
  // rather than running a second browser-only data fetch.
  const previous = project.files[assetRoot + "scripts.js"];
  if (previous) files[assetRoot + "scripts.js"] = previous;
  // Old browser-start imports and serialized markup routing are no longer used.
  for (const path of [
    framework === "nuxt" ? "app/browser-start.js" : "src/browser-start.js",
    framework === "nuxt" ? "app/browser-start.ts" : "src/browser-start.ts",
    framework === "nuxt" ? "app/site-routes.js" : "src/site-routes.js",
    framework === "nuxt" ? "app/site-routes.ts" : "src/site-routes.ts",
  ]) {
    if (path !== root + "site-routes.js" && path !== root + "browser-start.js") delete files[path];
  }
  if (framework === "vue") {
    files["src/App.vue"] = vueApp(native.pages, "vue", language, doc.siteName);
    files["src/server-request.js"] = serverRequestSource(native.pages);
    withVueSsr(files, doc, language);
  } else if (framework === "nuxt") {
    files["app/app.vue"] = "<template><NuxtPage /></template>\n";
    files["app/generated/server-request.js"] = serverRequestSource(native.pages);
    files["app/pages/index.vue"] = vueApp(native.pages, "nuxt", language, doc.siteName);
    files["app/pages/[...slug].vue"] = files["app/pages/index.vue"];
    const ext = Object.hasOwn(files, "nuxt.config.ts") ? "ts" : "js";
    files["nuxt.config." + ext] = files["nuxt.config." + ext].replace("ssr: false", "ssr: true");
  } else {
    files["src/lib/server-request.js"] = serverRequestSource(native.pages);
    const pkg = JSON.parse(files["package.json"]) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>;
    };
    pkg.devDependencies["@sveltejs/adapter-node"] = "^5.5.4";
    delete pkg.devDependencies["@sveltejs/adapter-static"];
    files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
    files["svelte.config.js"] = files["svelte.config.js"]
      .replace('from "@sveltejs/adapter-static"', 'from "@sveltejs/adapter-node"')
      .replace('adapter({ fallback: "200.html" })', "adapter()")
      .replace('prerender: { entries: [] }', 'prerender: { entries: [] }');
    const script = [
      'import { error } from "@sveltejs/kit";',
      'import { selectPage } from "$lib/site-routes.js";',
      'import { loadPageData } from "$lib/site-data.js";',
      'import { requestPublic } from "$lib/server-request.js";',
      'export async function load({ url, fetch }) {',
      '  const selected = selectPage(url.pathname, url.searchParams);',
      '  if (!selected) error(404, "Page Not Found");',
      '  const vars = await loadPageData(selected.plan, url.searchParams,',
      '    (uri, init) => requestPublic(uri, init, url.origin, fetch));',
      '  return { id: selected.id, title: selected.title, description: selected.description,',
      '    language: selected.language, vars };',
      '}', "",
    ].join("\n");
    files["src/routes/+page.server.js"] = script;
    files["src/routes/[...path]/+page.server.js"] = script;
    files["src/routes/+page.svelte"] = sveltePage(native.pages, language, doc.siteName);
    files["src/routes/[...path]/+page.svelte"] = files["src/routes/+page.svelte"];
    files["src/routes/+layout." + (Object.hasOwn(files, "src/routes/+layout.ts") ? "ts" : "js")] =
      "export const ssr = true;\nexport const prerender = false;\n";
    files["src/routes/+layout.svelte"] = [
      '<script>',
      'import "../globals.css";',
      'import "../site.css";',
      'let { children } = $props();',
      '</script>',
      '{@render children()}', "",
    ].join("\n");
  }
  files["README.md"] = [
    "# Native framework export", "",
    "Every editable node is emitted as a native Vue or Svelte element.",
    "Pages and public JSON data render on the server (SSR) and hydrate on the client.",
    "Raw user HTML and inline SVGs are the only elements rendered as HTML fragments.",
    "Browser scripts retain editor-authored actions and update native reactive state.",
    "", "Run npm install and npm run dev. Run npm run build for production.",
    "Public APIs must allow server requests and may require CORS for client navigation.",
    "",
  ].join("\n");
  return { ...project, files };
}
