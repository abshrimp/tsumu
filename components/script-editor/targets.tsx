"use client";

/**
 * 動作の対象にする要素の選び方（一覧・キャンバスから選ぶ・ID属性の付与）
 */

import { visitPageNodes } from "../../lib/script";
import { isEnterKey } from "../../lib/keys";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search } from "lucide-react";
import { useEditor } from "../../lib/store";
import { anchoredMenuPos } from "../controls";
import { SELF_TARGET, type SiteDoc } from "../../lib/types";
import { resolveTag } from "../../lib/tags";
import { tr } from "../../lib/i18n";
import { Ctx } from "./context";
import { type Loc } from "./step-tree";

export interface Target {
  id: string;
  name: string;
  field: boolean;
}

/** 動作の対象にできるID属性（ページ内の要素） */
export function collectTargets(doc: SiteDoc, nodeIds: string[]): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const id of nodeIds) {
    const n = doc.nodes[id];
    if (!n?.attrId || seen.has(n.attrId)) continue;
    seen.add(n.attrId);
    out.push({
      id: n.attrId,
      name: n.name,
      field: n.type === "field" && n.field?.kind !== "submit",
    });
  }
  return out;
}

/** 要素選択の階層表示の1行 */
export interface TreeRow {
  id: string;
  depth: number;
  name: string;
  attrId?: string;
  tag: string;
  field: boolean;
  hasChildren: boolean;
}

/** スクリプトの対象要素をツリーの深さとともに表示順に並べる。 */
export function buildTree(doc: SiteDoc, pageId: string, extraRootIds: string[]): TreeRow[] {
  const rows: TreeRow[] = [];
  visitPageNodes(doc, pageId, extraRootIds, (id, node, depth) => {
    const previous = rows[rows.length - 1];
    if (previous && depth > previous.depth) previous.hasChildren = true;
    rows.push({
      id, depth, name: node.name, attrId: node.attrId || undefined,
      tag: resolveTag(node, depth === 0),
      field: node.type === "field" && node.field?.kind !== "submit",
      hasChildren: false,
    });
  });
  return rows;
}

/** 下からたどり、直後に残した行より浅ければ、その祖先として残す。 */
function matchingBranches(rows: readonly TreeRow[], matches: (row: TreeRow) => boolean): Set<string> {
  const keep = new Set<string>();
  let depth = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.depth < depth || matches(row)) {
      keep.add(row.id);
      depth = row.depth;
    }
  }
  return keep;
}

/** A search retains the ancestor path to each match without automatically
 * opening a parent whose own name or ID matched the query.
 * Expanding that parent reveals all of its immediate children, including
 * children which do not contain the search term. */
export function searchNodePickerRows(
  rows: readonly TreeRow[],
  query: string,
  manuallyOpen: ReadonlySet<string>,
  manuallyClosed: ReadonlySet<string>,
): { rows: TreeRow[]; autoOpen: Set<string> } {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return { rows: [...rows], autoOpen: new Set() };
  const matched = new Set(rows.filter((row) =>
    row.name.toLocaleLowerCase().includes(term) ||
    (row.attrId ?? "").toLocaleLowerCase().includes(term)
  ).map((row) => row.id));
  if (!matched.size) return { rows: [], autoOpen: new Set() };

  const relevant = matchingBranches(rows, (row) => matched.has(row.id));
  // 自身も一致した親は、子が一致していても最初は閉じる。
  const autoOpen = new Set([...relevant].filter((id) =>
    !matched.has(id) && !manuallyClosed.has(id)
  ));
  const shown: TreeRow[] = [];
  const stack: { depth: number; visible: boolean; expanded: boolean; allChildren: boolean }[] = [];
  for (const row of rows) {
    while (stack.length && stack[stack.length - 1].depth >= row.depth) stack.pop();
    const parent = stack[stack.length - 1];
    const visible = parent
      ? parent.visible && parent.expanded && (relevant.has(row.id) || parent.allChildren)
      : relevant.has(row.id);
    const expanded = manuallyOpen.has(row.id) || autoOpen.has(row.id);
    stack.push({ depth: row.depth, visible, expanded, allChildren: manuallyOpen.has(row.id) });
    if (visible) shown.push(row);
  }
  return { rows: shown, autoOpen };
}

