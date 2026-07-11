"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  detectFields,
  fieldLabel,
  looksLikeImage,
} from "../lib/data";
import { tr } from "../lib/i18n";

const isPrimitive = (v: unknown) => v == null || typeof v !== "object";

/** 値を一覧表示用の短い文字にする */
export function readableValue(value: unknown): string {
  if (value == null || value === "") return tr("（空）");
  if (Array.isArray(value)) {
    if (!value.length) return tr("（空）");
    if (value.every(isPrimitive)) return clip(value.map(String).join(", "));
    return tr("{length}件", { length: value.length });
  }
  if (typeof value === "object") {
    return clip(
      Object.entries(value)
        .filter(([, v]) => isPrimitive(v))
        .map(([k, v]) => `${k}: ${v ?? ""}`)
        .join(" / ") || tr("{length}項目", { length: Object.keys(value).length })
    );
  }
  return clip(String(value));
}

const clip = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

function Thumbs({ urls }: { urls: string[] }) {
  return (
    <span className="data-thumbs">
      {urls.slice(0, 3).map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={i} className="data-thumb" src={u} alt="" loading="lazy" />
      ))}
      {urls.length > 3 && <span className="data-more">+{urls.length - 3}</span>}
    </span>
  );
}

function Cell({ value }: { value: unknown }) {
  if (looksLikeImage(value)) return <Thumbs urls={[String(value)]} />;
  if (Array.isArray(value) && value.length && value.every(looksLikeImage)) {
    return <Thumbs urls={value.map(String)} />;
  }
  return <span>{readableValue(value)}</span>;
}

