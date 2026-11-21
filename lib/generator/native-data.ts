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
    "  if (/^https?:/i.test(url) && !/^https?:\\/\\/[^/?#@\\\\]+(?:[/?#]|$)/i.test(url)) return '#';",
    "  return safeLink(url);",
    "}",
    "export function selectedOption(options, initial, vars, ...items) {",
    "  if (!options.length) return -1;",
    "  if (initial == null) return 0;",
    "  const scope = scopeOf(vars, ...items);",
    "  const value = resolveText(initial, scope);",
    "  const index = options.findIndex(option => resolveText(option, scope) === value);",
    "  return index < 0 ? 0 : index;",
    "}",
    "const fieldOwners = new WeakMap();",
    "const formEdits = new WeakMap();",
    "export function formScope(base, defaults) {",
    "  const scope = Object.assign(Object.create(null), base);",
    "  fieldOwners.set(scope, base);",
    "  const resolving = new Set();",
    "  for (const [name, initial, options] of defaults) {",
    "    if (Object.hasOwn(scope, name)) continue;",
    "    Object.defineProperty(scope, name, { enumerable: true, get() {",
    "      if (resolving.has(name)) return '';",
    "      resolving.add(name);",
    "      try {",
    "        const value = interpolate(initial ?? '', scope);",
    "        if (!options) return value;",
    "        const values = options.map(option => interpolate(option, scope));",
    "        return initial != null && values.includes(value) ? value : (values[0] ?? '');",
    "      } finally { resolving.delete(name); }",
    "    } });",
    "  }",
    "  return scope;",
    "}",
    "export function textareaText(value) {",
    "  const normalized = String(value ?? '').replace(/\\r\\n?/g, '\\n');",
    "  return typeof document === 'undefined' && normalized.startsWith('\\n') ? '\\n' + normalized : normalized;",
    "}",
    "export function setField(scope, name, event) {",
    "  if (!name || !scope || typeof scope !== 'object') return;",
    "  scope = fieldOwners.get(scope) || scope;",
    "  const element = event?.target;",
    "  if (!element) return;",
    "  if (element.form) {",
    "    let edits = formEdits.get(element.form);",
    "    if (!edits) formEdits.set(element.form, edits = []);",
    "    if (!edits.some(edit => edit.scope === scope && edit.name === name))",
    "      edits.push({ scope, name, had: Object.hasOwn(scope, name), previous: scope[name] });",
    "  }",
    "  const value = element.type === 'checkbox' ? String(element.checked) : element.value;",
    "  if (name === '__proto__') Object.defineProperty(scope, name, { value, configurable: true, enumerable: true, writable: true });",
    "  else scope[name] = value;",
    "}",
    "export function resetFields(event) {",
    "  const form = event.target;",
    "  setTimeout(() => {",
    "    if (event.defaultPrevented) return;",
    "    for (const { scope, name, had, previous } of formEdits.get(form) || []) {",
    "      if (had) scope[name] = previous;",
    "      else delete scope[name];",
    "    }",
    "    formEdits.delete(form);",
    "  }, 0);",
    "}",
    "export function listItemsWithOps(listOps, vars, name, limit, ...items) {",
    "  const scope = scopeOf(vars, ...items);",
    "  const rows = displayListRows(read(scope, name), listOps, name, scope);",
    "  return Number(limit) > 0 ? rows.slice(0, limit) : rows;",
    "}",
    // Keep the item on the hydrated element so event scripts can read typed row values.
    // The HTML only serializes the fields needed for list display operations.
    "export function bindRowItem(element, value) {",
    "  element.__siteRowItem = value;",
    "  return { update(next) { element.__siteRowItem = next; } };",
    "}",
    "export const vRowItem = (element, binding) => { element.__siteRowItem = binding.value; };",
    "export function serializeListItem(item, fields) {",
    "  const out = {};",
    "  if (item && typeof item === 'object') {",
    "    for (const field of fields || []) out[field] = read(item, field);",
    "  }",
    "  return JSON.stringify(out);",
    "}",
    "",
  ].join("\n");
}
