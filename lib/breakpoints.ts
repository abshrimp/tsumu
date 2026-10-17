import type { Breakpoint, BreakpointDef, SiteDoc } from "./types";
import {
  DEFAULT_BASE_WIDTH,
  DEFAULT_BREAKPOINTS,
  MAX_BREAKPOINTS,
  normalizeBaseWidth,
  normalizeBreakpoints,
} from "./style";
import { tr } from "./i18n";

/** 隣のブレークポイントとの最低限の差（px） */
export const BP_MIN_GAP = 20;

/** ブレークポイントを使っている要素の数（スタイル・デバイス別の非表示） */
export function breakpointUsage(doc: SiteDoc, id: Breakpoint): number {
  let n = 0;
  for (const node of Object.values(doc.nodes)) {
    const s = node.styles[id];
    if ((s && Object.values(s).some((m) => m && Object.keys(m).length)) || node.hiddenOn?.includes(id)) n++;
  }
  for (const page of Object.values(doc.pages)) {
    const s = page.bodyStyles?.[id];
    if (s && Object.values(s).some((m) => m && Object.keys(m).length)) n++;
  }
  return n;
}

/** 既定の設定と同じか */
export function isDefaultBreakpoints(doc: SiteDoc): boolean {
  const list = normalizeBreakpoints(doc.breakpoints);
  return (
    normalizeBaseWidth(doc.baseWidth, list) === DEFAULT_BASE_WIDTH &&
    list.length === DEFAULT_BREAKPOINTS.length &&
    list.every(
      (b, i) =>
        b.id === DEFAULT_BREAKPOINTS[i].id &&
        b.label === DEFAULT_BREAKPOINTS[i].label &&
        b.maxWidth === DEFAULT_BREAKPOINTS[i].maxWidth
    )
  );
}

function save(d: SiteDoc, list: BreakpointDef[]) {
  const next = normalizeBreakpoints(list);
  const same =
    next.length === DEFAULT_BREAKPOINTS.length &&
    next.every(
      (b, i) =>
        b.id === DEFAULT_BREAKPOINTS[i].id &&
        b.label === DEFAULT_BREAKPOINTS[i].label &&
        b.maxWidth === DEFAULT_BREAKPOINTS[i].maxWidth
    );
  d.breakpoints = same ? undefined : next;
}

/** 消したブレークポイントのスタイル・非表示設定を取り除く */
function dropUsage(d: SiteDoc, ids: Set<string>) {
  if (!ids.size) return;
  for (const node of Object.values(d.nodes)) {
    for (const id of ids) delete node.styles[id];
    if (node.hiddenOn) {
      node.hiddenOn = node.hiddenOn.filter((b) => !ids.has(b));
      if (!node.hiddenOn.length) node.hiddenOn = undefined;
    }
  }
  for (const page of Object.values(d.pages)) {
    if (!page.bodyStyles) continue;
    for (const id of ids) delete page.bodyStyles[id];
  }
}

/** 名前・幅を変える（幅は隣のブレークポイントとの間に収める） */
export function updateBreakpoint(
  d: SiteDoc,
  id: Breakpoint,
  patch: { label?: string; maxWidth?: number }
) {
  const list = normalizeBreakpoints(d.breakpoints);
  const i = list.findIndex((b) => b.id === id);
  if (i < 0) return;
  const b = { ...list[i] };
  if (patch.label !== undefined) b.label = patch.label.trim() || b.label;
  if (patch.maxWidth !== undefined) {
    const upper = i > 0 ? list[i - 1].maxWidth - BP_MIN_GAP : normalizeBaseWidth(d.baseWidth, list) - 1;
    const lower = i < list.length - 1 ? list[i + 1].maxWidth + BP_MIN_GAP : 240;
    b.maxWidth = Math.max(lower, Math.min(upper, Math.round(patch.maxWidth)));
  }
  list[i] = b;
  save(d, list);
}

/** パソコン表示の幅を変える */
export function updateBaseWidth(d: SiteDoc, width: number | null) {
  const list = normalizeBreakpoints(d.breakpoints);
  const w = normalizeBaseWidth(width ?? DEFAULT_BASE_WIDTH, list);
  d.baseWidth = w === DEFAULT_BASE_WIDTH ? undefined : w;
}

/**
 * ブレークポイントを足す。いちばん広くあいている幅の間に置き、
 * その幅を受け持っていた大きい側の「非表示」設定を引き継ぐ（見た目が変わらないように）
 */
export function addBreakpoint(d: SiteDoc): Breakpoint | null {
  const list = normalizeBreakpoints(d.breakpoints);
  if (list.length >= MAX_BREAKPOINTS) return null;
  const base = normalizeBaseWidth(d.baseWidth, list);
  const edges = [base, ...list.map((b) => b.maxWidth), 240];
  let best = -1;
  let gap = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const g = edges[i] - edges[i + 1];
    if (g > gap) {
      gap = g;
      best = i;
    }
  }
  if (best < 0 || gap < BP_MIN_GAP * 2) return null;
  const width = Math.round((edges[best] + edges[best + 1]) / 2);
  const id = `bp_${Math.random().toString(36).slice(2, 8)}`;
  let n = list.length + 1;
  const names = new Set(list.map((b) => b.label));
  while (names.has(tr("画面幅{n}", { n }))) n++;
  // 今その幅を受け持っているブレークポイント（足す位置のすぐ上）
  const parent: Breakpoint = best === 0 ? "base" : list[best - 1].id;
  for (const node of Object.values(d.nodes)) {
    if (node.hiddenOn?.includes(parent)) node.hiddenOn = [...node.hiddenOn, id];
  }
  save(d, [...list, { id, label: tr("画面幅{n}", { n }), maxWidth: width }]);
  return id;
}

/** ブレークポイントを消す（そのブレークポイントのスタイルも消える） */
export function removeBreakpoint(d: SiteDoc, id: Breakpoint) {
  const list = normalizeBreakpoints(d.breakpoints);
  save(d, list.filter((b) => b.id !== id));
  // 既定の一覧に戻ったとき（save で undefined）でも、消したIDは使われない
  dropUsage(d, new Set([id]));
}

/** 既定（タブレット / スマホ横向き / スマホ）に戻す。足したブレークポイントのスタイルは消える */
export function resetBreakpoints(d: SiteDoc) {
  const keep = new Set(DEFAULT_BREAKPOINTS.map((b) => b.id));
  const removed = normalizeBreakpoints(d.breakpoints)
    .map((b) => b.id)
    .filter((id) => !keep.has(id));
  d.breakpoints = undefined;
  d.baseWidth = undefined;
  dropUsage(d, new Set(removed));
}

/** 既定に戻したときに消える、足したブレークポイント */
export function addedBreakpoints(doc: SiteDoc): BreakpointDef[] {
  const keep = new Set(DEFAULT_BREAKPOINTS.map((b) => b.id));
  return normalizeBreakpoints(doc.breakpoints).filter((b) => !keep.has(b.id));
}
