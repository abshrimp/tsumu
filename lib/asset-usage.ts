import { createCssAssetFinder } from "./css-asset-dependencies";
import { assetSrc } from "./assets";
import { zipAssetClosure } from "./zip-css";
import { importedAssetUrl, isZipJavascript } from "./generator/imported-assets";
import type { SiteDoc } from "./types";

/**
 * アセットごとの使用箇所の数。画像・動画の要素、背景などのスタイル、サイトとページの設定に加え、
 * スクリプトや HTML などに URL や ID が書かれているものも「使用中」として数える
 * （未使用の一括削除で消してしまわないよう、判定は控えめにする）。
 */
export function assetUsage(doc: SiteDoc): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (id: string | undefined | null) => {
    if (id && doc.assets[id]) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  const findCssAssets = createCssAssetFinder(doc.assets);
  for (const node of Object.values(doc.nodes)) {
    add(node.image?.assetId);
    add(node.media?.assetId);
    node.media?.sources?.forEach(source => add(source.assetId));
    findCssAssets(node.styles, node.customCss).forEach(add);
  }
  add(doc.favicon?.assetId);
  add(doc.appleTouchIcon?.assetId);
  add(doc.ogImage?.assetId);
  add(doc.pwa?.icon?.assetId);
  for (const page of Object.values(doc.pages)) {
    add(page.ogImage?.assetId);
    for (const id of page.htmlZip?.assetIds ?? []) add(id);
    findCssAssets(page.bodyStyles).forEach(add);
  }

  // それ以外（スクリプト・埋め込みの HTML など）に URL や ID が書かれていれば、使用中とみなす
  const { assets: _assets, ...rest } = doc;
  void _assets;
  const text = JSON.stringify(rest);
  for (const a of Object.values(doc.assets)) {
    if (usage.has(a.id)) continue;
    const src = assetSrc(a);
    const alias = importedAssetUrl(a);
    if (text.includes(a.id) || (src && text.includes(src)) || (alias && (text.includes(alias) || text.includes(decodeURIComponent(alias))))) usage.set(a.id, 1);
  }
  for (const id of zipAssetClosure(doc.assets, usage.keys())) if (!usage.has(id)) usage.set(id, 1);
  // ZIP の JavaScript のモジュールは、相対パスで隣のファイルを参照できる
  // （import("./chunk.js")、new URL("./image.png", import.meta.url) など）。
  // こうした参照はバイナリとして保存した JS のアセットの中にあり、ここでは調べられない。
  // そのため、ZIP の中のスクリプトが1つでも使われていれば、元の ZIP の一式をまとめて残し、
  // 依存するファイルを「未使用」として削除しないようにする。
  const activeGroups = new Set(Object.values(doc.assets)
    .filter((asset) => isZipJavascript(asset) && usage.has(asset.id))
    .map((asset) => asset.zip!.group));
  for (const asset of Object.values(doc.assets)) {
    if (asset.zip && activeGroups.has(asset.zip.group) && !usage.has(asset.id)) {
      usage.set(asset.id, 1);
    }
  }
  return usage;
}
