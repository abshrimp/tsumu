import type { SiteDoc } from "../types";
import type { ExportLanguage } from "../export-formats";
import { generateNativeFiles } from "./native-components";

export function withVueSsr(
  files: Record<string, string>, doc: SiteDoc, language: ExportLanguage,
): void {
  const pages = generateNativeFiles(doc, language).pages;
  const ts = language === "typescript";
  const ext = ts ? "ts" : "js";
  const app = files["src/App.vue"];
  const before = ts ? 'const selected = ref<(typeof pages)[number] | null>(null);' :
    "const selected = ref(null);";
  const vars = ts ? 'const vars = ref<Record<string, unknown>>({});' : 'const vars = ref({});';
  if (!app.includes(before) || !app.includes(vars)) {
    throw new Error("Could not find Vue page state for SSR adaptation.");
  }
  files["src/App.vue"] = app
    .replace(before, [
      ts ? 'const props = defineProps<{ initialPageId: string; initialVars: Record<string, unknown> }>();'
        : 'const props = defineProps({ initialPageId: String, initialVars: Object });',
      ts ? 'const selected = ref<(typeof pages)[number] | null>(pages.find((page) => page.id === props.initialPageId) || null);'
        : 'const selected = ref(pages.find((page) => page.id === props.initialPageId) || null);',
    ].join("\n"))
    .replace(vars, 'const vars = ref(props.initialVars || {});')
    .replace('  selected.value = selectPage(window.location.pathname, window.location.search);\n  if (selected.value) {\n    vars.value = await loadPageData(selected.value.plan, window.location.search);\n  }',
      '  if (!selected.value) {\n    selected.value = selectPage(window.location.pathname, window.location.search);\n    if (selected.value) vars.value = await loadPageData(selected.value.plan, window.location.search);\n  }');
  files["src/entry-client." + ext] = [
    'import { createSSRApp } from "vue";',
    'import App from "./App.vue";',
    'import "./globals.css";',
    'import "./site.css";',
    'const payload = document.querySelector("#site-payload");',
    'const data = payload ? JSON.parse(payload.textContent || "{}") : {};',
    'createSSRApp(App, { initialPageId: data.id || "", initialVars: data.vars || {} }).mount("#app");',
    "",
  ].join("\n");
  files["src/entry-server." + ext] = [
    'import { createSSRApp } from "vue";',
    'import { renderToString } from "vue/server-renderer";',
    'import App from "./App.vue";',
    'import { selectPage } from "./site-routes.js";',
    'import { loadPageData } from "./site-data.js";',
    'import { requestPublic } from "./server-request.js";',
    'export async function render(urlString' + (ts ? ': string' : '') + ') {',
    '  const url = new URL(urlString);',
    '  const selected = selectPage(url.pathname, url.searchParams);',
    '  if (!selected) {',
    '    const app = createSSRApp(App, { initialPageId: "", initialVars: {} });',
    '    const html = await renderToString(app);',
    '    return { status: 404, html, id: "", vars: {},',
    '      title: "Not Found", description: "", language: ' + JSON.stringify(doc.lang || "ja") + ' };',
    '  }',
    '  const vars = await loadPageData(selected.plan, url.searchParams,',
    '    (uri, init) => requestPublic(uri, init, url.origin,',
    '      (path' + (ts ? ': string' : '') + ', options' + (ts ? ': RequestInit' : '') + ') =>',
    '        fetch(new URL(path, url.origin).href, options)));',
    '  const app = createSSRApp(App, { initialPageId: selected.id, initialVars: vars });',
    '  const html = await renderToString(app);',
    '  return { status: 200, html, id: selected.id, vars,',
    '    title: selected.title + " | " + ' + JSON.stringify(doc.siteName) + ', description: selected.description, language: selected.language };',
    '}',
    "",
  ].join("\n");
  // The Vite SSR process uses Node's HTTP server; dev serves module transforms,
  // production imports a compiled SSR entry and serves the built client assets.
  files["server.mjs"] = [
    'import { createServer } from "node:http";',
    'import { readFile, stat } from "node:fs/promises";',
    'import { resolve, sep, extname } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'const root = fileURLToPath(new URL(".", import.meta.url));',
    'const production = process.env.NODE_ENV === "production";',
    'const dist = resolve(root, "dist/client");',
    'const templateFile = resolve(production ? dist : root, "index.html");',
    'const vite = production ? null : await (await import("vite")).createServer({',
    '  server: { middlewareMode: true }, appType: "custom", root,',
    '});',
    'const render = production ? (await import("./dist/server/entry-server.js")).render : null;',
    'const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",',
    '  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",',
    '  ".ico": "image/x-icon", ".json": "application/json" };',
    'async function handle(req, res) {',
    '  const origin = new URL("http://127.0.0.1:" + Number(process.env.PORT || 3000));',
    '  let url;',
    '  try {',
    '    const path = req.url || "/";',
    '    if (!path.startsWith("/") || path.startsWith("//")) throw new Error();',
    '    url = new URL(path, origin);',
    '    if (url.origin !== origin.origin) throw new Error();',
    '  } catch {',
    '    res.writeHead(400); res.end("Invalid request target"); return;',
    '  }',
    '  if (production && url.pathname !== "/") {',
    '    let file;',
    '    try { file = resolve(dist, "." + decodeURIComponent(url.pathname)); } catch {}',
    '    if (file && file.startsWith(dist + sep)) {',
    '      try {',
    '        if ((await stat(file)).isFile()) {',
    '          const bytes = await readFile(file);',
    '          res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });',
    '          res.end(bytes); return;',
    '        }',
    '      } catch {}',
    '    }',
    '  }',
    '  const siteUrl = url.href;',
    '  try {',
    '    const template = await readFile(templateFile, "utf8");',
    '    const result = await (vite ? (await vite.ssrLoadModule("/src/entry-server.' + ext + '")).render(siteUrl)',
    '      : render(siteUrl));',
    '    const sitePayload = JSON.stringify({ id: result.id, vars: result.vars })',
    '      .replace(/</g, "\\\\u003c");',
    '    const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\x27/g, "&#39;");',
    '    const slots = {',
    '      "app-html": result.html,',
    '      "app-data": \'<script id="site-payload" type="application/json">\' + sitePayload + "</script>",',
    '      "page-title": escapeHtml(result.title),',
    '      "page-description": escapeHtml(result.description),',
    '      "page-language": escapeHtml(result.language || ' + JSON.stringify(doc.lang || "ja") + '),',
    '    };',
    '    let html = template.replace(/<!--(app-html|app-data|page-title|page-description|page-language)-->/g, (_, key) => slots[key]);',
    '    if (vite) html = await vite.transformIndexHtml(url.pathname, html);',
    '    res.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });',
    '    res.end(html);',
    '  } catch (error) {',
    '    vite?.ssrFixStacktrace(error); console.error(error);',
    '    res.writeHead(500, { "Content-Type": "text/plain" }); res.end("SSR error");',
    '  }',
    '}',
    'const server = createServer((req, res) => {',
    '  if (vite) vite.middlewares(req, res, () => { void handle(req, res); });',
    '  else void handle(req, res);',
    '});',
    'server.listen(Number(process.env.PORT || 3000), process.env.HOST || "127.0.0.1");',
    "",
  ].join("\n");
  files["src/server-request.js"] = files["src/server-request.js"] || "";
  files["index.html"] = [
    "<!doctype html>",
    '<html lang="<!--page-language-->">',
    "<head>",
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="description" content="<!--page-description-->">',
    "<title><!--page-title--></title>",
    "</head><body>",
    '<div id="app"><!--app-html--></div>',
    '<!--app-data-->',
    '<script type="module" src="/src/entry-client.' + ext + '"></script>',
    "</body></html>", "",
  ].join("\n");
  for (const ext of ["js", "ts"]) delete files["src/main." + ext];
  const pkg = JSON.parse(files["package.json"]) as {
    scripts: Record<string, string>; dependencies: Record<string, string>;
  };
  pkg.scripts = {
    dev: "node server.mjs",
    build: (ts ? "vue-tsc --noEmit && " : "") +
      "vite build --outDir dist/client && vite build --ssr src/entry-server." + ext + " --outDir dist/server",
    start: "NODE_ENV=production node server.mjs",
    preview: "NODE_ENV=production node server.mjs",
  };
  pkg.dependencies["@vue/server-renderer"] = "^3.5.25";
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  files[".gitignore"] += "dist/\n";
}
