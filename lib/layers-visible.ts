import type { SiteDoc } from "./types";

export const LAYER_ROW_HEIGHT = 28;
export const LAYER_OVERSCAN = 8;

export interface VisibleLayer {
  id: string;
  depth: number;
  /** Whether this element is immediately under a page (not a component master). */
  isTop: boolean;
}

/**
 * Flatten only expanded branches in visual order. The layer panel can then
 * render a bounded window of rows, instead of mounting the whole recursive tree.
 * An explicit stack also handles deep documents without a recursive call stack.
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

/** Fixed 28px rows allow O(1) window calculations while preserving scroll height. */
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
