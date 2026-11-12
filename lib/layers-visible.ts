import type { SiteDoc } from "./types";

export const LAYER_ROW_HEIGHT = 28;
export const LAYER_OVERSCAN = 8;

export interface VisibleLayer {
  id: string;
  depth: number;
  /** この要素が、ページの直下にあるか（コンポーネントのマスターではないか）。 */
  isTop: boolean;
}

/**
 * 展開している枝だけを、表示される順に平らに並べる。こうすることで、レイヤーのパネルは
 * ツリー全体を再帰的にマウントせずに、範囲を限った行だけを描画できる。
 * 明示的なスタックを使うため、深い文書でも再帰呼び出しのスタックを使わずに処理できる。
 */
export function visibleLayerRows(
  doc: Pick<SiteDoc, "nodes">,
  rootIds: readonly string[],
  collapsed: ReadonlySet<string>,
  rootDepth: number,
  rootsArePageChildren: boolean,
): VisibleLayer[] {
  const pending: VisibleLayer[] = [];
  for (let i = rootIds.length - 1; i >= 0; i--) {
    pending.push({ id: rootIds[i], depth: rootDepth, isTop: rootsArePageChildren });
  }
  const rows: VisibleLayer[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const row = pending.pop()!;
    if (seen.has(row.id)) continue;
    const node = doc.nodes[row.id];
    if (!node) continue;
    seen.add(row.id);
    rows.push(row);
    if (collapsed.has(row.id)) continue;
    for (let i = node.children.length - 1; i >= 0; i--) {
      pending.push({ id: node.children[i], depth: row.depth + 1, isTop: false });
    }
  }
  return rows;
}

/** 行の高さを 28px に固定し、スクロールの高さを保ったまま、表示範囲を O(1) で計算する。 */
export function layerWindow(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = LAYER_OVERSCAN,
): { start: number; end: number } {
  const top = Math.max(0, scrollTop);
  const first = Math.min(count, Math.max(0, Math.floor(top / LAYER_ROW_HEIGHT) - overscan));
  const last = Math.min(count, Math.max(first,
    Math.ceil((top + Math.max(0, viewportHeight)) / LAYER_ROW_HEIGHT) + overscan));
  return { start: first, end: last };
}
