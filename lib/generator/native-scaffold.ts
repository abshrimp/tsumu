import type { SiteDoc } from "../types";
import type { GeneratedProject, PublishTarget } from "../generator";
import type { ExportLanguage } from "./export-options";
import { scriptsFile } from "../script-runtime";
import { generateNativeFiles, type NotFoundMetadata } from "./native-components";
import { nativeDataModule } from "./native-data";
import { withVueSsr } from "./vue-ssr";
import { SVELTEKIT_FORM_TARGETS } from "./search-form";

type Framework = "vue" | "nuxt" | "sveltekit";
// SFC の <script> やテンプレートの式に入れるデータには、文字どおりのタグの区切りや、
// テンプレートの差し込みの目印が含まれていてはならない。
const json = (value: unknown) => JSON.stringify(value)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

function routesFile(pages: ReturnType<typeof generateNativeFiles>["pages"]): string {
  const plain = pages.map(({ id, name, title, description, noindex, ogImage, slug, query, language, plan }) =>
    ({ id, name, title, description, noindex, ogImage, path: "/" + slug.replace(/^\/+|\/+$/g, ""), query: Object.entries(query), language, plan }));
  return [
    // __proto__ も条件の名前として保ち、オブジェクトの初期化子の特別な構文にしない。
    "export const pages = " + json(plain) + ".map(page => ({ ...page, query: Object.fromEntries(page.query) }));",
    "export function selectPage(pathname, query) {",
    "  let path;",
    '  try { path = decodeURI(String(pathname || "/")); }',
    '  catch { path = String(pathname || "/"); }',
    '  path = path.replace(/\\/+$/, "") || "/";',
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
    "const pageRoutes = new Set(" + json(pages.map((page) => "/" + page.slug.replace(/^\/+|\/+$/g, ""))) + ");",
    "function publicHost(host) {",
    "  const name = String(host).toLowerCase().replace(/\\.$/, '');",
    "  if (!name.includes('.') || name.includes('..') ||",
    "      /(?:^|\\.)(?:localhost|local|internal|intranet|lan|localdomain|home\\.arpa)$/.test(name)) return false;",
    "  // Generated SSR disallows literal IPv6 hosts and IPv4 special networks.",
    "  if (name.startsWith('[') || name.includes(':')) return false;",
    "  const ip = /^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/.exec(name);",
    "  if (ip) {",
    "    const [a, b, c, d] = ip.slice(1).map(Number);",
    "    if ([a, b, c, d].some((part) => part > 255)) return false;",
    "    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||",
    "      (a === 100 && b >= 64 && b <= 127) ||",
    "      (a === 169 && b === 254) ||",
    "      (a === 172 && b >= 16 && b <= 31) ||",
    "      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||",
    "      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) ||",
    "      (a === 198 && (b === 18 || b === 19)));",
    "  }",
    "  return /^[a-z0-9.-]+$/.test(name);",
    "}",
    "export async function requestPublic(uri, init, base, localFetch) {",
    "  const origin = new URL(base);",
    "  const target = new URL(uri, origin);",
    '  if (target.username || target.password) throw new Error("Credentials in server URL are forbidden");',
    '  const headers = new Headers(init?.headers);',
    '  for (const key of headers.keys()) {',
    '    if (/^(?:host|authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-client-secret|x-metadata-token|metadata-flavor)$/i.test(key))',
    '      throw new Error("Sensitive headers cannot be sent by generated pages");',
    '  }',
    '  const options = { ...init, headers, redirect: "error", credentials: "omit" };',
    '  if (target.origin === origin.origin) {',
    '    // Use only a relative path for internal requests; never trust a supplied Host.',
    '    if (typeof uri !== "string" || (!uri.startsWith("/") && !uri.startsWith("./") && !uri.startsWith("../")) ||',
    '        uri.startsWith("//") || uri.includes("\\\\") || target.pathname.startsWith("//"))',
    '      throw new Error("Absolute same-origin server fetches are not supported");',
    "    let pagePath;",
    '    try { pagePath = decodeURI(target.pathname); }',
    '    catch { throw new Error("Malformed internal request path"); }',
    '    pagePath = pagePath.replace(/\\/+$/, "") || "/";',
    '    if (pageRoutes.has(pagePath)) throw new Error("Recursive generated page fetch is forbidden");',
    '    const response = await localFetch(target.pathname + target.search, options);',
    '    const limit = 5 * 1024 * 1024;',
    '    if (Number(response.headers?.get("content-length") || 0) > limit) {',
    '      await response.body?.cancel().catch(() => {});',
    '      throw new Error("SSR response exceeds 5 MB");',
    '    }',
    '    if (!response.body) return response;',
    '    const reader = response.body.getReader();',
    '    const chunks = []; let bytes = 0;',
    '    try {',
    '      for (;;) {',
    '        const { done, value } = await reader.read();',
    '        if (done) break;',
    '        bytes += value.byteLength;',
    '        if (bytes > limit) {',
    '          await reader.cancel().catch(() => {});',
    '          throw new Error("SSR response exceeds 5 MB");',
    '        }',
    '        chunks.push(value);',
    '      }',
    '    } finally { reader.releaseLock(); }',
    '    const empty = options.method === "HEAD" || [204, 205, 304].includes(response.status);',
    '    return new Response(empty ? null : new Blob(chunks),',
    '      { status: response.status, headers: response.headers });',
    '  }',
    '  if (!allowed.has(target.origin) || !publicHost(target.hostname))',
    '    throw new Error("Server data origin is not allowed: " + target.origin);',
    "  // Pin the validated DNS answer to the actual Node socket lookup.",
    "  // An up-front DNS test followed by a separate fetch is vulnerable to rebinding.",
    "  // On Nuxt client navigation, requests execute in the browser (with CORS),",
    "  // not through the Node-only SSR transport. Keep the origin allowlist above.",
    "  if (typeof window !== 'undefined') return fetch(target.href, options);",
    "  const transport = globalThis.process?.getBuiltinModule;",
    "  if (typeof transport !== \"function\") throw new Error(\"External SSR fetch requires Node 26+\");",
    "  const http = transport(target.protocol === \"https:\" ? \"node:https\" : \"node:http\");",
    "  const dns = transport(\"node:dns\");",
    "  if (!http?.request || !dns?.lookup) throw new Error(\"Safe SSR transport unavailable\");",
    "  const requestHeaders = new Headers(options.headers);",
    "  requestHeaders.set(\"accept-encoding\", \"identity\");",
    "  const signal = AbortSignal.timeout(15000);",
    "  return new Promise((resolve, reject) => {",
    "    const request = http.request(target, {",
    "      method: options.method || \"GET\",",
    "      headers: Object.fromEntries(requestHeaders),",
    "      agent: false, signal,",
    "      lookup(host, flags, callback) {",
    "        const wantAll = Boolean(flags && typeof flags === \"object\" && flags.all);",
    "        dns.lookup(host, { all: true, family: 4 }, (error, addresses) => {",
    "          if (error || !addresses?.length ||",
    "              addresses.some((address) => !publicHost(address.address))) {",
    "            const reason = error || new Error(\"Private DNS address blocked\");",
    "            if (wantAll) callback(reason, []);",
    "            else callback(reason, \"\", 4);",
    "            return;",
    "          }",
    "          if (wantAll) callback(null, addresses.map((a) => ({ address: a.address, family: 4 })));",
    "          else callback(null, addresses[0].address, 4);",
    "        });",
    "      },",
    "    }, async (res) => {",
    "      const status = res.statusCode || 502;",
    "      if (status >= 300 && status < 400) {",
    "        res.destroy(); reject(new Error(\"Public SSR redirects are disabled\")); return;",
    "      }",
    "      const encoding = String(res.headers[\"content-encoding\"] || \"identity\").toLowerCase();",
    "      if (encoding !== \"identity\") {",
    "        res.destroy(); reject(new Error(\"Unexpected compressed SSR response\")); return;",
    "      }",
    "      try {",
    "        const chunks = []; let bytes = 0;",
    "        for await (const chunk of res) {",
    "          bytes += chunk.byteLength;",
    "          if (bytes > 5 * 1024 * 1024) throw new Error(\"SSR response exceeds 5 MB\");",
    "          chunks.push(chunk);",
    "        }",
    "        const responseHeaders = new Headers();",
    "        for (const [key, value] of Object.entries(res.headers)) {",
    "          if (value !== undefined && ![\"set-cookie\", \"content-length\", \"content-encoding\"].includes(key))",
    "            responseHeaders.set(key, Array.isArray(value) ? value.join(\", \") : value);",
    "        }",
    "        const empty = options.method === \"HEAD\" || [204, 205, 304].includes(status);",
    "        resolve(new Response(empty ? null : Buffer.concat(chunks),",
    "          { status, headers: responseHeaders }));",
    "      } catch (error) {",
    "        res.destroy(); reject(error);",
    "      }",
    "    });",
    "    request.on(\"error\", reject);",
    "    request.end(options.body ?? undefined);",
    "  });",
    "}", "",
  ].join("\n");
}

