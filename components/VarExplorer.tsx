"use client";

import { isEnterKey } from "../lib/keys";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useEditor } from "../lib/store";
import { fieldLabel, looksLikeImage, scriptInputDoc, varGroupsAt, type VarGroup } from "../lib/data";
import { readableValue } from "./DataView";
import { tr } from "../lib/i18n";
import { canPickVariable, localVariableNames, type ValueContext } from "../lib/variable-choice";

/** Nested list or structured list. */
const isNested = (v: unknown) => v != null && typeof v === "object";

/** The public type system has only Value and List. */
function kindOf(v: unknown, note?: string): string {
  if (v === undefined) return note ? "" : tr("No sample");
  if (Array.isArray(v)) return tr("List · {length} elements", { length: v.length });
  if (v && typeof v === "object") return tr("List · {length} items", "list_length_items_variant_1", { length: Object.keys(v).length });
  return tr("Value");
}

/** 配列の要素は先頭のみを提示し、別の添字は参照式で入力する。 */
function childrenOf(v: unknown): [key: string, label: string, value: unknown][] {
  if (Array.isArray(v)) return v.slice(0, 1).map((x, i) => [String(i), tr("#{p1}", { p1: i + 1 }), x]);
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => [k, k, x]);
  return [];
}

/** 検索用に、すべての位置を平らに並べる（4階層・配列は先頭のみ） */
function flatten(groups: VarGroup[]): { path: string; value: unknown; note?: string }[] {
  const out: { path: string; value: unknown; note?: string }[] = [];
  const walk = (path: string, v: unknown, depth: number, note?: string) => {
    out.push({ path, value: v, note });
    if (depth >= 4 || !isNested(v)) return;
    const kids = Array.isArray(v) ? v.slice(0, 1).map((x, i) => [String(i), x] as const) : Object.entries(v as object);
    for (const [k, x] of kids) walk(`${path}.${k}`, x, depth + 1);
  };
  for (const g of groups) {
    for (const [k, v] of Object.entries(g.vars)) walk(k, v, 0, g.notes?.[k]);
  }
  return out;
}

function Preview({ value, note }: { value: unknown; note?: string }) {
  if (value === undefined) return <span className="vx-note">{note ?? ""}</span>;
  if (looksLikeImage(value)) {
    return (
      <span className="vx-val">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="vx-thumb" src={String(value)} alt="" loading="lazy" />
        {readableValue(value)}
      </span>
    );
  }
  return <span className="vx-val">{readableValue(value)}</span>;
}

function Row({
  label,
  path,
  value,
  note,
  depth,
  onPick,
  context = "value",
}: {
  label: string;
  path: string;
  value: unknown;
  note?: string;
  depth: number;
  onPick: (path: string) => void;
  context?: ValueContext;
}) {
  const nested = isNested(value);
  const pickable = canPickVariable(value, context);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="vx-row"
        role="button"
        tabIndex={0}
        style={{ paddingLeft: 8 + depth * 18 }}
        aria-disabled={!pickable && !nested || undefined}
        onClick={() => pickable ? onPick(path) : nested && setOpen(!open)}
        onKeyDown={(e) => {
          // 開閉ボタンの Enter は、親の変数を選ばずボタン自身に任せる。
          if (e.target !== e.currentTarget) return;
          if (isEnterKey(e)) {
            if (pickable) onPick(path);
            else if (nested) setOpen(!open);
          }
          if (nested && e.key === "ArrowRight") setOpen(true);
          if (nested && e.key === "ArrowLeft") setOpen(false);
        }}
      >
        {nested ? (
          <button
            type="button"
            className={`vx-chev${open ? " is-open" : ""}`}
            aria-label={open ? tr("Close") : tr("Expand", "expand_variant_1")}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          >
            <ChevronRight size={13} />
          </button>
        ) : (
          <span className="vx-chev" />
        )}
        <span className="vx-name">{label}</span>
        {kindOf(value, note) && <span className="vx-kind">{kindOf(value, note)}</span>}
        <Preview value={nested && !open ? value : nested ? undefined : value} note={nested ? "" : note} />
        <span className="vx-tok">{`{${path}}`}</span>
      </div>
      {open &&
        childrenOf(value).map(([k, l, v]) => (
          <Row
            key={k}
            label={l}
            path={`${path}.${k}`}
            value={v}
            depth={depth + 1}
            onPick={onPick}
            context={context}
          />
        ))}
    </>
  );
}

/**
 * 要素の位置で使える変数を、実際の値を見ながら選ぶ画面。
 * 選ぶと {名前} を入れる（入れ子の項目は {名前.項目} になる）
 */
