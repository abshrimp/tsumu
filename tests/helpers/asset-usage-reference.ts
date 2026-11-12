import { cssUsesAssetUrl } from "../../lib/css-assets";
import { assetSrc } from "../../lib/assets";
import { zipAssetClosure } from "../../lib/zip-css";
import type { SiteDoc } from "../../lib/types";

/** 最適化する前の数え方。URL の別名や、控えめな未使用の判定も含めて、差分のテストの基準にする。 */
/**
 * アセットごとの使用箇所の数。画像・動画の要素、背景などのスタイル、サイトとページの設定に加え、
 * スクリプトや HTML などに URL や ID が書かれているものも「使用中」として数える
 * （未使用の一括削除で消してしまわないよう、判定は控えめにする）。
 */
export function referenceAssetUsage(doc: SiteDoc): Map<string, number> {
  const usage = new Map<string, number>();
  const add = (id: string | undefined | null) => {
    if (id && doc.assets[id]) usage.set(id, (usage.get(id) ?? 0) + 1);
  };
  const bySrc = Object.values(doc.assets)
    .map((a) => [a.id, assetSrc(a)] as const)
    .filter(([, src]) => !!src);
  for (const node of Object.values(doc.nodes)) {
    add(node.image?.assetId);
    add(node.media?.assetId);
    const hits = new Set<string>();
    for (const bp of Object.values(node.styles)) {
      for (const styles of Object.values(bp)) {
        for (const value of Object.values(styles ?? {})) {
          for (const [id, src] of bySrc) if (cssUsesAssetUrl(value, src)) hits.add(id);
        }
      }
    }
    hits.forEach(add);
  }
  add(doc.favicon?.assetId);
  add(doc.appleTouchIcon?.assetId);
  add(doc.ogImage?.assetId);
  add(doc.pwa?.icon?.assetId);
  for (const page of Object.values(doc.pages)) add(page.ogImage?.assetId);

  // それ以外（スクリプト・埋め込みの HTML など）に URL や ID が書かれていれば、使用中とみなす
  const { assets: _assets, ...rest } = doc;
  void _assets;
  const text = JSON.stringify(rest);
  for (const a of Object.values(doc.assets)) {
    if (usage.has(a.id)) continue;
    const src = assetSrc(a);
    if (text.includes(a.id) || (src && text.includes(src))) usage.set(a.id, 1);
  }
  for (const id of zipAssetClosure(doc.assets, usage.keys())) if (!usage.has(id)) usage.set(id, 1);
  return usage;
}