function browserStarter(assetPaths: string[]): string {
  return [
    "let loading;",
    "export function syncPageVars(vars, update) {",
    "  window.__pageVars = vars;",
    "  window.__pageDataReady = Promise.resolve(vars);",
    "  if (update) window.__siteVarsOnChange = update;",
    '  if (typeof window.__siteSetPageVars === "function") window.__siteSetPageVars(vars);',
    "}",
    "export async function startPage(vars, update) {",
    "  syncPageVars(vars, update);",
    "  loading ??= (async () => {",
    "    for (const src of " + json(assetPaths) + ") {",
    "      if (document.querySelector('script[src=' + JSON.stringify(src) + ']')) continue;",
    "      await new Promise((resolve) => {",
    '        const script = document.createElement("script");',
    "        script.src = src;",
    "        script.onload = resolve;",
    "        script.onerror = resolve;",
    "        document.body.appendChild(script);",
    "      });",
    "    }",
    "  })();",
    "  await loading;",
    "}", "",
  ].join("\n");
}

function vueApp(
  pages: ReturnType<typeof generateNativeFiles>["pages"],
  framework: "vue" | "nuxt",
  lang: ExportLanguage,
  siteName: string,
  missing: NotFoundMetadata,
  hasNotFound = false,
): string {
  const isNuxt = framework === "nuxt";
  const rel = isNuxt ? "../generated/" : "./";
  const typed = lang === "typescript";
  const js = [
    '<script setup' + (typed ? ' lang="ts"' : "") + '>',
    'import { ref, computed, watch, onMounted, nextTick } from "vue";',
    'import { pages, selectPage } from "' + rel + 'site-routes.js";',
    'import { loadPageData } from "' + rel + 'site-data.js";',
    'import { startPage, syncPageVars } from "' + rel + 'browser-start.js";',
    ...(isNuxt ? ['import { requestPublic } from "' + rel + 'server-request.js";'] : []),
    ...pages.map((page) => 'import ' + page.name + ' from "' + rel + 'pages/' + page.name + '.vue";'),
    ...(hasNotFound ? ['import NotFound from "' + rel + 'pages/NotFound.vue";'] : []),
  ];
  if (isNuxt) {
    js.push(
      "const route = useRoute();",
      "const requestUrl = useRequestURL();",
      "const requestLocal = async (path, init) => {",
      '  const raw = await $fetch.raw(path, { ...init, retry: 0, responseType: "stream" });',
      '  const empty = init?.method === "HEAD" || [204, 205, 304].includes(raw.status);',
      "  return new Response(empty ? null : (raw._data ?? raw.body),",
      "    { status: raw.status, headers: raw.headers });",
      "};",
      "const query = computed(() => new URL(route.fullPath, requestUrl.origin).searchParams);",
      "const selected = computed(() => selectPage(route.path, query.value));",
      "const responseEvent = useRequestEvent();",
      "if (!selected.value && responseEvent) setResponseStatus(responseEvent, 404);",
      'const { data: loaded } = await useAsyncData(() => "page-" + route.fullPath,',
      "  async () => {",
      "    const current = selected.value;",
      "    if (!current) return { vars: {} };",
      "    const vars = await loadPageData(current.plan, query.value,",
      "      (url, init) => requestPublic(url, init, requestUrl.href,",
      "        requestLocal));",
      "    return { vars };",
      "  }, { default: () => ({ vars: {} }) });",
      typed
        ? "const vars = ref<Record<string, unknown>>(loaded.value?.vars || {});"
        : "const vars = ref(loaded.value?.vars || {});",
      "const updateVars = (name" + (typed ? ": string" : "") + ", value" + (typed ? ": unknown" : "") + ") => { vars.value[name] = value; };",
      'watch(loaded, (next) => { vars.value = next?.vars || {}; if (typeof window !== "undefined") syncPageVars(vars.value, updateVars); });',
      "useHead(() => ({",
      "  htmlAttrs: { lang: selected.value?.language || " + json(missing.language) + " },",
      "  title: selected.value ? selected.value.title + ' | ' + " + json(siteName) + " : " + json(missing.title) + ",",
      "  meta: [{ name: 'description', content: selected.value?.description ?? " + json(missing.description) + " },",
      "    ...(selected.value?.ogImage ? [{ property: 'og:image', content: selected.value.ogImage }, { name: 'twitter:card', content: 'summary_large_image' }] : !selected.value ? " +
        json(missing.ogImage ? [{ property: 'og:image', content: missing.ogImage }, { name: 'twitter:card', content: 'summary_large_image' }] : []) + " : []),",
      "    ...((selected.value?.noindex ?? " + missing.noindex + ") ? [{ name: 'robots', content: 'noindex, nofollow' }] : [])],",
      "}));",
    );
  } else {
    js.push(
      typed ? 'const selected = ref<(typeof pages)[number] | null>(null);'
        : 'const selected = ref(null);',
      typed ? 'const vars = ref<Record<string, unknown>>({});'
        : 'const vars = ref({});',
      "const updateVars = (name" + (typed ? ": string" : "") + ", value" + (typed ? ": unknown" : "") + ") => { vars.value[name] = value; };",
    );
  }
  const fallbackAttr = pages.length ? " v-else" : "";
  const fallbackLine = hasNotFound
    ? "  <NotFound" + fallbackAttr + ' :scope="vars" />'
    : "  <main" + fallbackAttr + "><h1>Not Found</h1></main>";
  js.push(
    "onMounted(async () => {",
    ...(!isNuxt ? [
      "  selected.value = selectPage(window.location.pathname, window.location.search);",
      "  if (selected.value) {",
      "    vars.value = await loadPageData(selected.value.plan, window.location.search);",
      "  }",
    ] : []),
    "  await nextTick();",
    "  await startPage(vars.value, updateVars);",
    "});",
    "</script>",
    "<template>",
    ...pages.map((page, i) => {
      const condition = "selected?.id === " + json(page.id);
      return "  <" + page.name + ' v-' + (i ? "else-if" : "if") +
        '="' + condition.replace(/"/g, "&quot;") + '" :scope="vars" />';
    }),
    fallbackLine,
    "</template>", "",
  );
  return js.join("\n");
}

function sveltePage(
  pages: ReturnType<typeof generateNativeFiles>["pages"],
  lang: ExportLanguage,
  siteName: string,
  hasNotFound = false,
): string {
  const typed = lang === "typescript";
  const fallbackBody = hasNotFound ? "<NotFound {scope} />" : "<h1>Not Found</h1>";
  return [
    '<script' + (typed ? ' lang="ts"' : "") + '>',
    'import { onMount } from "svelte";',
    'import { startPage, syncPageVars } from "$lib/browser-start.js";',
    ...pages.map((page) => 'import ' + page.name + ' from "$lib/pages/' + page.name + '.svelte";'),
    ...(hasNotFound ? ['import NotFound from "$lib/pages/NotFound.svelte";'] : []),
    typed
      ? 'let { data }: { data: { id: string; vars: Record<string, unknown>; title: string; description: string; noindex: boolean; language: string; ogImage: string | null } } = $props();'
      : "let { data } = $props();",
    'let scope = $state(data.vars || {});',
    'const updateScope = (name' + (typed ? ': string' : '') + ', value' + (typed ? ': unknown' : '') + ') => { scope = { ...scope, [name]: value }; };',
    '$effect.pre(() => { const next = { ...(data.vars || {}) }; scope = next; if (typeof window !== "undefined") syncPageVars(next, updateScope); });',
    '$effect(() => { document.documentElement.lang = data.language; });',
    'onMount(() => {',
    '  void startPage(scope, updateScope);',
    '});',
    '</script>',
    '<svelte:head>',
    '  <title>{data.title} | {' + json(siteName).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\{/g, "\\u007b").replace(/\}/g, "\\u007d") + '}</title>',
    '  <meta name="description" content={data.description} />',
    '  {#if data.ogImage}<meta property="og:image" content={data.ogImage} /><meta name="twitter:card" content="summary_large_image" />{/if}',
    '  {#if data.noindex}<meta name="robots" content="noindex, nofollow" />{/if}',
    '</svelte:head>',
    ...(pages.length
      ? [
          ...pages.map((page, i) => (i ? "{:else if " : "{#if ") + "data.id === " + json(page.id) + "}",
            // Svelte のテンプレートの構文では、':else' の後に 'if' が必要になる点に注意。
          ).flatMap((condition, i) => [condition, "<" + pages[i].name + " {scope} />"]),
          "{:else}" + fallbackBody + "{/if}",
        ]
      : [fallbackBody]),
    "",
  ].join("\n");
}