/** 取得したデータを表として見せる。行をクリックするとその1件の中身を全部見られる */
export function DataTable({
  items,
  fields,
  rows = 5,
  basePath = "",
}: {
  items: Record<string, unknown>[];
  fields: string[];
  rows?: number;
  /** 取得したデータの中での位置（行の中身に位置を出すため） */
  basePath?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // 多い一覧は少しずつ出す（「すべて表示」で全件）
  const [limit, setLimit] = useState(rows);
  const shown = items.slice(0, limit);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th aria-label={tr("番号")} />
              {fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((item, i) => (
              <tr
                key={i}
                className={open === i ? "is-open" : ""}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <td className="data-table-num">
                  <ChevronRight size={11} className="data-row-chev" />
                  {i + 1}
                </td>
                {fields.map((f) => (
                  <td key={f}>
                    <Cell value={item[f]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > shown.length && (
        <div className="data-more">
          <span>{tr("{n}件中 {m}件を表示", { n: items.length, m: shown.length })}</span>
          <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + 100)}>
            {tr("さらに100件")}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setLimit(items.length)}>
            {tr("すべて表示")}
          </button>
        </div>
      )}
      {open !== null && shown[open] ? (
        <div className="data-detail">
          <div className="data-detail-head">{tr("{n}件目の中身", { n: open + 1 })}</div>
          <JsonTree value={shown[open]} path={basePath ? `${basePath}.${open}` : String(open)} />
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          {tr("行をクリックすると、配列や入れ子の中身まで確認できます。")}
        </p>
      )}
    </div>
  );
}

const isRecordList = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => x != null && typeof x === "object" && !Array.isArray(x));

/** 中身の種類と数（「一覧 20件」「6項目」） */
function containerMeta(value: unknown): string {
  if (Array.isArray(value)) return tr("一覧・{length}件", { length: value.length });
  return tr("{length}項目", { length: Object.keys(value as object).length });
}

/** 文字・数値などの値 */
function LeafValue({ value }: { value: unknown }) {
  if (value == null || value === "") return <span className="jt-empty">{tr("（空）")}</span>;
  if (typeof value === "number") return <span className="jt-num">{value}</span>;
  if (typeof value === "boolean") return <span className="jt-num">{value ? tr("はい") : tr("いいえ")}</span>;
  if (Array.isArray(value)) {
    // 文字や数値の一覧
    if (value.every(looksLikeImage)) return <Thumbs urls={value.map(String)} />;
    return (
      <span className="jt-chips">
        {value.slice(0, 12).map((v, i) => (
          <span key={i} className="jt-chip">
            {String(v)}
          </span>
        ))}
        {value.length > 12 && <span className="jt-empty">{tr("ほか{n}件", { n: value.length - 12 })}</span>}
      </span>
    );
  }
  const text = String(value);
  return (
    <span className="jt-str" title={text.length > 120 ? text : undefined}>
      {looksLikeImage(value) && <Thumbs urls={[text]} />}
      {text.length > 120 ? `${text.slice(0, 120)}…` : text}
    </span>
  );
}

/** 1つの項目（中身があれば開閉でき、一覧は表とツリーを切り替えられる） */
function JsonNode({
  name,
  value,
  path,
  depth,
}: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
}) {
  const nested =
    value != null &&
    typeof value === "object" &&
    !(Array.isArray(value) && value.every(isPrimitive));
  const [open, setOpen] = useState(depth === 0);
  const [asTable, setAsTable] = useState(true);
  const where = tr("取得したデータの {p1}", { p1: fieldLabel(path) });

  if (!nested) {
    return (
      <div className="jt-row">
        <span className="jt-chev" />
        <span className="jt-key" title={where}>
          {name}
        </span>
        <span className="jt-val">
          <LeafValue value={value} />
        </span>
      </div>
    );
  }
  const list = isRecordList(value);
  return (
    <div className="jt-node">
      <button
        type="button"
        className={`jt-row jt-head${open ? " is-open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronRight size={12} className="jt-chev" />
        <span className="jt-key" title={where}>
          {name}
        </span>
        <span className="jt-meta">{containerMeta(value)}</span>
        {!open && <span className="jt-preview">{readableValue(value)}</span>}
      </button>
      {open && (
        <div className="jt-children">
          {list && (
            <div className="jt-switch" role="group" aria-label={tr("表示の切り替え")}>
              <button
                type="button"
                className={asTable ? "is-on" : ""}
                onClick={() => setAsTable(true)}
              >
                {tr("表")}
              </button>
              <button
                type="button"
                className={asTable ? "" : "is-on"}
                onClick={() => setAsTable(false)}
              >
                {tr("ツリー")}
              </button>
            </div>
          )}
          {list && asTable ? (
            <DataTable
              items={value}
              fields={detectFields(value)}
              rows={100}
              basePath={path}
            />
          ) : (
            <JsonEntries value={value} path={path} depth={depth + 1} />
          )}
        </div>
      )}
    </div>
  );
}

function JsonEntries({ value, path, depth }: { value: unknown; path: string; depth: number }) {
  const [limit, setLimit] = useState(100);
  const total = Array.isArray(value) ? value.length : 0;
  const entries = Array.isArray(value)
    ? value.slice(0, limit).map((v, i) => [String(i), tr("{p1}番目", { p1: i + 1 }), v] as const)
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, k, v] as const);
  if (!entries.length) return <span className="jt-empty">{tr("（空）")}</span>;
  return (
    <>
      {entries.map(([key, label, v]) => (
        <JsonNode
          key={key}
          name={label}
          value={v}
          path={path ? `${path}.${key}` : key}
          depth={depth}
        />
      ))}
      {total > entries.length && (
        <div className="data-more">
          <span>{tr("{n}件中 {m}件を表示", { n: total, m: entries.length })}</span>
          <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + 100)}>
            {tr("さらに100件")}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setLimit(total)}>
            {tr("すべて表示")}
          </button>
        </div>
      )}
    </>
  );
}

/** 入れ子のデータを、開閉できるツリーで見せる（項目名にカーソルを置くと位置が出る） */
export function JsonTree({ value, path = "" }: { value: unknown; path?: string }) {
  if (isPrimitive(value)) return <LeafValue value={value} />;
  return (
    <div className="jt">
      <JsonEntries value={value} path={path} depth={0} />
    </div>
  );
}

/**
 * 取得したデータ全体を見せる。一覧は表（ツリーにも切り替えられる）、
 * それ以外は開閉できるツリー。項目名はスクリプトで選ぶときと同じ
 */
export function JsonPeek({ value }: { value: unknown }) {
  if (isRecordList(value)) {
    return (
      <div className="jt">
        <JsonNode name={tr("取得したデータ")} value={value} path="" depth={0} />
      </div>
    );
  }
  return <JsonTree value={value} />;
}
