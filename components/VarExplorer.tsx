"use client";

import { isEnterKey } from "../lib/keys";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useEditor } from "../lib/store";
import { fieldLabel, looksLikeImage, varGroupsAt, type VarGroup } from "../lib/data";
import { readableValue } from "./DataView";
import { tr } from "../lib/i18n";

/** 中を開ける値か（まとまり・まとまりの一覧） */
const isNested = (v: unknown) =>
  v != null &&
  typeof v === "object" &&
  !(Array.isArray(v) && v.every((x) => x == null || typeof x !== "object"));

/** 値の種類（一覧 3件 / 4項目 / 文字 など） */
function kindOf(v: unknown, note?: string): string {
  if (v === undefined) return note ? "" : tr("見本なし");
  if (Array.isArray(v)) return tr("一覧・{length}件", { length: v.length });
  if (v && typeof v === "object") return tr("{length}項目", { length: Object.keys(v).length });
  if (typeof v === "number") return tr("数値");
  if (typeof v === "boolean") return tr("はい／いいえ");
  return "";
}

/** 中の子要素（配列は先頭5件まで） */
function childrenOf(v: unknown): [key: string, label: string, value: unknown][] {
  if (Array.isArray(v)) return v.slice(0, 5).map((x, i) => [String(i), tr("{p1}番目", { p1: i + 1 }), x]);
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => [k, k, x]);
  return [];
}

/** 検索用に、すべての位置を平らに並べる（4階層・配列は先頭3件まで） */
function flatten(groups: VarGroup[]): { path: string; value: unknown; note?: string }[] {
  const out: { path: string; value: unknown; note?: string }[] = [];
  const walk = (path: string, v: unknown, depth: number, note?: string) => {
    out.push({ path, value: v, note });
    if (depth >= 4 || !isNested(v)) return;
    const kids = Array.isArray(v) ? v.slice(0, 3).map((x, i) => [String(i), x] as const) : Object.entries(v as object);
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
}: {
  label: string;
  path: string;
  value: unknown;
  note?: string;
  depth: number;
  onPick: (path: string) => void;
}) {
  const nested = isNested(value);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="vx-row"
        role="button"
        tabIndex={0}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => onPick(path)}
        onKeyDown={(e) => {
          if (isEnterKey(e)) onPick(path);
          if (nested && e.key === "ArrowRight") setOpen(true);
          if (nested && e.key === "ArrowLeft") setOpen(false);
        }}
      >
        {nested ? (
          <button
            type="button"
            className={`vx-chev${open ? " is-open" : ""}`}
            aria-label={open ? tr("閉じる") : tr("中を開く")}
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
  onPick,
  onClose,
}: {
  /** この要素の位置で使える変数を見せる（"" = ページ全体） */
  nodeId: string;
  /** 見本の無い変数（スクリプトで画面上に作る変数など） */
  extraNames?: string[];
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const extraKey = (extraNames ?? []).join("\n");
  /** 詳細（入力欄の状態など）も出す */
  const [advanced, setAdvanced] = useState(false);
  const allGroups = useMemo(() => {
    const gs = varGroupsAt(doc, activePageId, nodeId);
    const known = new Set(gs.flatMap((g) => Object.keys(g.vars)));
    const extra = (extraKey ? extraKey.split("\n") : []).filter((n) => !known.has(n));
    if (extra.length) {
      gs.push({
        key: "script",
        label: tr("スクリプトで作る変数（サイトを動かしたときに値が決まる）"),
        vars: Object.fromEntries(extra.map((n) => [n, undefined])),
        notes: Object.fromEntries(extra.map((n) => [n, tr("動かしたときに値が入ります")])),
      });
    }
    return gs;
  }, [doc, activePageId, nodeId, extraKey]);
  const hasAdvanced = allGroups.some((g) => g.advanced);
  const groups = useMemo(() => allGroups.filter((g) => advanced || !g.advanced), [allGroups, advanced]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return flatten(groups)
      .filter(
        ({ path, value }) =>
          path.toLowerCase().includes(q) ||
          fieldLabel(path).toLowerCase().includes(q) ||
          (value != null && typeof value !== "object" && String(value).toLowerCase().includes(q))
      )
      .slice(0, 100);
  }, [groups, q]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".vx-row.is-key");
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

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
      <div className="modal vx" role="dialog" aria-label={tr("変数を探す")} data-se-popover="">
        <div className="vx-head">
          <h2>{tr("変数を探す")}</h2>
          <button type="button" className="icon-btn" aria-label={tr("閉じる")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="vx-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder={tr("変数名・値で検索")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!results.length) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = results.length;
                setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
              } else if (isEnterKey(e)) {
                e.preventDefault();
                onPick(results[index].path);
              }
            }}
          />
        </label>
        <div className={`vx-body${q ? " is-search" : ""}`} ref={listRef}>
          {!groups.length ? (
            <p className="vx-empty">
              {tr("この要素の位置で使える変数がありません。スクリプトの「ページを開いたとき」でデータを取得すると、ここに表示されます。")}
            </p>
          ) : q ? (
            results.length ? (
              results.map((r, i) => (
                <div
                  key={r.path}
                  className={`vx-row${i === index ? " is-key" : ""}`}
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
              <p className="vx-empty">{tr("「{q}」に一致する変数はありません", { q: query.trim() })}</p>
            )
          ) : (
            groups.map((g) => (
              <section key={g.key} className="vx-group">
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
                  />
                ))}
              </section>
            ))
          )}
        </div>
        <div className="vx-foot">
          <span>{tr("クリックで挿入します。まとまりは左の矢印で中の項目を開けます。")}</span>
          {hasAdvanced && (
            <button
              type="button"
              className={`btn btn-sm${advanced ? " is-on" : ""}`}
              aria-pressed={advanced}
              data-tip={tr("入力欄のチェック・無効・文字数などの状態も出します")}
              onClick={() => setAdvanced((v) => !v)}
            >
              <SlidersHorizontal size={12} />
              {advanced ? tr("詳細を隠す") : tr("詳細を表示")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
