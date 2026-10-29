/**
 * The limited HTML attributes that an imported visual element can retain.
 * Script handlers, URL-bearing attributes and Tsumu's internal data-* markers
 * must never be copied from an untrusted HTML document.
 */
const EXTRA_ATTRIBUTES = new Set(["title", "role", "lang", "dir", "tabindex", "for", "htmlfor"]);
const RESERVED_DATA = /^(?:node|ghost|sel|bound|scripts|raw|array|tpl|inview|toggle-show|page-body|instance-node|instance-hidden|live(?:-.+)?|text-parts|href-parts|field-.+|tutorial|item|limit|client-list|list-ops)$/;
const MAX_COUNT = 64;
const MAX_LENGTH = 2048;

export function importedClass(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_LENGTH);
}

export function importedAttributes(
  input: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(result).length >= MAX_COUNT) break;
    if (typeof value !== "string" || value.length > MAX_LENGTH) continue;
    const name = key.toLowerCase();
    const allowed = EXTRA_ATTRIBUTES.has(name) ||
      /^aria-[a-z][a-z0-9_-]*$/.test(name) ||
      /^data-[a-z][a-z0-9_-]*$/.test(name);
    if (!allowed || /^on/i.test(name) || name.startsWith("data-tsumu-") ||
        (name.startsWith("data-") && RESERVED_DATA.test(name.slice(5)))) continue;
    const prop = name === "tabindex" ? "tabIndex" : (name === "for" || name === "htmlfor") ? "htmlFor" : name;
    result[prop] = value;
  }
  return result;
}

export function readImportedAttributes(element: Element): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) values[attr.name] = attr.value;
  const result = importedAttributes(values);
  return Object.keys(result).length ? result : undefined;
}
