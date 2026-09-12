/**
 * スクリプトのドロップ先を、位置から探すための索引。
 *
 * ブラウザで差し込み位置を測るのは、1回の操作につき1度だけ。ポインターが動くたびに
 * すべてのブロックを検索してレイアウトを読む代わりに、近くのいくつかの区画だけを調べる。
 * 座標はワークスペースの内容上のピクセル（倍率を適用した後）。
 */
export interface SlotPoint {
  key: string;
  kind: "step" | "head";
  x: number;
  y: number;
  /** Width of the insertion row in workspace pixels (defaults to an anchor point). */
  width?: number;
}

const CELL_X = 120;
const CELL_Y = 64;

export class SlotIndex {
  private cells = new Map<string, Array<SlotPoint & { order: number }>>();

  constructor(slots: SlotPoint[]) {
    slots.forEach((slot, order) => {
      // Wide rows must be discoverable from their right side as well as their left edge.
      // Store each row in the horizontal cells it actually spans, keeping queries local.
      const from = Math.floor(slot.x / CELL_X);
      const to = Math.floor((slot.x + Math.max(0, slot.width ?? 0)) / CELL_X);
      for (let ix = from; ix <= to; ix++) {
        const cell = `${ix},${Math.floor(slot.y / CELL_Y)}`;
        const items = this.cells.get(cell) ?? [];
        items.push({ ...slot, order });
        this.cells.set(cell, items);
      }
    });
  }

  nearest(kind: SlotPoint["kind"], x: number, y: number): string | null {
    const cx = Math.floor(x / CELL_X);
    const cy = Math.floor(y / CELL_Y);
    let best: { key: string; dist: number; order: number } | null = null;

    // 横方向は行全体 + 左右80px、縦方向は差し込み線の上下28pxを受け入れる。
    // 許容幅は区画1つ未満なので、隣接区画だけの検索で足りる。
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (const slot of this.cells.get(`${ix},${iy}`) ?? []) {
          if (slot.kind !== kind) continue;
          const right = slot.x + Math.max(0, slot.width ?? 0);
          const dx = x < slot.x ? x - slot.x : x > right ? x - right : 0;
          const dy = y - slot.y;
          if (Math.abs(dx) > 80 || Math.abs(dy) > 28) continue;
          const dist = Math.hypot(dx, dy * 2);
          if (!best || dist < best.dist || (dist === best.dist && slot.order < best.order)) {
            best = { key: slot.key, dist, order: slot.order };
          }
        }
      }
    }
    return best?.key ?? null;
  }
}