export type MenuTarget =
  | { type: "step"; loc: Loc }
  | { type: "script"; scriptId: string };

/* ---------- 入力部品 ---------- */

export function TargetSelect({
  value,
  onChange,
  only,
}: {
  value: string;
  onChange: (v: string) => void;
  /** field = 入力欄だけ / control = 入力欄とボタン */
  only?: "field" | "control";
}) {
  const { tree, targets, targetLookup } = useContext(Ctx);
  // Reuse the shared index: thousands of closed target inputs must not each
  // rescan the entire node tree merely to display their current label.
  const firstOfId = targetLookup?.firstNodeIds ?? new Set(
    targets.map((target) => tree.find((row) => row.attrId === target.id)?.id).filter((id): id is string => !!id)
  );
  const pickable = (r: TreeRow) =>
    (!r.attrId || firstOfId.has(r.id)) &&
    (only !== "field" || r.field) &&
    (only !== "control" || r.field || r.tag === "button");
  const cur = targetLookup
    ? targetLookup.firstByAttr.get(value)
    : tree.find((r) => r.attrId === value && firstOfId.has(r.id));
  const known =
    value === "" || (!only && value === SELF_TARGET) ||
    (targetLookup ? targetLookup.firstByAttr.has(value) : targets.some((t) => t.id === value));
  return (
    <NodePicker
      rows={tree}
      pickable={pickable}
      selectedId={cur?.id ?? null}
      special={
        only
          ? []
          : [{ value: SELF_TARGET, label: tr("Triggering element"), on: value === SELF_TARGET }]
      }
      onSpecial={onChange}
      onPick={(r) => onChange(r.attrId ?? assignAttrId(r.id))}
      label={
        value === SELF_TARGET && !only
          ? tr("Triggering element")
          : cur
            ? cur.name
            : value && !known
              ? tr("#{value} (not found)", { value })
              : null
      }
      sub={cur ? `#${cur.attrId}` : undefined}
      placeholder={only ? tr("Select a field", "select_a_field_variant_1") : tr("Select an element")}
      hint={tr("Elements without an ID get one automatically when selected")}
    />
  );
}

/** 要素にID属性を付けて返す（名前から作り、サイト内の他のIDと重ならないようにする） */
function assignAttrId(nodeId: string): string {
  const { doc, updateDoc } = useEditor.getState();
  const node = doc.nodes[nodeId];
  if (!node) return "";
  if (node.attrId) return node.attrId;
  const used = new Set(Object.values(doc.nodes).map((n) => n.attrId).filter(Boolean));
  const ascii = node.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = /^[a-z]/.test(ascii) ? ascii : resolveTag(node, false) || "el";
  let id = stem;
  for (let i = 2; used.has(id); i++) id = `${stem}-${i}`;
  updateDoc((d) => {
    const n = d.nodes[nodeId];
    if (n && !n.attrId) n.attrId = id;
  });
  return id;
}

/**
 * ページの要素を階層で見せて選ぶポップオーバー（検索・キーボード操作つき）。
 * 選べない要素も、構造が分かるよう薄く表示する
 */