export default function VarExplorer({
  nodeId,
  extraNames,
  localNames,
  sourceStepId,
  context = "value",
  onPick,
  onClose,
}: {
  /** この要素の位置で使える変数を見せる（"" = ページ全体） */
  nodeId: string;
  /** 見本の無い変数（スクリプトで画面上に作る変数など） */
  extraNames?: string[];
  /** 型が不明でも、くり返し中の名前をページの見本より優先する。 */
  localNames?: string[];
  sourceStepId?: string;
  context?: ValueContext;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const extraKey = (extraNames ?? []).join("\n");
  const localKey = (localNames ?? []).join("\n");
  /** 詳細（入力欄の状態など）も出す */
  const [advanced, setAdvanced] = useState(false);
  const allGroups = useMemo(() => {
    const local = localVariableNames(localKey ? localKey.split("\n") : []);
    const roots = new Set(local.map((name) => name.split(".")[0]));
    const at = varGroupsAt(scriptInputDoc(doc, sourceStepId), activePageId, nodeId);
    const itemRoots = new Set(at.filter((g) => g.key === "item").flatMap((g) => Object.keys(g.vars).map((name) => name.split(".")[0])));
    const gs = at.map((g) => ({
      ...g, vars: Object.fromEntries(Object.entries(g.vars).filter(([name]) => {
        const root = name.split(".")[0];
        return !roots.has(root) && (g.key === "item" || !itemRoots.has(root));
      })),
    }));
    if (local.length) gs.unshift({ key: "item", label: tr("Current loop item"), vars: Object.fromEntries(local.map((name) => [name, undefined])) });
    const known = new Set(gs.flatMap((g) => Object.keys(g.vars)));
    const extra = (extraKey ? extraKey.split("\n") : []).filter((n) => !known.has(n) && !roots.has(n.split(".")[0]) && !itemRoots.has(n.split(".")[0]));
    if (extra.length) {
      gs.push({
        key: "script",
        label: tr("Variables set by scripts (their values are set at runtime)"),
        vars: Object.fromEntries(extra.map((n) => [n, undefined])),
        notes: Object.fromEntries(extra.map((n) => [n, tr("Set when the script runs")])),
      });
    }
    return gs;
  }, [doc, activePageId, nodeId, extraKey, localKey, sourceStepId]);
  const hasAdvanced = allGroups.some((g) => g.advanced);
  const groups = useMemo(() => allGroups.filter((g) => advanced || !g.advanced), [allGroups, advanced]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return flatten(groups)
      .filter(({ value }) => canPickVariable(value, context))
      .filter(
        ({ path, value }) =>
          path.toLowerCase().includes(q) ||
          fieldLabel(path).toLowerCase().includes(q) ||
          (value != null && typeof value !== "object" && String(value).toLowerCase().includes(q))
      )
      .slice(0, 100);
  }, [groups, q, context]);

  // 詳細の切り替えやデータの更新で候補が減っても、表示中の候補を選ぶ。
  const activeIndex = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".vx-row.is-key");
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        // ポータルでも React のイベントは親（キャンバス等）へ伝わるため止める
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="modal vx" role="dialog" aria-label={tr("Browse variables")} data-se-popover="">
        <div className="vx-head">
          <h2>{tr("Browse variables")}</h2>
          <button type="button" className="icon-btn" aria-label={tr("Close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="vx-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder={tr("Search by name or value")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!results.length) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = results.length;
                setIndex((activeIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
              } else if (isEnterKey(e)) {
                e.preventDefault();
                onPick(results[activeIndex].path);
              }
            }}
          />
        </label>
        <div className={`vx-body${q ? " is-search" : ""}`} ref={listRef}>
          {!groups.length ? (
            <p className="vx-empty">
              {tr("No variables are available here. Fetch data in the page's \"When the page opens\" script and it will appear here.")}
            </p>
          ) : q ? (
            results.length ? (
              results.map((r, i) => (
                <div
                  key={r.path}
                  className={`vx-row${i === activeIndex ? " is-key" : ""}`}
                  role="button"
                  tabIndex={-1}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => onPick(r.path)}
                >
                  <span className="vx-name">{fieldLabel(r.path)}</span>
                  {kindOf(r.value, r.note) && <span className="vx-kind">{kindOf(r.value, r.note)}</span>}
                  <Preview value={r.value} note={r.note} />
                  <span className="vx-tok">{`{${r.path}}`}</span>
                </div>
              ))
            ) : (
              <p className="vx-empty">{tr("No variables match \"{q}\"", { q: query.trim() })}</p>
            )
          ) : (
            groups.map((g, groupIndex) => (
              <section key={`${g.key}-${groupIndex}`} className="vx-group">
                <h3>{g.label}</h3>
                {Object.entries(g.vars).map(([k, v]) => (
                  <Row
                    key={k}
                    label={k}
                    path={k}
                    value={v}
                    note={g.notes?.[k]}
                    depth={0}
                    onPick={onPick}
                    context={context}
                  />
                ))}
              </section>
            ))
          )}
        </div>
        <div className="vx-foot">
          {context === "value" && <span>{tr("Click to insert. Use the arrow to expand lists.")}</span>}
          {hasAdvanced && (
            <button
              type="button"
              className={`btn btn-sm${advanced ? " is-on" : ""}`}
              aria-pressed={advanced}
              data-tip={tr("Also show field states such as disabled, length and index")}
              onClick={() => setAdvanced((v) => !v)}
            >
              <SlidersHorizontal size={12} />
              {advanced ? tr("Hide advanced") : tr("Show advanced")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
