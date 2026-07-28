/**
 * Spatial lookup for script drop targets.
 *
 * The browser measures slots once per gesture. Pointer moves only inspect a
 * handful of nearby buckets, instead of querying and laying out every block.
 * Coordinates are workspace-content pixels (after applying zoom).
 */
export interface SlotPoint {
  key: string;
  kind: "step" | "head";
  x: number;
  y: number;
}

const CELL_X = 120;
const CELL_Y = 64;

export class SlotIndex {
  private cells = new Map<string, Array<SlotPoint & { order: number }>>();

  constructor(slots: SlotPoint[]) {
    slots.forEach((slot, order) => {
      const cell = this.cell(slot.x, slot.y);
      const items = this.cells.get(cell) ?? [];
      items.push({ ...slot, order });
      this.cells.set(cell, items);
    });
  }

  private cell(x: number, y: number) {
    return `${Math.floor(x / CELL_X)},${Math.floor(y / CELL_Y)}`;
  }

  nearest(kind: SlotPoint["kind"], x: number, y: number): string | null {
    const cx = Math.floor(x / CELL_X);
    const cy = Math.floor(y / CELL_Y);
    let best: { key: string; dist: number; order: number } | null = null;

    // The 80 x 28 pixel acceptance window cannot reach more than one
    // neighboring cell in either direction.
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (const slot of this.cells.get(`${ix},${iy}`) ?? []) {
          if (slot.kind !== kind) continue;
          const dx = x - slot.x;
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
