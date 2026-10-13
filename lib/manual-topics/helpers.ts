import type { EditorState } from "../manual";
import { resolveStyles } from "../style";
import { canContainElements } from "../tags";

/* ---------- 手順が済んだかの判定 ---------- */

export const node = (s: EditorState) => (s.selection ? s.doc.nodes[s.selection] : undefined);

/** 選んでいる要素の、いまの画面幅と状態で効いているスタイル */
export const style = (s: EditorState, prop: string): string | undefined => {
  const n = node(s);
  return n ? resolveStyles(n, s.breakpoint, s.styleState)[prop] : undefined;
};

export const isContainer = (s: EditorState) => {
  const n = node(s);
  return !!n && canContainElements(n);
};

export const hasScript = (s: EditorState, kinds: string[]) => {
  const n = node(s);
  if (!n) return false;
  if (n.link && kinds.some((k) => k === "open-page" || k === "open-url")) return true;
  return !!n.scripts?.some((sc) => sc.steps.some((st) => kinds.includes(st.kind)));
};

export const pageCount = (s: EditorState) => s.doc.pageOrder.length;

