import { tr } from "./i18n";
import type { Asset, ZipAssetMetadata } from "./types";
import { iterateCssAssetReferences, rewriteCssAssetUrls } from "./css-assets";
import { appendAssetSuffix, zipDependency } from "./zip-references";

// CSS is embedded in separate data URLs, not flattened into the importing sheet.
// Bounds cover both individual results and aggregate work, including ancestor-dependent variants.
export const ZIP_CSS_LIMITS = { source: 2 * 1024 * 1024, output: 8 * 1024 * 1024, work: 64 * 1024 * 1024, variants: 4096, assets: 2000 };
const limitError = () => new Error(tr("ZIPのCSSプレビューが大きすぎます。CSSの依存関係を減らしてZIPを再読み込みしてください。"));
export const zipCssUrl = (id: string) => `tsumu-zip-css:${encodeURIComponent(id)}`;

const sourceSizes = new WeakMap<object, { source: string; bytes: number }>();
function sourceBytes(sheet: NonNullable<ZipAssetMetadata["stylesheet"]>): number {
  const cached = sourceSizes.get(sheet);
  if (cached?.source === sheet.source) return cached.bytes;
  let bytes = 0;
  for (const c of sheet.source) {
    const point = c.codePointAt(0)!;
    bytes += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (bytes > ZIP_CSS_LIMITS.source) break;
  }
  sourceSizes.set(sheet, { source: sheet.source, bytes });
  return bytes;
}


export function zipStylesheet(asset: Asset | undefined): ZipAssetMetadata["stylesheet"] | undefined {
  const zip = asset?.zip;
  const sheet = zip?.stylesheet;
  if (!zip || zip.version !== 1 || typeof zip.group !== "string" || !zip.group ||
      typeof zip.path !== "string" || !/\.css$/i.test(zip.path) || asset?.mimeType !== "text/css" ||
      !sheet || typeof sheet.source !== "string" || sheet.source.length > ZIP_CSS_LIMITS.source || sourceBytes(sheet) > ZIP_CSS_LIMITS.source ||
      !Array.isArray(sheet.references) || sheet.references.length > ZIP_CSS_LIMITS.source ||
      !sheet.references.every((r) => r && typeof r.url === "string" && typeof r.assetId === "string" && !!r.assetId &&
        typeof r.suffix === "string" && (!r.suffix || /^[?#]/.test(r.suffix)))) return undefined;
  return sheet;
}

/** Called after all IDs are known. No CSS is changed or uploaded a second time. */
export function attachZipDependencies(assets: Asset[]): void {
  const ids = new Map(assets.filter((a) => a.zip).map((a) => [a.zip!.path, a.id]));
  for (const asset of assets) {
    const sheet = zipStylesheet(asset);
    if (!sheet) continue;
    const seen = new Set<string>();
    const references: typeof sheet.references = [];
    for (const { url } of iterateCssAssetReferences(sheet.source)) {
      if (seen.has(url)) continue;
      seen.add(url);
      const ref = zipDependency(url, asset.zip!.path, ids);
      if (ref) references.push({ url, ...ref });
    }
    sheet.references = references;
  }
}

export function zipAssetClosure(assets: Record<string, Asset>, roots: Iterable<string>): Set<string> {
  const found = new Set<string>();
  const pending = [...roots];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (found.has(id) || !Object.hasOwn(assets, id)) continue;
    found.add(id);
    for (const ref of zipStylesheet(assets[id])?.references ?? []) if (!found.has(ref.assetId)) pending.push(ref.assetId);
  }
  return found;
}

/** A cache query is preserved in exports, but must not become part of an opaque data payload. */
export function zipCssPreviewUrls(
  assets: Record<string, Asset>, roots: Iterable<string>, resourceUrl: (asset: Asset) => string,
  options: { baseUrl?: string } = {}
): Map<string, string> {
  const rootIds = [...new Set(roots)];
  const closure = zipAssetClosure(assets, rootIds);
  for (const id of closure) {
    if (assets[id].zip?.stylesheet !== undefined && !zipStylesheet(assets[id])) throw new Error(tr("ZIPのCSSデータを読み込めません。ZIPを再読み込みしてください。"));
  }
  if (closure.size > ZIP_CSS_LIMITS.assets || [...closure].reduce((n, id) => n + (zipStylesheet(assets[id]) ? sourceBytes(zipStylesheet(assets[id])!) : 0), 0) > ZIP_CSS_LIMITS.source) throw limitError();
  const cache = new Map<string, string>();
  let work = 0;
  let variants = 0;
  const empty = "data:text/css;charset=utf-8,";
  const encode = (css: string) => {
    let length = empty.length;
    for (const c of css) {
      const point = c.codePointAt(0)!;
      length += /^[A-Za-z0-9_.~-]$/.test(c) ? 1 : point < 128 ? 3 : point < 2048 ? 6 : point < 65536 ? 9 : 12;
      if (length > ZIP_CSS_LIMITS.output || work + length > ZIP_CSS_LIMITS.work) throw limitError();
    }
    work += length;
    return empty + encodeURIComponent(css).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  };
  const render = (id: string, ancestors: Set<string>): string => {
    if (ancestors.has(id)) return empty;
    const asset = assets[id];
    const sheet = zipStylesheet(asset);
    if (!sheet) return asset ? resourceUrl(asset) : "";
    const key = JSON.stringify([id, ...[...ancestors].sort()]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (++variants > ZIP_CSS_LIMITS.variants || ancestors.size >= 200) throw limitError();
    const next = new Set(ancestors).add(id);
    const refs = new Map(sheet.references.map((r) => [r.url, r]));
    const css = rewriteCssAssetUrls(sheet.source, (url) => {
      const ref = refs.get(url);
      const dependency = ref ? assets[ref.assetId] : undefined;
      if (!ref) {
        // A data stylesheet has no hierarchical base. Preserve the original editor-origin
        // meaning of archive-external root/protocol-relative URLs in preview only.
        if (url.startsWith("/") && options.baseUrl) {
          try { return new URL(url, options.baseUrl).href; } catch { /* Invalid URLs remain unchanged. */ }
        }
        return undefined;
      }
      if (!dependency) return undefined;
      const target = zipStylesheet(dependency) ? render(dependency.id, next) : resourceUrl(dependency);
      return appendAssetSuffix(target, ref.suffix);
    }, ZIP_CSS_LIMITS.output);
    const result = encode(css);
    cache.set(key, result);
    return result;
  };
  const out = new Map<string, string>();
  let output = 0;
  for (const id of rootIds) {
    const result = render(id, new Set());
    output += result.length;
    if (output > ZIP_CSS_LIMITS.output) throw limitError();
    out.set(id, result);
  }
  return out;
}

/** Each exported sheet stays separate. Native imports retain cycles, conditions and namespace scope. */
export function exportZipStylesheet(asset: Asset, names: Map<string, string>): string | undefined {
  const sheet = zipStylesheet(asset);
  if (!sheet) {
    if (asset.zip?.stylesheet !== undefined) throw new Error(tr("ZIPのCSSデータを読み込めません。ZIPを再読み込みしてください。"));
    return undefined;
  }
  const refs = new Map(sheet.references.map((r) => [r.url, r]));
  return rewriteCssAssetUrls(sheet.source, (url) => {
    const ref = refs.get(url);
    const name = ref ? names.get(ref.assetId) : undefined;
    return ref && name ? name + ref.suffix : undefined;
  });
}
