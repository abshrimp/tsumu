"use client";

/**
 * 動作の対象にする要素の選び方（一覧・キャンバスから選ぶ・ID属性の付与）
 */

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

/** ページの要素を、入れ子の深さ付きで上から順に並べる（nodeIds の範囲だけ） */
export function buildTree(doc: SiteDoc, nodeIds: string[]): TreeRow[] {
  const inSet = new Set(nodeIds);
  const parent = new Map<string, string>();
  for (const id of nodeIds) {
    for (const c of doc.nodes[id]?.children ?? []) if (inSet.has(c)) parent.set(c, id);
  }
  return nodeIds.map((id) => {
    const n = doc.nodes[id];
    let depth = 0;
    for (let p = parent.get(id); p; p = parent.get(p)) depth++;
    return {
      id,
      depth,
      name: n.name,
      attrId: n.attrId || undefined,
      tag: resolveTag(n, depth === 0),
      field: n.type === "field" && n.field?.kind !== "submit",
      hasChildren: (n.children ?? []).some((c) => inSet.has(c)),
    };
  });
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
          : [{ value: SELF_TARGET, label: tr("きっかけの要素"), on: value === SELF_TARGET }]
      }
      onSpecial={onChange}
      onPick={(r) => onChange(r.attrId ?? assignAttrId(r.id))}
      label={
        value === SELF_TARGET && !only
          ? tr("きっかけの要素")
          : cur
            ? cur.name
            : value && !known
              ? tr("#{value}（見つかりません）", { value })
              : null
      }
      sub={cur ? `#${cur.attrId}` : undefined}
      placeholder={only ? tr("入力欄を選択") : tr("要素を選択")}
      hint={tr("IDの無い要素は、選ぶとIDを自動で付けます")}
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
  const [key, setKey] = useState(0);
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    // A click can trigger programmatic scrolling of the canvas or focused
    // block. Only close for user scrolling outside the menu, not scroll
    // events emitted while a picker is opening.
    const onUserScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("wheel", onUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", onUserScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("wheel", onUserScroll, true);
      window.removeEventListener("touchmove", onUserScroll, true);
    };
  }, [open]);

  // 選べる要素を含む枝だけを残す
  const visible = useMemo(() => {
    if (!open) return [];
    const keep = new Set<string>();
    const stack: TreeRow[] = [];
    for (const r of rows) {
      while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
      if (pickable(r)) {
        keep.add(r.id);
        stack.forEach((a) => keep.add(a.id));
      }
      stack.push(r);
    }
    return rows.filter((r) => keep.has(r.id));
  }, [open, rows, pickable]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!open) return [];
    if (q) {
      return visible.filter(
        (r) =>
          pickable(r) &&
          (r.name.toLowerCase().includes(q) || (r.attrId ?? "").toLowerCase().includes(q))
      );
    }
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
  }, [open, visible, q, closed, pickable]);

  const choices = useMemo(() => open ? [
    ...(q ? [] : special.map((sp) => ({ kind: "special" as const, sp }))),
    ...shown.filter(pickable).map((r) => ({ kind: "row" as const, r })),
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
    setKey(0);
    setOpen(true);
  };
  const choose = (i: number) => {
    const c = choices[i];
    if (!c) return;
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
                placeholder={tr("要素名・IDで検索")}
                onChange={(e) => {
                  setQuery(e.target.value);
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
                    choose(key);
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
                const isClosed = closed.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={`np-row${ok ? "" : " is-struct"}${r.id === selectedId ? " is-sel" : ""}${ok && k === key ? " is-key" : ""}`}
                    style={{ paddingLeft: q ? 6 : 6 + r.depth * 14 }}
                    onMouseEnter={() => ok && setKey(k)}
                    onClick={() => ok && choose(k)}
                    data-tip={ok ? (r.attrId ? undefined : hint) : undefined}
                  >
                    {!q && r.hasChildren ? (
                      <button
                        type="button"
                        className={`np-chev${isClosed ? "" : " is-open"}`}
                        aria-label={isClosed ? tr("開く") : tr("閉じる")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setClosed((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          });
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
                  {q ? tr("「{p1}」に一致する要素はありません", { p1: query.trim() }) : (hint ?? tr("選べる要素がありません"))}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
