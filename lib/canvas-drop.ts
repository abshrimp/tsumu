import { collectSubtreeIds, indexParents, type ParentRef } from "./store";
import type { Component, SiteDoc } from "./types";

/** 何もない所への移動では、描画しているルートの数ではなく、移動先の子要素の末尾に挿入する。 */
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

/** 文書が変わると移動の操作は取り消される。それぞれの索引は、最初に使うときに作る。 */
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
