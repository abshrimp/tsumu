import { isPortableOutputPath } from "./output-paths";
import { zipCssUrl, zipStylesheet } from "../zip-css";
import type { Asset } from "../types";

/**
 * ZIP から取り込んだスクリプトのモジュールは、元の相対的なディレクトリに置かなければならない。
 * import "./chunk.js" や new URL("./icon.svg", import.meta.url) は、Tsumu が平らにした
 * アセット名ではなく、そのスクリプトファイルを基準に解決される。
 *
 * HTML や CSS で解決したアセットの URL は平らな出力パスを使うため、
 * モジュールの相対参照用のパスと両方を出力する。
 */
export function importedAssetPath(asset: Asset): string | null {
  const zip = asset.zip;
  if (!zip || zip.version !== 1) return null;
  if (typeof zip.group !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(zip.group)) return null;
  const path = zip.path;
  // ZIP accepts portable filenames containing parentheses, brackets, commas,
  // and other punctuation. Dropping these aliases breaks relative JS imports
  // even when the entry script itself can be published.
  if (typeof path !== "string" || path.length > 600 || path.includes("%") ||
      !isPortableOutputPath(path)) return null;
  // Reject malformed Unicode before importedAssetUrl calls encodeURIComponent.
  try { encodeURIComponent(path); } catch { return null; }
  return `public/assets/_imports/${zip.group}/${path}`;
}

export function importedAssetUrl(asset: Asset): string | null {
  const path = importedAssetPath(asset);
  return path ? "/" + path.slice("public/".length).split("/").map(encodeURIComponent).join("/") : null;
}

export function isZipJavascript(asset: Asset): boolean {
  return !!asset.zip && (/\b(?:javascript|ecmascript)\b/i.test(asset.mimeType || "") ||
    /\.(?:js|mjs|cjs)$/i.test(asset.zip.path));
}

/** 他のアーカイブの同じ内容を考える前に、そのページの ZIP の中のファイルを解決する。 */
export function htmlZipExportUrl(asset: Asset, names: Map<string, string>): string {
  const name = names.get(asset.id);
  if (!name) return "";
  const alias = isZipJavascript(asset) && importedAssetUrl(asset);
  return alias || "/assets/" + name;
}

export function htmlZipExportSource(asset: Asset, names: Map<string, string>): string {
  return zipStylesheet(asset) ? zipCssUrl(asset.id) : htmlZipExportUrl(asset, names);
}
