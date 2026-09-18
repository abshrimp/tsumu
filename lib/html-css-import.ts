import type { Asset } from "./types";
import { assetSrc } from "./assets";
import { rewriteCssAssetUrls } from "./css-assets";
import { appendAssetSuffix } from "./zip-references";
import { zipStylesheet, ZIP_CSS_LIMITS } from "./zip-css";

export interface ResolvedZipCss {
  css: string;
  /** 安全に展開できず、カスタムコードに残す必要のあるルール。 */
  unresolved: string[];
}

interface ImportStatement {
  start: number;
  end: number;
  url: string;
  media: string;
  raw: string;
}

/** 最上位の CSS の import を読む。文字列・コメント・入れ子のルールは無視する。 */
function findImports(css: string): ImportStatement[] {
  const out: ImportStatement[] = [];
  let depth = 0;
  for (let i = 0; i < css.length;) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      for (; i < css.length; i++) {
        if (css[i] === "\\") { i++; continue; }
        if (css[i] === quote) { i++; break; }
      }
      continue;
    }
    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth || css.slice(i, i + 7).toLowerCase() !== "@import" ||
        !/[\s]/.test(css[i + 7] || "")) { i++; continue; }
    const start = i;
    i += 7;
    let quote = "", parens = 0;
    for (; i < css.length; i++) {
      const c = css[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end < 0 ? css.length : end + 1;
        continue;
      }
      if (c === "(") parens++;
      if (c === ")") parens = Math.max(0, parens - 1);
      if (c === ";" && !parens) { i++; break; }
    }
    const raw = css.slice(start, i);
    const match = /^@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]+?))\s*\)|"([^"]+)"|'([^']+)')\s*([^;]*);$/i.exec(raw.trim());
    if (match) {
      out.push({ start, end: i, url: (match[1] || match[2] || match[3] ||
        match[4] || match[5]).trim(), media: (match[6] || "").trim(), raw });
    } else {
      out.push({ start, end: i, url: "", media: "", raw });
    }
  }
  return out;
}

/** 対応している @import の layer と media の修飾子を表す。メディアクエリを作り出すことはしない。 */
function importConditions(condition: string): { media: string; layer?: string } | null {
  let media = condition.trim();
  let layer: string | undefined;
  const modifier = /^layer(?:\(\s*([a-z_][\w-]*(?:\.[a-z_][\w-]*)*)\s*\))?(?=\s|$)/i.exec(media);
  if (modifier) {
    layer = modifier[1] ?? "";
    media = media.slice(modifier[0].length).trim();
  }
  if (media && media.toLowerCase() !== "all" &&
      (/\blayer\b|\bsupports\s*\(/i.test(media) ||
       /^(?:print|speech)\b/i.test(media) ||
       !/^[a-z0-9\s(),:./-]+$/i.test(media))) return null;
  return { media, ...(layer === undefined ? {} : { layer }) };
}

/**
 * ローカルの HTML の ZIP の CSS を、メディアクエリの条件を保ったまま再帰的にインラインにし、
 * url() はそれを *持つ* スタイルシートを基準に解決する。ここではネットワークへの
 * リクエスト、DOM の変更、スクリプトの実行は行わない。
 */
export function expandZipCss(
  input: string,
  assets: Asset[],
  warning: (message: string) => void = () => {},
  owner?: Asset,
): ResolvedZipCss {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const bySrc = new Map<string, Asset>(assets
    .map((asset) => [assetSrc(asset), asset] as const)
    .filter(([src]) => !!src));
  const unresolved: string[] = [];
  let size = 0;

  const resolveImport = (url: string, relatedId?: string): Asset | undefined => {
    const protocol = /^tsumu-zip-css:([^?#]+)/i.exec(url);
    if (protocol) {
      try { return byId.get(decodeURIComponent(protocol[1])); }
      catch { return undefined; }
    }
    if (relatedId) return byId.get(relatedId);
    return bySrc.get(url);
  };

  const expand = (css: string, asset: Asset | undefined, stack: Set<string>): string => {
    if (stack.size > 20 || size > ZIP_CSS_LIMITS.work) {
      throw new Error("The stylesheet dependency graph is too complex.");
    }
    const references = new Map((zipStylesheet(asset)?.references ?? []).map((ref) => [ref.url, ref]));
    // Rewrite each sheet's own declarations before inserting its imports.
    // Text already expanded from a child belongs to a different directory.
    let result = "", from = 0;
    const append = (part: string) => {
      if (part.length > ZIP_CSS_LIMITS.output - result.length) throw new Error("Expanded CSS is too large.");
      result += part;
    };
    const rewriteOwnUrls = (source: string) => {
      if (!references.size || !source) return source;
      return rewriteCssAssetUrls(source, (url) => {
        const ref = references.get(url);
        if (!ref) return undefined;
        const dep = byId.get(ref.assetId);
        if (!dep || zipStylesheet(dep)) return undefined;
        const src = assetSrc(dep);
        return src ? appendAssetSuffix(src, ref.suffix) : undefined;
      }, ZIP_CSS_LIMITS.output - result.length);
    };
    for (const statement of findImports(css)) {
      append(rewriteOwnUrls(css.slice(from, statement.start)));
      from = statement.end;
      const target = resolveImport(statement.url, references.get(statement.url)?.assetId);
      const sheet = zipStylesheet(target);
      const conditions = importConditions(statement.media);
      if (!sheet || !conditions) {
        unresolved.push(statement.raw);
        warning("Some CSS @import rules could not be resolved; they were kept as custom code.");
        continue;
      }
      if (stack.has(target!.id)) {
        warning("A circular CSS @import was skipped.");
        continue;
      }
      const inner = expand(sheet.source, target, new Set(stack).add(target!.id));
      const layered = conditions.layer === undefined ? inner :
        `@layer${conditions.layer ? " " + conditions.layer : ""} {\n${inner}\n}`;
      append(conditions.media && conditions.media.toLowerCase() !== "all"
        ? `@media ${conditions.media} {\n${layered}\n}\n`
        : layered + "\n");
    }
    append(rewriteOwnUrls(css.slice(from)));
    size += result.length;
    if (size > ZIP_CSS_LIMITS.work) {
      throw new Error("Expanded CSS is too large.");
    }
    return result;
  };

  const css = expand(input, owner, new Set(owner ? [owner.id] : []));
  return { css, unresolved };
}
