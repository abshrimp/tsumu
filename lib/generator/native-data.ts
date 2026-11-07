import { PAGE_DATA_RUNTIME } from "./browser-data";

/**
 * Extract the proven browser data evaluator into an environment-neutral ESM
 * module. The same interpreter runs in Vue and in Nuxt/SvelteKit SSR loads.
 * The generated module contains no window, document, or HTML DOM dependency.
 */
export function nativeDataModule(): string {
  const start = PAGE_DATA_RUNTIME.indexOf("  function read(vars, path) {");
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
    "  return Object.assign({}, vars || {}, ...items.filter((x) => x && typeof x === 'object'));",
    "}",
    "export function resolveText(value, vars, ...items) {",
    "  return interpolate(value, scopeOf(vars, ...items));",
    "}",
    "export function resolveUrl(value, vars, ...items) {",
    "  const url = resolveText(value, vars, ...items);",
    '  return /^(?:javascript:|vbscript:|data:text\\/html)/i.test(url.trim()) ? "#" : url;',
    "}",
    "export function setField(scope, name, event) {",
    "  if (!name || !scope || typeof scope !== 'object') return;",
    "  const element = event?.target;",
    "  if (!element) return;",
    "  scope[name] = element.type === 'checkbox' ? String(element.checked) : element.value;",
    "}",
    "export function listItems(vars, name, limit, ...items) {",
    "  const value = read(scopeOf(vars, ...items), name);",
    "  if (!Array.isArray(value)) return [];",
    "  const rows = value.filter((v) => v != null && !Array.isArray(v))",
    "    .map((v) => v && typeof v === 'object' ? v : { '値': v });",
    "  return Number(limit) > 0 ? rows.slice(0, limit) : rows;",
    "}",
    "",
  ].join("\n");
}
