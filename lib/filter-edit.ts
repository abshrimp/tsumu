/** 最上位の CSS の関数だけを扱う。コメント、引用符で囲んだ URL、入れ子の代替値を、
 * 個別に編集できるフィルターの処理と取り違えてはいけない。 */
export function filterFunctions(value: string): { name: string; start: number; end: number; text: string }[] {
  const functions: { name: string; start: number; end: number; text: string }[] = [];
  let depth = 0;
  let quote = "";
  let start = -1;
  let name = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") { i++; continue; }
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "/" && value[i + 1] === "*") {
      const end = value.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (ch === "(") { depth++; continue; }
    if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        functions.push({ name, start, end: i + 1, text: value.slice(start, i + 1) });
        start = -1;
      }
      continue;
    }
    if (depth !== 0 || (i > 0 && /[\w-]/.test(value[i - 1]))) continue;
    const match = /^([\w-]+)\(/.exec(value.slice(i));
    if (!match) continue;
    start = i;
    name = match[1].toLowerCase();
    i += match[0].length - 1;
    depth = 1;
  }
  return functions;
}

/** 選んだ関数のうち最初のものだけを置き換える。順序と繰り返しには意味がある。 */
export function editFilterFunction(raw: string | undefined, name: string, replacement: string | null): string | null {
  const value = raw?.trim() ?? "";
  const base = /^(?:none|initial|unset|inherit|revert|revert-layer)$/i.test(value) ? "" : value;
  const match = filterFunctions(base).find(fn => fn.name === name.toLowerCase());
  if (match) return [base.slice(0, match.start).trim(), replacement, base.slice(match.end).trim()].filter(Boolean).join(" ") || null;
  return [base, replacement].filter(Boolean).join(" ") || null;
}
