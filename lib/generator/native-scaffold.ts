import type { SiteDoc } from "../types";
import type { GeneratedProject, PublishTarget } from "../generator";
import type { ExportLanguage } from "../export-formats";
import { generateNativeFiles } from "./native-components";
import { nativeDataModule } from "./native-data";
import { withVueSsr } from "./vue-ssr";

type Framework = "vue" | "nuxt" | "sveltekit";
// SFC の <script> やテンプレートの式に入れるデータには、文字どおりのタグの区切りや、
// テンプレートの差し込みの目印が含まれていてはならない。
const json = (value: unknown) => JSON.stringify(value)
  .replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

function routesFile(pages: ReturnType<typeof generateNativeFiles>["pages"]): string {
  const plain = pages.map(({ id, name, title, description, noindex, slug, query, language, plan }) =>
    ({ id, name, title, description, noindex, path: "/" + slug.replace(/^\/+|\/+$/g, ""), query: Object.entries(query), language, plan }));
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
    '    if (typeof uri !== "string" || !uri.startsWith("/") || uri.startsWith("//") || target.pathname.startsWith("//"))',
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
    '        chunks.push(Buffer.from(value));',
    '      }',
    '    } finally { reader.releaseLock(); }',
    '    const empty = options.method === "HEAD" || [204, 205, 304].includes(response.status);',
    '    return new Response(empty ? null : Buffer.concat(chunks),',
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
    "  if (typeof transport !== \"function\") throw new Error(\"External SSR fetch requires Node 22+\");",
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
    "        dns.lookup(host, { all: true, family: 4 }, (error, addresses) => {",
    "          if (error || !addresses?.length ||",
    "              addresses.some((address) => !publicHost(address.address))) {",
    "            callback(error || new Error(\"Private DNS address blocked\"), \"\", 4);",
    "            return;",
    "          }",
    "          callback(null, addresses[0].address, 4);",
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
  framework: "vue" | "nuxt", lang: ExportLanguage, siteName: string, siteLanguage = "ja"): string {
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
      "const requestLocal = async (path, init) => {",
      "  const raw = await $fetch.raw(path, { method: init?.method, headers: init?.headers,",
      '    body: init?.body, retry: 0, responseType: "stream" });',
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
      "      (url, init) => requestPublic(url, init, requestUrl.origin,",
      "        requestLocal));",
      "    return { vars };",
      "  }, { default: () => ({ vars: {} }) });",
      lang === "typescript"
        ? "const vars = ref<Record<string, unknown>>(loaded.value?.vars || {});"
        : "const vars = ref(loaded.value?.vars || {});",
      "watch(loaded, (next) => { vars.value = next?.vars || {}; });",
      "useHead(() => ({",
      "  htmlAttrs: { lang: selected.value?.language || " + json(siteLanguage) + " },",
      "  title: selected.value ? selected.value.title + ' | ' + " + json(siteName) + " : " + json(siteName) + ",",
      "  meta: [{ name: 'description', content: selected.value?.description || '' },",
      "    ...(selected.value?.noindex ? [{ name: 'robots', content: 'noindex, nofollow' }] : [])],",
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
    "    vars.value[name] = value;",
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
      ? 'let { data }: { data: { id: string; vars: Record<string, unknown>; title: string; description: string; noindex: boolean; language: string } } = $props();'
      : "let { data } = $props();",
    'let scope = $state(data.vars || {});',
    '$effect(() => { scope = { ...(data.vars || {}) }; });',
    '$effect(() => { document.documentElement.lang = data.language; });',
    'onMount(() => {',
    '  void startPage(scope, (name, value) => { scope = { ...scope, [name]: value }; });',
    '});',
    '</script>',
    '<svelte:head>',
    '  <title>{data.title} | {' + json(siteName).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\{/g, "\\u007b").replace(/\}/g, "\\u007d") + '}</title>',
    '  <meta name="description" content={data.description} />',
    '  {#if data.noindex}<meta name="robots" content="noindex, nofollow" />{/if}',
    '</svelte:head>',
    ...pages.map((page, i) => (i ? "{:else if " : "{#if ") + "data.id === " + json(page.id) + "}",
      // Svelte のテンプレートの構文では、':else' の後に 'if' が必要になる点に注意。
    ).flatMap((condition, i) => [condition, "<" + pages[i].name + " {scope} />"]),
    '{:else}<h1>Not Found</h1>{/if}',
    "",
  ].join("\n");
}

export function applyNativeFramework(
  doc: SiteDoc, project: GeneratedProject, framework: Framework, language: ExportLanguage, target: PublishTarget,
): GeneratedProject {
  const native = generateNativeFiles(doc, language, target);
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
  const scriptFiles = ["inview.js", "scripts.js", "pwa.js"].filter((file) =>
    file === "scripts.js" || Boolean(files[assetRoot + file])).map((file) => "/" + file);
  files[root + "browser-start.js"] = browserStarter(scriptFiles);
  if (framework === "vue") {
    files["src/App.vue"] = vueApp(native.pages, "vue", language, doc.siteName);
    files["src/server-request.js"] = serverRequestSource(native.pages);
    withVueSsr(files, doc, language);
  } else if (framework === "nuxt") {
    files["app/app.vue"] = "<template><NuxtPage /></template>\n";
    files["app/generated/server-request.js"] = serverRequestSource(native.pages);
    files["app/pages/index.vue"] = vueApp(native.pages, "nuxt", language, doc.siteName, doc.lang || "ja");
    files["app/pages/[...slug].vue"] = files["app/pages/index.vue"];
  } else {
    files["src/lib/server-request.js"] = serverRequestSource(native.pages);
    files["src/hooks.server.js"] = [
      'import { selectPage } from "$lib/site-routes.js";',
      'export async function handle({ event, resolve }) {',
      '  const language = selectPage(event.url.pathname, event.url.searchParams)?.language || ' + json(doc.lang || "ja") + ';',
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
      '    (uri, init) => requestPublic(uri, init, url.origin, fetch));',
      '  return { id: selected.id, title: selected.title, description: selected.description,',
      '    noindex: selected.noindex, language: selected.language, vars };',
      '}', "",
    ].join("\n");
    files["src/routes/+page.server.js"] = script;
    files["src/routes/[...path]/+page.server.js"] = script;
    files["src/routes/+page.svelte"] = sveltePage(native.pages, language, doc.siteName);
    files["src/routes/[...path]/+page.svelte"] = files["src/routes/+page.svelte"];
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
