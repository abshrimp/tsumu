import { assetSrc } from "./assets";
import { iterateCssAssetReferences } from "./css-assets";
import type { Asset, NodeStyles } from "./types";

/** アセットの数だけ CSS を読み直さず、各ノードとページから、使用中の ID を一度ずつ取り出す。 */
export function createCssAssetFinder(assets: Record<string, Asset>) {
  const bySrc = new Map<string, string[]>();
  for (const asset of Object.values(assets)) {
    // 保存した CSS の別名は文字列として照合するだけで、ここで取得はしない。
    const src = asset.path ? assetSrc(asset) : asset.dataUrl;
    if (!src) continue;
    const ids = bySrc.get(src) ?? [];
    ids.push(asset.id);
    bySrc.set(src, ids);
  }
  return (styles?: NodeStyles, customCss?: string): Set<string> => {
    const hits = new Set<string>();
    const scan = (css: string) => {
      for (const { url } of iterateCssAssetReferences(css)) {
        // 同じファイルを指す別の ID と、SVG などのフラグメントを除いた元の画像も残す。
        const exact = bySrc.get(url);
        for (const id of exact ?? []) hits.add(id);
        // 書き出しと同じく、プロキシの URL に付いた追加のクエリは元のファイルを指すものとして扱う。
        // 完全一致を優先し、パスの接頭辞や data URL には適用しない。
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