export function applyNativeFramework(
  doc: SiteDoc, project: GeneratedProject, framework: Framework, language: ExportLanguage, target: PublishTarget,
  classes?: Map<string, string>,
): GeneratedProject {
  const mode = framework === "sveltekit" ? "sveltekit" : "vue";
  const native = generateNativeFiles(doc, language, target, mode, classes);
  const files = { ...project.files };
  const root = framework === "vue" ? "src/" : framework === "nuxt" ? "app/generated/" : "src/lib/";
  const ext = framework === "sveltekit" ? ".svelte" : ".vue";
  for (const [name, source] of Object.entries(native.pageFiles)) {
    files[root + "pages/" + name + ext] = source;
  }
  if (native.notFound) {
    files[root + "pages/NotFound" + ext] = native.notFound;
  }
  for (const [name, source] of Object.entries(native.componentFiles)) {
    files[root + "components/" + name + ext] = source;
  }
  files[root + "site-routes.js"] = routesFile(native.pages);
  files[root + "site-data.js"] = nativeDataModule();
  const assetRoot = framework === "sveltekit" ? "static/" : "public/";
  delete files[assetRoot + "data-loader.js"];
  files[assetRoot + "scripts.js"] = scriptsFile(native.doc, true);
  const scriptFiles = ["inview.js", "scripts.js", "pwa.js"].filter((file) =>
    file === "scripts.js" || Boolean(files[assetRoot + file])).map((file) => "/" + file);
  files[root + "browser-start.js"] = browserStarter(scriptFiles);
  const hasNotFound = Boolean(native.notFound);
  if (framework === "vue") {
    files["src/App.vue"] = vueApp(native.pages, "vue", language, doc.siteName, native.notFoundMetadata, hasNotFound);
    files["src/server-request.js"] = serverRequestSource(native.pages);
    withVueSsr(files, doc, language, native.notFoundMetadata);
  } else if (framework === "nuxt") {
    files["app/app.vue"] = "<template><NuxtPage /></template>\n";
    files["app/generated/server-request.js"] = serverRequestSource(native.pages);
    files["app/pages/index.vue"] = vueApp(native.pages, "nuxt", language, doc.siteName, native.notFoundMetadata, hasNotFound);
    files["app/pages/[...slug].vue"] = files["app/pages/index.vue"];
  } else {
    files["src/lib/server-request.js"] = serverRequestSource(native.pages);
    files["src/hooks.client.js"] = SVELTEKIT_FORM_TARGETS;
    files["src/hooks.server.js"] = [
      'import { selectPage } from "$lib/site-routes.js";',
      'export async function handle({ event, resolve }) {',
      '  const language = selectPage(event.url.pathname, event.url.searchParams)?.language || ' + json(native.notFoundMetadata.language) + ';',
      `  const escaped = language.replace(/[&"<>]/g, char => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);`,
      '  return resolve(event, { transformPageChunk: ({ html }) => html.replace("%page.language%", () => escaped) });',
      '}', '',
    ].join("\n");
    const script = [
      'import { error } from "@sveltejs/kit";',
      'import { selectPage } from "$lib/site-routes.js";',
      'import { loadPageData } from "$lib/site-data.js";',
      'import { requestPublic } from "$lib/server-request.js";',
      'export async function load({ url, fetch }) {',
      '  const selected = selectPage(url.pathname, url.searchParams);',
      '  if (!selected) error(404, "Page Not Found");',
      '  const vars = await loadPageData(selected.plan, url.searchParams,',
      '    (uri, init) => requestPublic(uri, init, url.href, fetch));',
      '  return { id: selected.id, title: selected.title, description: selected.description,',
      '    noindex: selected.noindex, language: selected.language, ogImage: selected.ogImage, vars };',
      '}', "",
    ].join("\n");
    files["src/routes/+page.server.js"] = script;
    files["src/routes/[...path]/+page.server.js"] = script;
    files["src/routes/+page.svelte"] = sveltePage(native.pages, language, doc.siteName, hasNotFound);
    files["src/routes/[...path]/+page.svelte"] = files["src/routes/+page.svelte"];
    if (hasNotFound || native.notFoundMetadata.ogImage) {
      files["src/routes/+error.svelte"] = [
        '<script' + (language === "typescript" ? ' lang="ts"' : "") + '>',
        'import { page } from "$app/state";',
        ...(hasNotFound ? ['import NotFound from "$lib/pages/NotFound.svelte";'] : []),
        'const missing = ' + json(native.notFoundMetadata) + ';',
        '$effect(() => { if (page.status === 404) document.documentElement.lang = missing.language; });',
        '</script>',
        '<svelte:head>{#if page.status === 404}',
        '  <title>{missing.title}</title><meta name="description" content={missing.description} />',
        ...(native.notFoundMetadata.ogImage ? ['  <meta property="og:image" content={missing.ogImage} /><meta name="twitter:card" content="summary_large_image" />'] : []),
        ...(native.notFoundMetadata.noindex ? ['  <meta name="robots" content="noindex, nofollow" />'] : []),
        '{/if}</svelte:head>',
        hasNotFound ? '{#if page.status === 404}<NotFound scope={{}} />{:else}<h1>{page.status}</h1>{/if}'
          : '<h1>{page.status}</h1><p>{page.error?.message}</p>',
        "",
      ].join("\n");
    }
    files["src/routes/+layout.svelte"] = [
      '<script>',
      'import "../globals.css";',
      'import "../site.css";',
      'let { children } = $props();',
      '</script>',
      '{@render children()}', "",
    ].join("\n");
  }
  if (framework === "sveltekit") {
    // Kit 3 では、廃止された $lib の別名の代わりに、パッケージの import map を使う。
    for (const [path, source] of Object.entries(files)) {
      if (/\.(?:js|ts|svelte)$/.test(path) && source.includes("$lib/")) {
        files[path] = source.replaceAll("$lib/", "#lib/");
      }
    }
  }
  files["README.md"] = [
    "# Native framework export", "",
    "Every editable node is emitted as a native Vue or Svelte element.",
    "Pages and public JSON data render on the server (SSR) and hydrate on the client.",
    "Raw user HTML and inline SVGs are the only elements rendered as HTML fragments.",
    "Browser scripts retain editor-authored actions and update native reactive state.",
    "", "Run npm install and npm run dev. Run npm run build for production.",
    "Public APIs must allow server requests and may require CORS for client navigation.",
    "External SSR API requests use pinned public IPv4 DNS answers and require Node.js 22+; non-Node/edge runtimes will fail closed.",
    "",
  ].join("\n");
  return { ...project, files };
}