export function NodePicker({
  rows,
  pickable,
  selectedId,
  special,
  onSpecial,
  onPick,
  label,
  sub,
  placeholder,
  hint,
  strong,
}: {
  rows: TreeRow[];
  pickable: (r: TreeRow) => boolean;
  selectedId: string | null;
  /** 先頭に出す特別な選択肢（「きっかけの要素」「このページ」など） */
  special: { value: string; label: string; on: boolean }[];
  onSpecial: (v: string) => void;
  onPick: (r: TreeRow) => void;
  /** ボタンに出す名前（null = 未選択） */
  label: string | null;
  sub?: string;
  placeholder: string;
  hint?: string;
  strong?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // Search has its own expansion state. A fresh query always starts with
  // directly matching parents collapsed, unlike a previously browsed tree.
  const [searchOpen, setSearchOpen] = useState<Set<string>>(new Set());
  const [searchClosed, setSearchClosed] = useState<Set<string>>(new Set());
  const [key, setKey] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      target instanceof Node &&
      !menuRef.current?.contains(target) && !btnRef.current?.contains(target);
    const onDown = (e: PointerEvent) => {
      // Capture before script rows (or other React portals) stop propagation.
      // Unlike mousedown, this also covers pen and touch interactions.
      if (outside(e.target)) setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      // Tab to another control should dismiss the popup as well.
      if (outside(e.target)) setOpen(false);
    };
    // A click can trigger programmatic scrolling of the canvas or focused
    // block. Only close for user scrolling outside the menu, not scroll
    // events emitted while a picker is opening.
    const onUserScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("wheel", onUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", onUserScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("wheel", onUserScroll, true);
      window.removeEventListener("touchmove", onUserScroll, true);
    };
  }, [open]);

  // 選べる要素を含む枝だけを残す
  const visible = useMemo(() => {
    if (!open) return [];
    const keep = matchingBranches(rows, pickable);
    return rows.filter((r) => keep.has(r.id));
  }, [open, rows, pickable]);

  const q = query.trim().toLocaleLowerCase();
  const searchView = useMemo(() => open && q
    ? searchNodePickerRows(visible, q, searchOpen, searchClosed)
    : null, [open, visible, q, searchOpen, searchClosed]);
  const shown = useMemo(() => {
    if (!open) return [];
    if (q) return searchView?.rows ?? [];
    // 閉じた枝の中は出さない
    const out: TreeRow[] = [];
    let hideBelow = Infinity;
    for (const r of visible) {
      if (r.depth > hideBelow) continue;
      hideBelow = Infinity;
      out.push(r);
      if (closed.has(r.id)) hideBelow = r.depth;
    }
    return out;
  }, [open, visible, q, closed, searchView]);

  // Search includes structural ancestors in keyboard navigation so the
  // user can expand an otherwise non-pickable branch.
  const choices = useMemo(() => open ? [
    ...(q ? [] : special.map((sp) => ({ kind: "special" as const, sp }))),
    ...(q ? shown : shown.filter(pickable)).map((r) => ({ kind: "row" as const, r })),
  ] : [], [open, q, special, shown, pickable]);
  const keyByRowId = useMemo(() => {
    const index = new Map<string, number>();
    choices.forEach((choice, i) => {
      if (choice.kind === "row") index.set(choice.r.id, i);
    });
    return index;
  }, [choices]);

  useEffect(() => {
    if (!open) return;
    const idx = choices.findIndex((c) =>
      c.kind === "special" ? c.sp.on : c.r.id === selectedId
    );
    setKey(Math.max(0, idx));
    // Only initialize keyboard selection when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    // Scroll only the menu's own list. scrollIntoView() can also scroll the
    // editor page, which the outside-scroll dismissal handler interprets as
    // a reason to close the picker immediately after opening it.
    if (!open) return;
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>(".np-row.is-key");
    if (!list || !current) return;
    const itemBounds = current.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (itemBounds.top < listBounds.top)
      list.scrollTop -= listBounds.top - itemBounds.top;
    else if (itemBounds.bottom > listBounds.bottom)
      list.scrollTop += itemBounds.bottom - listBounds.bottom;
  }, [key, open]);

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos(anchoredMenuPos(r, 300, 360));
    setQuery("");
    setSearchOpen(new Set());
    setSearchClosed(new Set());
    setKey(0);
    setOpen(true);
  };
  const isExpanded = (row: TreeRow) => q
    ? searchOpen.has(row.id) || !!searchView?.autoOpen.has(row.id)
    : !closed.has(row.id);
  const toggleRow = (row: TreeRow) => {
    if (q) {
      const wasOpen = isExpanded(row);
      setSearchOpen((previous) => {
        const next = new Set(previous);
        if (wasOpen) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
      setSearchClosed((previous) => {
        const next = new Set(previous);
        if (wasOpen) next.add(row.id);
        else next.delete(row.id);
        return next;
      });
    } else {
      setClosed((previous) => {
        const next = new Set(previous);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
    }
  };
  const choose = (i: number) => {
    const c = choices[i];
    if (!c) return;
    if (c.kind === "row" && !pickable(c.r)) {
      if (c.r.hasChildren) toggleRow(c.r);
      return;
    }
    setOpen(false);
    if (c.kind === "special") onSpecial(c.sp.value);
    else onPick(c.r);
  };
  const keyOf = (r: TreeRow) => keyByRowId.get(r.id) ?? -1;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`se-in se-pm-btn np-btn${label ? "" : " is-empty"}${open ? " is-open" : ""}${strong ? " se-in-strong" : ""}`}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{label ?? placeholder}</span>
        {sub && <small className="np-sub">{sub}</small>}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="dd-menu se-pm np"
            style={pos}
            data-se-popover=""
            onPointerDown={(e) => e.stopPropagation()}
          >
            <label className="np-search">
              <Search size={12} />
              <input
                autoFocus
                value={query}
                placeholder={tr("Search by name or ID")}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(new Set());
                  setSearchClosed(new Set());
                  setKey(0);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                  const n = choices.length;
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    if (n) setKey((k) => (k + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
                  } else if (isEnterKey(e)) {
                    e.preventDefault();
                    choose(Math.min(key, choices.length - 1));
                  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    const choice = choices[Math.min(key, choices.length - 1)];
                    if (choice?.kind === "row" && choice.r.hasChildren &&
                        isExpanded(choice.r) !== (e.key === "ArrowRight")) {
                      e.preventDefault();
                      toggleRow(choice.r);
                    }
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    btnRef.current?.focus();
                  }
                }}
              />
            </label>
            <div className="np-list" ref={listRef}>
              {!q &&
                special.map((sp, i) => (
                  <button
                    key={sp.value}
                    type="button"
                    className={`dd-item np-row np-special${sp.on ? " is-sel" : ""}${key === i ? " is-key" : ""}`}
                    onMouseEnter={() => setKey(i)}
                    onClick={() => choose(i)}
                  >
                    {sp.label}
                  </button>
                ))}
              {!q && special.length > 0 && shown.length > 0 && <div className="ctx-sep" />}
              {shown.map((r) => {
                const ok = pickable(r);
                const k = keyOf(r);
                const expanded = isExpanded(r);
                return (
                  <div
                    key={r.id}
                    className={`np-row${ok ? "" : " is-struct"}${r.id === selectedId ? " is-sel" : ""}${k >= 0 && k === key ? " is-key" : ""}`}
                    style={{ paddingLeft: 6 + r.depth * 14 }}
                    onMouseEnter={() => k >= 0 && setKey(k)}
                    onClick={() => k >= 0 ? choose(k) : r.hasChildren && toggleRow(r)}
                    data-tip={ok ? (r.attrId ? undefined : hint) : undefined}
                  >
                    {r.hasChildren ? (
                      <button
                        type="button"
                        className={`np-chev${expanded ? " is-open" : ""}`}
                        aria-label={expanded ? tr("Close") : tr("Open")}
                        aria-expanded={expanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(r);
                        }}
                      >
                        <ChevronRight size={11} />
                      </button>
                    ) : (
                      <span className="np-chev" />
                    )}
                    <span className="np-name">{r.name}</span>
                    {r.attrId && <span className="np-id">#{r.attrId}</span>}
                    <span className="np-tag">{r.tag}</span>
                  </div>
                );
              })}
              {!shown.length && (
                <div className="se-pm-none">
                  {q ? tr("No elements match \"{p1}\"", { p1: query.trim() }) : (hint ?? tr("No elements to choose from"))}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
