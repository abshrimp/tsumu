import { assetSrc } from "./assets";
import { cssAssetReferences } from "./css-assets";
import type { Asset, NodeStyles } from "./types";

/** CSSをアセット数だけ読み直さず、各ノード・ページから使用中のIDを一度ずつ取り出す。 */
export function createCssAssetFinder(assets: Record<string, Asset>) {
  const bySrc = new Map<string, string[]>();
  for (const asset of Object.values(assets)) {
    // Match stored CSS aliases as strings only; they are never fetched here.
    const src = asset.path ? assetSrc(asset) : asset.dataUrl;
    if (!src) continue;
    const ids = bySrc.get(src) ?? [];
    ids.push(asset.id);
    bySrc.set(src, ids);
  }
  return (styles?: NodeStyles, customCss?: string): Set<string> => {
    const hits = new Set<string>();
    const scan = (css: string) => {
      for (const { url } of cssAssetReferences(css)) {
        // 同じファイルを指す別IDと、SVG等のフラグメントを除いた元画像も残す。
        const exact = bySrc.get(url);
        for (const id of exact ?? []) hits.add(id);
        // 書き出しと同じく、プロキシURLの追加クエリは元ファイルを指す。
        // 完全一致を優先し、パスの接頭辞やdata URLには適用しない。
        if (!exact && url.startsWith("/api/assets/file?path=")) {
          const suffix = url.search(/[&#]/);
          const ids = suffix >= 0 && url[suffix] === "&" ? bySrc.get(url.slice(0, suffix)) : undefined;
          if (ids) { ids.forEach((id) => hits.add(id)); continue; }
        }
        const hash = url.indexOf("#");
        if (hash >= 0) for (const id of bySrc.get(url.slice(0, hash)) ?? []) hits.add(id);
      }
    };
    for (const bp of Object.values(styles ?? {})) {
      for (const state of Object.values(bp)) {
        for (const value of Object.values(state ?? {})) scan(value);
      }
    }
    if (customCss) scan(customCss);
    return hits;
  };
}
