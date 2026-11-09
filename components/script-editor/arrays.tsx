"use client";

/**
 * リスト表示の操作と変数にあるリストの選択
 */

import { useContext } from "react";
import { Plus, X } from "lucide-react";
import {
  fieldLabel,
  flattenFields,
  firstListItem,
} from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { type FilterCond, type ScriptStep } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { filterNumbersOf } from "./step-tree";
import { Ctx } from "./context";
import { PathMenu } from "./fetch";
import { OpEditor, Phrase } from "./inputs";

/** リストを選ぶ */
export function ArraySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // 分解したリスト・一覧を入れた変数（リスト要素で選べるものとそろえる）
  const { arrays } = useContext(Ctx);
  const known = !value || arrays.some((a) => a.name === value);
  return (
    <select
      className={`se-in se-in-strong${value ? "" : " is-empty"}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        {arrays.length ? tr("リストを選択") : tr("リストがありません")}
      </option>
      {arrays.map((a) => (
        <option key={a.name} value={a.name}>
          {a.name}
        </option>
      ))}
      {!known && <option value={value}>{value}{tr("（見つかりません）")}</option>}
    </select>
  );
}

/** Reuse paths across all selectors in the same document preview. */
const arrayPathCache = new WeakMap<Record<string, unknown>, string[]>();

/** 変数の見本から、リストの入った位置を探す（「記事.tags」のような入れ子も） */
function arrayPathsIn(samples: Record<string, unknown>): string[] {
  const cached = arrayPathCache.get(samples);
  if (cached) return cached;
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 3 || !v || typeof v !== "object" || out.length >= 100) return;
    out.push(path);
    if (depth === 3) return;
    let visited = 0;
    for (const k in v) {
      if (!Object.hasOwn(v, k)) continue;
      if (visited++ >= 50 || out.length >= 100) break;
      const c = (v as Record<string, unknown>)[k];
      if (!k.includes(".") && c && typeof c === "object") walk(c, `${path}.${k}`, depth + 1);
    }
  };
  for (const k in samples) {
    if (out.length >= 100) break;
    if (Object.hasOwn(samples, k) && !k.startsWith("#")) walk(samples[k], k, 0);
  }
  arrayPathCache.set(samples, out);
  return out;
}

export function AnyArraySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { arrays, samples } = useContext(Ctx);
  const named = arrays.map((a) => a.name);
  const nested = arrayPathsIn(samples).filter((p) => !named.includes(p));
  const all = [...named, ...nested];
  return (
    <select
      className={`se-in se-in-strong${value ? "" : " is-empty"}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        {all.length ? tr("リストを選択") : tr("リストがありません")}
      </option>
      {named.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      {nested.length > 0 && (
        <optgroup label={tr("変数の中のリスト")}>
          {nested.map((n) => (
            <option key={n} value={n}>
              {fieldLabel(n)}
            </option>
          ))}
        </optgroup>
      )}
      {value && !all.includes(value) && <option value={value}>{value}{tr("（見つかりません）")}</option>}
    </select>
  );
}

/** リストの要素の項目（入れ子は「category.name」のような位置）を、見本から並べる */
export function itemFieldsOf(sample: unknown): string[] {
  const first = firstListItem(sample);
  if (!first) return [];
  return flattenFields(first, 2, 1)
    .map((o) => o.field)
    .filter((f) => !/(^|\.)\d+(\.|$)/.test(f));
}

/**
 * リストの項目を選ぶ（見本の1件目から。「›」で入れ子の中の項目も選べる）。
 * 文字や数値のリストは、各要素の値が {値} の項目になる
 */
function ArrayFieldSelect({
  array,
  value,
  onChange,
}: {
  array: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { samples } = useContext(Ctx);
  const first = array ? firstListItem(lookupVar(samples, array)) : undefined;
  return <PathMenu root={first} path={value} mode="field" onChange={onChange} />;
}

export function SortArrayBody({ step }: { step: Extract<ScriptStep, { kind: "list-display" }> }) {
  const { updateStep } = useContext(Ctx);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  return (
    <Phrase
      text="リスト{array}を{field}の{dir}に並べ替える"
      parts={{
        array: <ArraySelect value={step.array} onChange={(array) => set({ array })} />,
        field: <ArrayFieldSelect array={step.array} value={step.field} onChange={(field) => set({ field })} />,
        dir: (
          <select className="se-in" value={step.dir} onChange={(e) => set({ dir: e.target.value })}>
            <option value="asc">{tr("昇順")}</option>
            <option value="desc">{tr("降順")}</option>
          </select>
        ),
      }}
    />
  );
}

export function FilterArrayBody({ step }: { step: Extract<ScriptStep, { kind: "list-display" }> }) {
  const { updateStep, readOnly, scripts } = useContext(Ctx);
  const others = filterNumbersOf(scripts, step.array).filter((n) => n !== step.no);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  const or = step.or ?? [];
  const setOr = (i: number, patch: Partial<FilterCond>) =>
    set({ or: or.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  // 条件ごとに1行にする（折り返しに任せると、ブロックの幅が全条件を横に並べた長さになる）
  const tail = <Phrase text="ものに絞り込む" parts={{}} />;
  return (
    <>
      <span className="se-line">
        <span
          className="se-filter-no"
          data-tip={tr("絞り込みの番号（自動）。「絞り込みを解除する」で番号を選ぶと、この絞り込みだけを外せます")}
        >
          {tr("絞り込み{n}", { n: step.no ?? "?" })}
        </span>
        {others.length > 0 && (
          <select
            className="se-in se-fixed-select"
            aria-label={tr("ほかの絞り込みとのつなぎ方")}
            value={step.join ?? "and"}
            disabled={readOnly}
            data-tip={tr("同じリストのほかの絞り込みとのつなぎ方")}
            onChange={(e) => set({ join: e.target.value === "or" ? "or" : undefined })}
          >
            <option value="and">{tr("ほかの絞り込みと「かつ」")}</option>
            <option value="or">{tr("ほかの絞り込みと「または」")}</option>
          </select>
        )}
        <Phrase
          text="リスト{array}を{field}が{cond}"
          parts={{
            array: <ArraySelect value={step.array} onChange={(array) => set({ array })} />,
            field: <ArrayFieldSelect array={step.array} value={step.field} onChange={(field) => set({ field })} />,
            cond: (
              <OpEditor
                op={step.op}
                value={step.value}
                not={step.not}
                onNotChange={(not) => set({ not })}
                placeholder={tr("値 / {変数}")}
                onChange={(op, value) => set({ op, value })}
              />
            ),
          }}
        />
        {!or.length && tail}
      </span>
      {or.map((c, i) => (
        <span key={i} className="se-line">
          <Phrase
            text="{join}{field}が{cond}"
            parts={{
              join: (
                <select
                  className="se-in se-fixed-select"
                  aria-label={tr("条件のつなぎ方")}
                  value={c.and ? "and" : "or"}
                  onChange={(e) => setOr(i, { and: e.target.value === "and" })}
                >
                  <option value="and">{tr("かつ")}</option>
                  <option value="or">{tr("または")}</option>
                </select>
              ),
              field: (
                <ArrayFieldSelect array={step.array} value={c.field} onChange={(field) => setOr(i, { field })} />
              ),
              cond: (
                <OpEditor
                  op={c.op}
                  value={c.value}
                  not={c.not}
                  onNotChange={(not) => setOr(i, { not })}
                  placeholder={tr("値 / {変数}")}
                  onChange={(op, value) => setOr(i, { op, value })}
                />
              ),
            }}
          />
          {!readOnly && (
            <button
              type="button"
              className="se-mini"
              aria-label={tr("この条件を削除")}
              onClick={() => set({ or: or.filter((_, j) => j !== i) })}
            >
              <X size={12} />
            </button>
          )}
          {i === or.length - 1 && tail}
        </span>
      ))}
      {!readOnly && (
        <div className="se-composer-condition-actions">
          <button type="button" className="se-mini se-mini-text"
            onClick={() => set({ or: [...or, { field: "", op: "eq", value: "", and: true }] })}>
            <Plus size={12} />{tr("かつ")}
          </button>
          <button type="button" className="se-mini se-mini-text"
            onClick={() => set({ or: [...or, { field: "", op: "eq", value: "", and: false }] })}>
            <Plus size={12} />{tr("または")}
          </button>
        </div>
      )}
    </>
  );
}
