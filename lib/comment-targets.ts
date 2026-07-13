import type { CommentThread } from "./comments";
import type { Breakpoint, SiteDoc } from "./types";
import { isHiddenAt, resolveStyles } from "./style";

export interface CommentTarget {
  kind: "node" | "page" | "deleted-node" | "deleted-page";
  pageId: string;
  hidden: boolean;
}

/** DOMの有無ではなく文書で判定する。画面幅の非表示・未描画を削除と取り違えない。 */
export function commentTargetResolver(doc: SiteDoc, bp: Breakpoint) {
  const locations = new Map<string, { pageId: string; hidden: boolean }>();
  const visit = (id: string, pageId: string, hidden: boolean) => {
    const node = doc.nodes[id];
    if (!node || locations.has(id)) return;
    hidden ||= isHiddenAt(node, bp) || resolveStyles(node, bp, "default").display === "none";
    locations.set(id, { pageId, hidden });
    for (const child of node.children) visit(child, pageId, hidden);
  };
  for (const page of Object.values(doc.pages)) for (const id of page.children) visit(id, page.id, false);
  return (thread: Pick<CommentThread, "pageId" | "nodeId">): CommentTarget => {
    if (thread.nodeId && doc.nodes[thread.nodeId]) {
      const location = locations.get(thread.nodeId);
      return { kind: "node", pageId: location?.pageId ?? thread.pageId, hidden: location?.hidden ?? false };
    }
    if (!doc.pages[thread.pageId]) return { kind: "deleted-page", pageId: thread.pageId, hidden: false };
    return { kind: thread.nodeId ? "deleted-node" : "page", pageId: thread.pageId, hidden: false };
  };
}

export function isDeletedCommentTarget(target: CommentTarget): boolean {
  return target.kind === "deleted-node" || target.kind === "deleted-page";
}
