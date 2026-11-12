import { tr } from "./i18n";
import { decodeCssEscapes as decode } from "./css-escape";

/** 値に CSS のリソースの URL を含み得る、HTML の style 属性と SVG の表示属性。 */
export const CSS_ASSET_ATTRIBUTES = ["style", "fill", "stroke", "filter", "clip-path", "mask", "marker", "marker-start", "marker-mid", "marker-end", "cursor"];

/** CSS の URL だけを扱い、コメント・通常の文字列・別の URL の一部は変更しない。 */
type Reference = { start: number; end: number; url: string; quote: string; isImport: boolean };
const space = (c: string) => /[\t\n\f\r ]/.test(c);
const nameChar = (c: string) => /[\w\u0080-\uFFFF-]/.test(c);

function escapeEnd(css: string, start: number): number {
  let end = start + 1;
  if (/[0-9a-f]/i.test(css[end] ?? "")) {
    while (end < start + 7 && /[0-9a-f]/i.test(css[end] ?? "")) end++;
    if (space(css[end] ?? "")) {
      if (css[end] === "\r" && css[end + 1] === "\n") end++;
      end++;
    }
  } else if (css[end] === "\r" && css[end + 1] === "\n") end += 2;
  else if (end < css.length) end++;
  return end;
}

export function cssAssetReferences(css: string): Reference[] {
  return Array.from(iterateCssAssetReferences(css));
}

