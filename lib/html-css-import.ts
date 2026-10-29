import type { Asset } from "./types";
import { assetSrc } from "./assets";
import { rewriteCssAssetUrls } from "./css-assets";
import { appendAssetSuffix } from "./zip-references";
import { zipStylesheet, ZIP_CSS_LIMITS } from "./zip-css";

export interface ResolvedZipCss {
  css: string;
  /** Rules that could not safely be expanded and must remain in custom code. */
  unresolved: string[];
}

interface ImportStatement {
  start: number;
  end: number;
  url: string;
  media: string;
  raw: string;
}

/** Read top-level CSS imports, ignoring strings, comments and nested rules. */
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

const supportedImportMedia = (condition: string): boolean =>
  !condition || condition === "all" ||
  (!/\b(?:layer|supports)\s*\(/i.test(condition) &&
   !/^(?:print|speech)\b/i.test(condition) &&
   /^[a-z0-9\s(),:./-]+$/i.test(condition));

/**
 * Recursively inline CSS from a local HTML ZIP while preserving media query
 * conditions and resolving url() against the *owning* stylesheet. No network
 * request, DOM mutation, or script execution is performed here.
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

  const resolveImport = (url: string, asset?: Asset): Asset | undefined => {
    const protocol = /^tsumu-zip-css:([^?#]+)/i.exec(url);
    if (protocol) {
      try { return byId.get(decodeURIComponent(protocol[1])); }
      catch { return undefined; }
    }
    const related = zipStylesheet(asset)?.references.find((ref) => ref.url === url);
    if (related) return byId.get(related.assetId);
    return bySrc.get(url);
  };

  const expand = (css: string, asset: Asset | undefined, stack: Set<string>): string => {
    if (stack.size > 20 || size > ZIP_CSS_LIMITS.work) {
      throw new Error("The stylesheet dependency graph is too complex.");
    }
    let result = "", from = 0;
    for (const statement of findImports(css)) {
      result += css.slice(from, statement.start);
      from = statement.end;
      const target = resolveImport(statement.url, asset);
      const sheet = zipStylesheet(target);
      if (!sheet || !supportedImportMedia(statement.media)) {
        unresolved.push(statement.raw);
        warning("Some CSS @import rules could not be resolved; they were kept as custom code.");
        continue;
      }
      if (stack.has(target!.id)) {
        warning("A circular CSS @import was skipped.");
        continue;
      }
      const inner = expand(sheet.source, target, new Set(stack).add(target!.id));
      result += statement.media && statement.media.toLowerCase() !== "all"
        ? `@media ${statement.media} {\n${inner}\n}\n`
        : inner + "\n";
    }
    result += css.slice(from);
    const references = new Map((zipStylesheet(asset)?.references ?? []).map((r) => [r.url, r] as const));
    result = rewriteCssAssetUrls(result, (url) => {
      const ref = references.get(url);
      if (!ref) return undefined;
      const dep = byId.get(ref.assetId);
      if (!dep || zipStylesheet(dep)) return undefined;
      const src = assetSrc(dep);
      return src ? appendAssetSuffix(src, ref.suffix) : undefined;
    }, ZIP_CSS_LIMITS.output);
    size += result.length;
    if (result.length > ZIP_CSS_LIMITS.output || size > ZIP_CSS_LIMITS.work) {
      throw new Error("Expanded CSS is too large.");
    }
    return result;
  };

  const css = expand(input, owner, new Set(owner ? [owner.id] : []));
  return { css, unresolved };
}
