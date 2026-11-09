/**
 * Validate one authored style-map CSS declaration before it enters a generated
 * stylesheet or an inline <style> element. Keep quoted strings, functions,
 * data: URLs and CSS custom properties; reject tokens that can escape a rule.
 * This utility is shared-ready for the Canvas and export generators.
 */
export function safeCssPropertyName(input: unknown): string | null {
  if (typeof input !== "string" ||
      !/^(?:--[\w\u0080-\uFFFF-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/.test(input)) return null;
  return input.startsWith("--") ? input :
    input.replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase());
}

export function safeCssDeclarationValue(input: unknown): input is string {
  if (typeof input !== "string") return false;
  let quote = "", comment = false, depth = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i], next = input[i + 1];
    // An HTML style-element end tag is parsed by HTML even inside CSS quotes.
    if (char === "<" && /^<\/style\b/i.test(input.slice(i, i + 12))) return false;
    if (comment) {
      if (char === "*" && next === "/") { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") { comment = true; i++; continue; }
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") { depth++; continue; }
    if (char === ")") { if (depth === 0) return false; depth--; continue; }
    if (char === "{" || char === "}" || (char === ";" && depth === 0)) return false;
  }
  return !quote && !comment && depth === 0;
}

/** A CSS declaration used after property/asset processing. */
export function safeCssDeclaration(name: unknown, value: unknown): string | null {
  const prop = safeCssPropertyName(name);
  if (!prop || !safeCssDeclarationValue(value)) return null;
  return prop + ": " + value + ";";
}
