import { PAGE_DATA_RUNTIME } from "./browser-data";

/**
 * 実績のあるブラウザのデータの評価器を、環境に依存しない ESM のモジュールとして取り出す。
 * Vue と、Nuxt / SvelteKit の SSR での読み込みで、同じインタープリターが動く。
 * 生成するモジュールは、window・document・HTML の DOM に依存しない。
 */
export function nativeDataModule(): string {
  const start = PAGE_DATA_RUNTIME.indexOf("  // Shared pure page-data helpers");
  const end = PAGE_DATA_RUNTIME.indexOf("  window.__pageDataReady = ");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("The page data evaluator no longer exposes the expected functions");
  }
  let source = PAGE_DATA_RUNTIME.slice(start, end);
  const replace = (original: string, change: string) => {
    if (!source.includes(original)) throw new Error("Missing evaluator section: " + original);
    source = source.replace(original, change);
  };
  replace("  async function request(st, vars) {", "  async function request(st, vars, fetcher) {");
  replace("await fetch(url, init)", "await fetcher(url, init)");
  replace("  async function load(plan) {", "  async function load(plan, search, fetcher) {");
  replace("new URLSearchParams(location.search)", "new URLSearchParams(search)");
  replace("await request(st, vars)", "await request(st, vars, fetcher)");
  return source + [
    "",
    "export async function loadPageData(plan, search, fetcher = fetch) {",
    "  return load(plan, search, fetcher);",
    "}",
    "export function scopeOf(vars, ...items) {",
    "  return Object.assign(Object.create(null), vars || {}, ...items.filter((x) => x && typeof x === 'object'));",
    "}",
    "export function resolveText(value, vars, ...items) {",
    "  return interpolate(value, scopeOf(vars, ...items));",
    "}",
    "function safeLink(value) {",
    "  const url = String(value || \"\").trim();",
    "  const prefix = url.split(/[?#]/, 1)[0];",
    "  if (!url || /[\\u0000-\\u001f\\u007f\\\\]/.test(prefix) || url.startsWith(\"//\")) return \"#\";",
    "  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);",
    "  const scheme = match?.[1].toLowerCase();",
    "  if (scheme && ![\"http\", \"https\", \"mailto\", \"tel\"].includes(scheme)) return \"#\";",
    "  if ((scheme === \"http\" || scheme === \"https\") && !/^https?:\\/\\//i.test(url)) return \"#\";",
    "  return url;",
    "}",
    "export function resolveUrl(value, vars, ...items) {",
    "  return safeLink(interpolate(value, scopeOf(vars, ...items), true));",
    "}",
    "export function resolveResourceUrl(value, vars, ...items) {",
    "  const url = String(resolveText(value, vars, ...items) || '').trim();",
    "  if (/^data:(?:image|video|audio)\\/[a-z0-9.+-]+(?:;[a-z0-9-]+=[a-z0-9-]+)*;base64,[a-z0-9+/=]+(?:#[^\\u0000-\\u001f\\u007f]*)?$/i.test(url)) return url;",
    "  if (/^blob:/i.test(url)) return url;",
    "  return safeLink(url);",
    "}",
    "export function selectedOption(options, initial, vars, ...items) {",
    "  if (!options.length) return -1;",
    "  if (!initial) return 0;",
    "  const scope = scopeOf(vars, ...items);",
    "  const value = resolveText(initial, scope);",
    "  const index = options.findIndex(option => resolveText(option, scope) === value);",
    "  return index < 0 ? 0 : index;",
    "}",
    "export function setField(scope, name, event) {",
    "  if (!name || !scope || typeof scope !== 'object') return;",
    "  const element = event?.target;",
    "  if (!element) return;",
    "  const value = element.type === 'checkbox' ? String(element.checked) : element.value;",
    "  if (name === '__proto__') Object.defineProperty(scope, name, { value, configurable: true, enumerable: true, writable: true });",
    "  else scope[name] = value;",
    "}",
    "export function listItemsWithOps(listOps, vars, name, limit, ...items) {",
    "  const scope = scopeOf(vars, ...items);",
    "  const rows = displayListRows(read(scope, name), listOps, name, scope);",
    "  return Number(limit) > 0 ? rows.slice(0, limit) : rows;",
    "}",
    "export function listItems(vars, name, limit, ...items) {",
    "  return listItemsWithOps(undefined, vars, name, limit, ...items);",
    "}",
    "",
  ].join("\n");
}
