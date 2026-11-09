/** CSS shorthand components are separated by top-level whitespace, not the
 * spaces inside calc(), var() fallbacks, or quoted strings. */
export function cssValueParts(value: string): string[] {
  const parts: string[] = [];
  let token = "", depth = 0, quote = "";
  const flush = () => { if (token) parts.push(token); token = ""; };
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") { token += ch + (value[++i] ?? ""); continue; }
    if (quote) { token += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; token += ch; continue; }
    if (ch === "/" && value[i + 1] === "*") {
      const end = value.indexOf("*/", i + 2);
      if (end < 0) { token += value.slice(i); break; }
      if (depth) token += value.slice(i, end + 2);
      else flush();
      i = end + 1;
      continue;
    }
    if (/\s/.test(ch) && depth === 0) { flush(); continue; }
    token += ch;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
  }
  flush();
  return parts;
}