export function* iterateCssAssetReferences(css: string, maxDepth = Infinity): Generator<Reference> {
  let atRuleTarget: "import" | "namespace" | undefined;
  // 括弧1つにつき1バイトだけ使う。深い CSS や、括弧の対応が取れていない CSS でも、字句ごとにオブジェクトを作らない。
  const other = 0, imageSet = 1, imageCandidate = 2;
  let stack = new Uint8Array(16);
  let depth = 0;
  const skipTrivia = (from: number): number => {
    let i = from;
    while (i < css.length) {
      if (space(css[i])) i++;
      else if (css.slice(i, i + 2) === "/*") {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? css.length : end + 2;
      } else break;
    }
    return i;
  };
  const stringEnd = (from: number): number => {
    const quote = css[from];
    let i = from + 1;
    while (i < css.length) {
      if (css[i] === quote) return i;
      if (/[\n\r\f]/.test(css[i])) return -1;
      i = css[i] === "\\" ? escapeEnd(css, i) : i + 1;
    }
    return -1;
  };
  function open(state: number) {
    if (depth >= maxDepth) throw new Error("CSS function nesting exceeds the single HTML limit.");
    if (depth === stack.length) {
      const larger = new Uint8Array(depth * 2);
      larger.set(stack);
      stack = larger;
    }
    stack[depth++] = state;
  }
  for (let i = 0; i < css.length;) {
    const next = skipTrivia(i);
    if (next !== i) { i = next; continue; }
    const c = css[i];
    const parent = stack[depth - 1];
    if (c === "@") {
      const start = ++i;
      while (i < css.length && (nameChar(css[i]) || css[i] === "\\")) {
        i = css[i] === "\\" ? escapeEnd(css, i) : i + 1;
      }
      const name = decode(css.slice(start, i)).toLowerCase();
      atRuleTarget = name === "import" || name === "namespace" ? name : undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = stringEnd(i);
      if (end < 0) break;
      if (atRuleTarget === "import" || parent === imageCandidate) {
        yield { start: i + 1, end, url: decode(css.slice(i + 1, end)), quote: c, isImport: atRuleTarget === "import" };
      }
      atRuleTarget = undefined;
      if (parent === imageCandidate) stack[depth - 1] = imageSet;
      i = end + 1;
    } else if (nameChar(c) || c === "\\") {
      const start = i;
      while (i < css.length && (nameChar(css[i]) || css[i] === "\\")) {
        i = css[i] === "\\" ? escapeEnd(css, i) : i + 1;
      }
      const name = decode(css.slice(start, i)).toLowerCase();
      if (parent === imageCandidate) stack[depth - 1] = imageSet;
      if (css[i] !== "(") {
        // @namespace では、URI の前に識別子の接頭辞が付くことがある。
        if (atRuleTarget !== "namespace") atRuleTarget = undefined;
        continue;
      }
      if (name !== "url") {
        atRuleTarget = undefined;
        open(name === "image-set" || name === "-webkit-image-set" ? imageCandidate : other); i++; continue;
      }
      let from = skipTrivia(i + 1);
      let end = from;
      let close = from;
      const quote = css[from] === '"' || css[from] === "'" ? css[from] : "";
      if (quote) {
        end = stringEnd(from);
        if (end < 0) break;
        close = skipTrivia(end + 1);
        from++;
      } else {
        while (end < css.length && css[end] !== ")" && !space(css[end])) {
          // 引用符の無い URL の中の引用符・括弧・制御文字は不正。安全のため置き換えない。
          if (/["'(\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(css[end])) break;
          if (css[end] === "\\" && /[\n\r\f]/.test(css[end + 1] ?? "")) break;
          end = css[end] === "\\" ? escapeEnd(css, end) : end + 1;
        }
        close = skipTrivia(end);
      }
      if (css[close] === ")") {
        if (atRuleTarget !== "namespace") yield { start: from, end, url: decode(css.slice(from, end)), quote, isImport: atRuleTarget === "import" };
        i = close + 1;
      } else {
        // 不正な url() の中を、別の参照として解釈しない。
        const close = css.indexOf(")", end);
        i = close < 0 ? css.length : close + 1;
      }
      atRuleTarget = undefined;
    } else {
      atRuleTarget = undefined;
      if (c === "(") open(other);
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === "," && parent === imageSet) stack[depth - 1] = imageCandidate;
      else if (c !== "," && parent === imageCandidate) stack[depth - 1] = imageSet;
      i++;
    }
  }
}

/** 完全一致を優先し、SVG などのフラグメントだけは元の参照から引き継ぐ。 */
function replacement(
  url: string, sources: ReadonlyMap<string, string>, proxyQueries = false
): string | undefined {
  if (sources.has(url)) return sources.get(url);
  // ZIP から読み込んだプロキシの URL の追加のクエリを、書き出すファイルへ引き継ぐ。
  // パスの一部が同じ別のアセットや、data URL には適用しない。
  if (proxyQueries && url.startsWith("/api/assets/file?path=")) {
    const suffix = url.search(/[&#]/);
    if (suffix >= 0 && url[suffix] === "&") {
      const target = sources.get(url.slice(0, suffix));
      if (target !== undefined) return target + url.slice(suffix).replace(/^&(?:amp;)?/, "?");
    }
  }
  const hash = url.indexOf("#");
  if (hash < 0) return undefined;
  const target = sources.get(url.slice(0, hash));
  return target === undefined ? undefined : target + url.slice(hash);
}

/** 書かれた CSS を HTML の style 要素の中に収める。大文字・小文字と CSS の文字列の値は変えない。 */
export function escapeStyleContent(css: string): string {
  return css.replace(/<\/(?=style)/gi, "<\\/");
}

export function escapeCssAssetUrl(url: string, quote: string): string {
  return url.replace(/[\\"'()\s\u0000-\u001f\u007f]/g, (c) => {
    if (c === "\\" || c === quote || (!quote && /["'()]/.test(c))) return `\\${c}`;
    if (/[\s\u0000-\u001f\u007f]/.test(c)) return `\\${c.charCodeAt(0).toString(16)} `;
    return c;
  });
}

export function replaceCssAssetUrls(
  css: string, sources: ReadonlyMap<string, string>, options: { proxyQueries?: boolean } = {}
): string {
  let result = "";
  let from = 0;
  for (const ref of iterateCssAssetReferences(css)) {
    const target = replacement(ref.url, sources, options.proxyQueries);
    if (target === undefined || target === ref.url) continue;
    result += css.slice(from, ref.start) + escapeCssAssetUrl(target, ref.quote);
    from = ref.end;
  }
  return result + css.slice(from);
}

export function cssUsesAssetUrl(css: string, source: string): boolean {
  if (!source) return false;
  const sources = new Map([[source, source]]);
  for (const ref of iterateCssAssetReferences(css)) {
    if (replacement(ref.url, sources) !== undefined) return true;
  }
  return false;
}

/** 実際の CSS のリソースの字句だけを書き換える。読み込んだルールの構文と条件は変えない。 */
export function rewriteCssAssetUrls(
  css: string, resolve: (url: string) => string | undefined, maxLength = Infinity
): string {
  const parts: string[] = [];
  let from = 0;
  let length = 0;
  const append = (part: string) => {
    length += part.length;
    if (length > maxLength) throw new Error(tr("The ZIP stylesheet preview is too large. Reduce the CSS dependencies and import the ZIP again."));
    parts.push(part);
  };
  for (const ref of iterateCssAssetReferences(css)) {
    const target = resolve(ref.url);
    if (target === undefined || target === ref.url) continue;
    // CSS のエスケープは URL の長さの数倍のメモリを使うことがあるため、エスケープの前に確かめる。
    if (length + ref.start - from + target.length > maxLength) {
      throw new Error(tr("The ZIP stylesheet preview is too large. Reduce the CSS dependencies and import the ZIP again."));
    }
    append(css.slice(from, ref.start));
    append(escapeCssAssetUrl(target, ref.quote));
    from = ref.end;
  }
  append(css.slice(from));
  return parts.join("");
}
