import { assetDocUrl, assetSrc } from "./assets";
import { iterateCssAssetReferences } from "./css-assets";
import type { Asset, NodeStyles } from "./types";

/** アセットの数だけ CSS を読み直さず、各ノードとページから、使用中の ID を一度ずつ取り出す。 */
export function createCssAssetFinder(assets: Record<string, Asset>) {
  const bySrc = new Map<string, string[]>();
  const byPath = new Map<string, string[]>();
  for (const asset of Object.values(assets)) {
    // The site query identifies the requester, not the underlying stored file.
    if (asset.path) {
      const ids = byPath.get(asset.path) ?? [];
      ids.push(asset.id);
      byPath.set(asset.path, ids);
    }
    for (const src of new Set([asset.path ? assetDocUrl(asset) : asset.dataUrl, asset.path ? assetSrc(asset) : undefined])) {
      if (!src) continue;
      const ids = bySrc.get(src) ?? [];
      ids.push(asset.id);
      bySrc.set(src, ids);
    }
  }
  return (styles?: NodeStyles, customCss?: string): Set<string> => {
    const hits = new Set<string>();
    const scan = (css: string) => {
      // A CSS resource appears in a function or a quoted @import.
      if (!/[(@]/.test(css)) return;
      for (const { url } of iterateCssAssetReferences(css)) {
        // 同じファイルを指す別の ID と、SVG などのフラグメントを除いた元の画像も残す。
        const exact = bySrc.get(url);
        for (const id of exact ?? []) hits.add(id);
        // 書き出しと同じく、プロキシの URL に付いた追加のクエリは元のファイルを指すものとして扱う。
        // 完全一致を優先し、パスの接頭辞や data URL には適用しない。
        // A full source match takes precedence over its underlying file: a
        // separate data-backed asset may intentionally use a query-specific URL.
        if (!exact && url.startsWith("/api/assets/file?")) {
          const query = url.slice("/api/assets/file?".length).split("#", 1)[0];
          const path = new URLSearchParams(query).get("path");
          if (path) for (const id of byPath.get(path) ?? []) hits.add(id);
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
