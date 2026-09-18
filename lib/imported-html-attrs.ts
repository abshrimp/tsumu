import { submissionAttributes } from "./imported-form";

/**
 * 取り込んだ視覚的な要素が残せる、限られた HTML の属性。
 * フォームの送信属性は submissionAttributes で別途検証する。
 */
const EXTRA_ATTRIBUTES = new Set(["title", "role", "lang", "dir", "tabindex", "for", "htmlfor"]);
const RESERVED_DATA = /^(?:node|ghost|sel|bound|scripts|raw|array|tpl|inview|toggle-show|page-body|instance-node|instance-hidden|live(?:-.+)?|text-parts|href-parts|field-.+|tutorial|item|limit|client-list|list-ops|site-state|edited|row|list-fallback|image-src-parts|static-href|static-src|static-option|loader|page-plan|page-variants|variant-root|driven)$/;
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
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_COUNT) break;
    if (typeof value !== "string" || value.length > MAX_LENGTH) continue;
    const name = key.toLowerCase();
    const allowed = EXTRA_ATTRIBUTES.has(name) ||
      /^aria-[a-z][a-z0-9_-]*$/.test(name) ||
      /^data-[a-z][a-z0-9_-]*$/.test(name);
    if (!allowed || /^on/i.test(name) || name.startsWith("data-tsumu-") ||
        (name.startsWith("data-") && RESERVED_DATA.test(name.slice(5)))) continue;
    const prop = name === "tabindex" ? "tabIndex" : (name === "for" || name === "htmlfor") ? "htmlFor" : name;
    if (!Object.hasOwn(result, prop)) count++;
    result[prop] = value;
  }
  return result;
}

export function readImportedAttributes(element: Element, resolveAction?: (action: string) => string): Record<string, string> | undefined {
  const tag = element.tagName.toLowerCase();
  if (!element.attributes.length && tag !== "form" && tag !== "button") return;
  const values: Record<string, string> = Object.create(null);
  for (const attr of element.attributes) values[attr.name.toLowerCase()] = attr.value;
  // 省略時の HTML の既定値を保存し、エディタで新規作成したフォームやボタンと区別する。
  if (tag === "form") values.method ??= "get";
  if (tag === "button") values.type ??= "submit";
  const result = { ...importedAttributes(values), ...submissionAttributes(values, tag, resolveAction, values.type?.toLowerCase() === "submit") };
  return Object.keys(result).length ? result : undefined;
}
