/** 2列のアセットカード。画像比率・名前/詳細欄の高さはglobals.cssと揃える。 */
export const ASSET_WINDOW_THRESHOLD = 100;
export function assetWindow(count: number, width: number, height: number, scrollTop: number, pinned: number[] = []) {
  const rowHeight = Math.max(1, (width - 34) / 2) * 3 / 4 + 50;
  const rows = Math.ceil(count / 2);
  const totalHeight = Math.max(0, rows * rowHeight - 10 + 12);
  const top = Math.max(0, Math.min(scrollTop, totalHeight - height));
  const first = Math.max(0, Math.floor(top / rowHeight) - 3);
  const last = Math.min(rows, Math.ceil((top + height) / rowHeight) + 3);
  const indices = new Set<number>();
  for (let i = first * 2; i < Math.min(count, last * 2); i++) indices.add(i);
  for (const index of pinned) if (index >= 0 && index < count) indices.add(index);
  return { indices: [...indices].sort((a, b) => a - b), rowHeight, totalHeight, top };
}
