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

/** Allow valid keyframe selectors and nested declaration content only.
 * A closing brace at keyframe top level would escape the enclosing @keyframes.
 */
export function safeCssKeyframesBody(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 1_000_000) return false;
  let quote = "", comment = false, depth = 0, blockEnd = 0, blocks = 0;
  const selector = /^(?:from|to|[0-9]+(?:\.[0-9]+)?%)(?:\s*,\s*(?:from|to|[0-9]+(?:\.[0-9]+)?%))*$/i;
  const trivia = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  for (let i = 0; i < input.length; i++) {
    const ch = input[i], next = input[i + 1];
    if (ch === "<" && /^<\/style\b/i.test(input.slice(i, i + 12))) return false;
    if (comment) { if (ch === "*" && next === "/") { comment = false; i++; } continue; }
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "*") { comment = true; i++; continue; }
    if (ch === "\\") { i++; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "{") {
      if (depth !== 0 || !selector.test(trivia(input.slice(blockEnd, i)))) return false;
      depth = 1; blocks++;
    } else if (ch === "}") {
      if (depth !== 1) return false;
      depth = 0; blockEnd = i + 1;
    } else if (ch === ";" && depth === 0) {
      return false;
    }
  }
  return blocks > 0 && depth === 0 && !quote && !comment &&
    trivia(input.slice(blockEnd)) === "";
}
