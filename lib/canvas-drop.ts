import { collectSubtreeIds, indexParents, type ParentRef } from "./store";
import type { Component, SiteDoc } from "./types";

/** 空白への移動は、描画ルート数ではなく移動先の子要素の末尾に挿入する。 */
export function canvasFallbackDrop(
  doc: SiteDoc,
  editingComp: Component | null | undefined,
  activePageId: string,
): { parent: ParentRef; index: number } {
  const parent: ParentRef = editingComp
    ? { kind: "node", id: editingComp.rootId }
    : { kind: "page", id: activePageId };
  const children = parent.kind === "node"
    ? doc.nodes[parent.id]?.children
    : doc.pages[parent.id]?.children;
  return { parent, index: children?.length ?? 0 };
}

/** The movement gesture is cancelled when its document changes. Build each index on first use. */
export function canvasMoveTargets(doc: SiteDoc, dragIds: readonly string[]) {
  let excluded: Set<string> | undefined;
  let parents: ReturnType<typeof indexParents> | undefined;
  return {
    excludes(id: string) {
      excluded ??= collectSubtreeIds(doc, dragIds);
      return excluded.has(id);
    },
    position(id: string) {
      parents ??= indexParents(doc);
      return parents.get(id);
    },
  };
}
