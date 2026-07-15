/** CSSのURLだけを扱い、コメントや通常の文字列、別URLの一部分は変更しない。 */
type Reference = { start: number; end: number; url: string; quote: string };
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

function decode(css: string): string {
  return css.replace(/\\([0-9a-f]{1,6}(?:\r\n|[\t\n\f\r ])?|\r\n|[\s\S])/gi, (_, value: string) => {
    if (/^[0-9a-f]/i.test(value)) {
      const point = parseInt(value, 16);
      return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? "\uFFFD" : String.fromCodePoint(point);
    }
    return /[\n\r\f]/.test(value) ? "" : value;
  });
}

function references(css: string): Reference[] {
  const out: Reference[] = [];
  const stack: { name: string; candidate: boolean }[] = [];
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
  for (let i = 0; i < css.length;) {
    const next = skipTrivia(i);
    if (next !== i) { i = next; continue; }
    const c = css[i];
    const parent = stack.at(-1);
    if (c === '"' || c === "'") {
      const end = stringEnd(i);
      if (end < 0) break;
      if (parent?.candidate && /^(?:-webkit-)?image-set$/.test(parent.name)) {
        out.push({ start: i + 1, end, url: decode(css.slice(i + 1, end)), quote: c });
      }
      if (parent) parent.candidate = false;
      i = end + 1;
    } else if (nameChar(c) || c === "\\") {
      const start = i;
      while (i < css.length && (nameChar(css[i]) || css[i] === "\\")) {
        i = css[i] === "\\" ? escapeEnd(css, i) : i + 1;
      }
      const name = decode(css.slice(start, i)).toLowerCase();
      if (parent) parent.candidate = false;
      if (css[i] !== "(") continue;
      if (name !== "url") {
        stack.push({ name, candidate: true }); i++; continue;
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
          // 無引用URL内の引用符・括弧・制御文字は不正。安全のため置換しない。
          if (/["'(\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(css[end])) break;
          if (css[end] === "\\" && /[\n\r\f]/.test(css[end + 1] ?? "")) break;
          end = css[end] === "\\" ? escapeEnd(css, end) : end + 1;
        }
        close = skipTrivia(end);
      }
      if (css[close] === ")") {
        out.push({ start: from, end, url: decode(css.slice(from, end)), quote });
        i = close + 1;
      } else {
        // 不正なurl()の内部を別の参照として解釈しない。
        const close = css.indexOf(")", end);
        i = close < 0 ? css.length : close + 1;
      }
    } else {
      if (c === "(") stack.push({ name: "", candidate: false });
      else if (c === ")") stack.pop();
      else if (c === "," && parent) parent.candidate = true;
      else if (parent) parent.candidate = false;
      i++;
    }
  }
  return out;
}

/** 完全一致を優先し、SVG等のフラグメントだけは元の参照から引き継ぐ。 */
function replacement(
  url: string, sources: ReadonlyMap<string, string>, proxyQueries = false
): string | undefined {
  if (sources.has(url)) return sources.get(url);
  // ZIPから読み込んだプロキシURLの追加クエリを、書き出すファイルへ引き継ぐ。
  // パスの一部が同じ別アセットやdata URLには適用しない。
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

function encode(url: string, quote: string): string {
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
  for (const ref of references(css)) {
    const target = replacement(ref.url, sources, options.proxyQueries);
    if (target === undefined || target === ref.url) continue;
    result += css.slice(from, ref.start) + encode(target, ref.quote);
    from = ref.end;
  }
  return result + css.slice(from);
}

export function cssUsesAssetUrl(css: string, source: string): boolean {
  if (!source) return false;
  const sources = new Map([[source, source]]);
  return references(css).some((ref) => replacement(ref.url, sources) !== undefined);
}
