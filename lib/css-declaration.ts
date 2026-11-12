/**
 * 書かれたスタイルの CSS の宣言を1つ検証してから、生成するスタイルシートや
 * インラインの <style> 要素に入れる。引用符で囲んだ文字列・関数・data: の URL・
 * CSS のカスタムプロパティは残し、ルールの外へ抜け出せる字句は拒否する。
 * キャンバスと書き出しの両方の生成処理で共有できるようにしてある。
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
    // HTML の style 要素の終了タグは、CSS の引用符の中にあっても HTML として解釈される。
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

/** プロパティとアセットの処理を終えた後に使う、CSS の宣言。 */
export function safeCssDeclaration(name: unknown, value: unknown): string | null {
  const prop = safeCssPropertyName(name);
  if (!prop || !safeCssDeclarationValue(value)) return null;
  return prop + ": " + value + ";";
}

/** 有効なキーフレームのセレクターと、入れ子の宣言の中身だけを許す。
 * キーフレームの最上位に閉じ波括弧があると、囲んでいる @keyframes の外へ抜け出してしまう。
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
