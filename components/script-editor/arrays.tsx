"use client";

/**
 * 一覧（配列）を扱うブロック（探す・項目を取り出す・つなげる・並べ替える・絞り込む）
 */

import { useContext, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { readableValue } from "../DataView";
import {
  cleanVarName,
  dataVarNames,
  fieldLabel,
  flattenFields,
  keyOfItem,
  toListItems,
  uniqueVarName,
} from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { type FilterCond, type ScriptStep } from "../../lib/types";
import { tr } from "../../lib/i18n";
import { Ctx, LoopCtx } from "./context";
import { PathMenu, RESERVED_VARS, VarNameIn, nameFromPath } from "./fetch";
import { OpEditor, Phrase, TextIn } from "./inputs";
import { filterNumbersOf } from "./step-tree";

/** 配列を選ぶ */
export function ArraySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // 分解した配列・一覧を入れた変数（リスト要素で選べるものとそろえる）
  const { arrays } = useContext(Ctx);
  const known = !value || arrays.some((a) => a.name === value);
  return (
    <select
      className={`se-in se-in-strong${value ? "" : " is-empty"}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        {arrays.length ? tr("配列を選択") : tr("配列がありません")}
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

/** 変数の見本から、配列の入った位置を探す（「記事.tags」のような入れ子も） */
function arrayPathsIn(samples: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (Array.isArray(v)) {
      out.push(path);
      return;
    }
    if (depth >= 3 || !v || typeof v !== "object") return;
    for (const [k, c] of Object.entries(v)) walk(c, `${path}.${k}`, depth + 1);
  };
  for (const [k, v] of Object.entries(samples)) {
    if (!k.startsWith("#")) walk(v, k, 0);
  }
  return out;
}

/** ほかのブロックで作った変数から1つ選ぶ（書き換えるブロック用） */
export function VarSelect({
  stepId,
  value,
  onChange,
}: {
  stepId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { doc, pageId } = useContext(Ctx);
  const names = [...dataVarNames(doc, pageId, stepId)].filter((n) => !RESERVED_VARS.has(n));
  return (
    <select
      className={`se-in se-in-strong${value ? "" : " is-empty"}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        {names.length ? tr("変数を選択") : tr("変数がありません")}
      </option>
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      {value && !names.includes(value) && <option value={value}>{value}{tr("（見つかりません）")}</option>}
    </select>
  );
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
        {all.length ? tr("配列を選択") : tr("配列がありません")}
      </option>
      {named.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      {nested.length > 0 && (
        <optgroup label={tr("変数の中の配列")}>
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

/** 配列の要素の項目（入れ子は「category.name」のような位置）を、見本から並べる */
export function itemFieldsOf(sample: unknown): string[] {
  const first = toListItems(sample)[0];
  if (!first) return [];
  return flattenFields(first, 2, 1)
    .map((o) => o.field)
    .filter((f) => !/(^|\.)\d+(\.|$)/.test(f));
}

/** 「配列［］の要素のうち、項目［］が［値］のものを変数［］とする」 */
export function ArrayFindBody({ step }: { step: Extract<ScriptStep, { kind: "array-find" }> }) {
  const { doc, pageId, updateStep, samples } = useContext(Ctx);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  const sample = step.array ? lookupVar(samples, step.array) : undefined;
  const fields = itemFieldsOf(sample);
  const found = step.into ? samples[step.into] : undefined;
  return (
    <>
      <Phrase
        text="配列{array}の要素のうち、項目{field}が{value}のものを変数{into}とする"
        parts={{
          array: (
            <AnyArraySelect
              value={step.array}
              onChange={(array) =>
                set({
                  array,
                  ...(!step.into ? { into: uniqueVarName(doc, pageId, nameFromPath(array), step.id) } : {}),
                })
              }
            />
          ),
          field: (
            <select
              className={`se-in${step.field ? "" : " is-empty"}`}
              value={step.field}
              onChange={(e) => set({ field: e.target.value })}
            >
              <option value="" disabled>
                {tr("項目を選択")}
              </option>
              {fields.map((f) => (
                <option key={f} value={f}>
                  {fieldLabel(f)}
                </option>
              ))}
              {step.field && !fields.includes(step.field) && (
                <option value={step.field}>{fieldLabel(step.field)}</option>
              )}
            </select>
          ),
          value: (
            <TextIn
              value={step.value}
              placeholder={tr("値 / {slug}")}
              vars
              width={80}
              onCommit={(v) => set({ value: v })}
            />
          ),
          into: <VarNameIn stepId={step.id} value={step.into} />,
        }}
      />
      {step.into && found !== undefined && (
        <span className="se-blk-note">
          {found == null
            ? tr("見本では一致する要素がありません")
            : tr("要素では {{into}.項目名} のように使えます", { into: step.into })}
        </span>
      )}
    </>
  );
}

/** 「配列［］の［…］を項目［］として格納する」 */
export function ArrayFieldBody({ step }: { step: Extract<ScriptStep, { kind: "array-field" }> }) {
  const { updateStep, samples } = useContext(Ctx);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  // 見本は格納した後の値なので、足した項目は候補から除く
  const sample = step.array ? lookupVar(samples, step.array) : undefined;
  const first = toListItems(sample)[0];
  const { fields, itemSamples } = useMemo(() => {
    const fields = itemFieldsOf(sample).filter((f) => f !== step.field);
    const item = toListItems(sample)[0];
    const itemSamples = Object.fromEntries(
      fields.map((f) => [f, readableValue(item ? keyOfItem(item, f) : undefined)])
    );
    return { fields, itemSamples };
  }, [sample, step.field]);
  const result = first && step.field ? first[step.field] : undefined;
  const inLoop = useContext(LoopCtx).some((l) => l.array && l.array === step.array);
  return (
    <>
      <Phrase
        text="配列{array}の{value}を項目{field}として格納する"
        parts={{
          array: <AnyArraySelect value={step.array} onChange={(array) => set({ array })} />,
          value: (
            <TextIn
              value={step.value}
              placeholder={tr("値 / {項目}")}
              vars
              itemFields={fields}
              itemSamples={itemSamples}
              width={110}
              onCommit={(v) => set({ value: v })}
            />
          ),
          field: (
            <TextIn
              value={step.field}
              placeholder={tr("項目名")}
              width={90}
              onCommit={(v) => set({ field: cleanVarName(v) })}
            />
          ),
        }}
      />
      {inLoop && <span className="se-blk-note">{tr("くり返し中の要素だけに格納します")}</span>}
      {step.field && result !== undefined && (
        <span className="se-blk-note">
          {tr("リストの項目では {{field}} として使えます（見本: {sample}）", {
            field: step.field,
            sample: readableValue(result),
          })}
        </span>
      )}
    </>
  );
}

/** 「配列［］を［、］でつないで変数［］とする」 */
export function JoinBody({ step }: { step: Extract<ScriptStep, { kind: "join" }> }) {
  const { doc, pageId, updateStep, samples } = useContext(Ctx);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  const sample = step.array ? lookupVar(samples, step.array) : undefined;
  const fields = itemFieldsOf(sample);
  const objects = Array.isArray(sample) && sample.some((x) => x && typeof x === "object");
  const result = step.into ? samples[step.into] : undefined;
  const parts = {
    array: (
      <AnyArraySelect
        value={step.array}
        onChange={(array) =>
          set({
            array,
            ...(!step.into
              ? { into: uniqueVarName(doc, pageId, tr("{p1}の文字", { p1: nameFromPath(array) }), step.id) }
              : {}),
          })
        }
      />
    ),
    field: (
      <select
        className={`se-in${step.field ? "" : " is-empty"}`}
        value={step.field ?? ""}
        onChange={(e) => set({ field: e.target.value || undefined })}
      >
        <option value="">{tr("項目を選択")}</option>
        {fields.map((f) => (
          <option key={f} value={f}>
            {fieldLabel(f)}
          </option>
        ))}
        {step.field && !fields.includes(step.field) && (
          <option value={step.field}>{fieldLabel(step.field)}</option>
        )}
      </select>
    ),
    sep: (
      <TextIn
        value={step.sep}
        placeholder={tr("なし")}
        width={40}
        onCommit={(v) => set({ sep: v })}
      />
    ),
    into: <VarNameIn stepId={step.id} value={step.into} />,
  };
  return (
    <>
      {objects || step.field ? (
        <Phrase text="配列{array}の{field}を{sep}でつないで変数{into}とする" parts={parts} />
      ) : (
        <Phrase text="配列{array}を{sep}でつないで変数{into}とする" parts={parts} />
      )}
      {step.into && typeof result === "string" && result && (
        <span className="se-blk-note">{tr("見本:")} {readableValue(result)}</span>
      )}
    </>
  );
}

/**
 * 配列の項目を選ぶ（見本の1件目から。「›」で入れ子の中の項目も選べる）。
 * 文字や数値の配列は、各要素の値が {値} の項目になる
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
  const first = array ? toListItems(lookupVar(samples, array))[0] : undefined;
  return <PathMenu root={first} path={value} mode="field" onChange={onChange} />;
}

export function SortArrayBody({ step }: { step: Extract<ScriptStep, { kind: "sort-array" }> }) {
  const { updateStep } = useContext(Ctx);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  return (
    <Phrase
      text="配列{array}を{field}の{dir}に並べ替える"
      parts={{
        array: <ArraySelect value={step.array} onChange={(array) => set({ array })} />,
        field: <ArrayFieldSelect array={step.array} value={step.field} onChange={(field) => set({ field })} />,
        dir: (
          <select className="se-in" value={step.dir} onChange={(e) => set({ dir: e.target.value })}>
            <option value="asc">{tr("小さい順")}</option>
            <option value="desc">{tr("大きい順")}</option>
          </select>
        ),
      }}
    />
  );
}

/** 解除する絞り込み（すべて / 番号） */
export function UnfilterSelect({ step }: { step: Extract<ScriptStep, { kind: "unfilter-array" }> }) {
  const { updateStep, scripts } = useContext(Ctx);
  const nos = filterNumbersOf(scripts, step.array);
  const value = step.no === undefined ? "all" : String(step.no);
  return (
    <select
      className="se-in"
      value={value}
      onChange={(e) =>
        updateStep(
          step.id,
          (s) =>
            ({ ...s, no: e.target.value === "all" ? undefined : Number(e.target.value) }) as ScriptStep
        )
      }
    >
      <option value="all">{tr("すべての絞り込み")}</option>
      {nos.map((n) => (
        <option key={n} value={n}>
          {tr("絞り込み{n}", { n })}
        </option>
      ))}
      {step.no !== undefined && !nos.includes(step.no) && (
        <option value={step.no}>{tr("絞り込み{n}（見つかりません）", { n: step.no })}</option>
      )}
    </select>
  );
}

export function FilterArrayBody({ step }: { step: Extract<ScriptStep, { kind: "filter-array" }> }) {
  const { updateStep, readOnly, scripts } = useContext(Ctx);
  const others = filterNumbersOf(scripts, step.array).filter((n) => n !== step.no);
  const set = (patch: Record<string, unknown>) =>
    updateStep(step.id, (s) => ({ ...s, ...patch }) as ScriptStep);
  const or = step.or ?? [];
  const setOr = (i: number, patch: Partial<FilterCond>) =>
    set({ or: or.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  // 条件ごとに1行にする（折り返しに任せると、ブロックの幅が全条件を横に並べた長さになる）
  const tail = (
    <>
      <Phrase text="ものに絞り込む" parts={{}} />
      {!readOnly && (
        <>
          <button
            type="button"
            className="se-mini se-mini-text"
            onClick={() => set({ or: [...or, { field: "", op: "eq", value: "", and: true }] })}
          >
            <Plus size={12} />
            {tr("かつ")}
          </button>
          <button
            type="button"
            className="se-mini se-mini-text"
            onClick={() => set({ or: [...or, { field: "", op: "eq", value: "" }] })}
          >
            <Plus size={12} />
            {tr("または")}
          </button>
        </>
      )}
    </>
  );
  return (
    <>
      <span className="se-line">
        <span
          className="se-filter-no"
          data-tip={tr("絞り込みの番号（自動）。「絞り込みを解除する」で番号を選ぶと、この絞り込みだけを外せます")}
        >
          {tr("絞り込み{n}", { n: step.no ?? "?" })}
        </span>
        {(others.length > 0 || step.join === "or") && (
          <select
            className="se-in"
            value={step.join ?? "and"}
            data-tip={tr("同じ配列のほかの絞り込みとのつなぎ方")}
            onChange={(e) => set({ join: e.target.value === "or" ? "or" : undefined })}
          >
            <option value="and">{tr("ほかの絞り込みと「かつ」")}</option>
            <option value="or">{tr("ほかの絞り込みと「または」")}</option>
          </select>
        )}
        <Phrase
          text="配列{array}を{field}が{cond}"
          parts={{
            array: <ArraySelect value={step.array} onChange={(array) => set({ array })} />,
            field: <ArrayFieldSelect array={step.array} value={step.field} onChange={(field) => set({ field })} />,
            cond: (
              <OpEditor
                op={step.op}
                value={step.value}
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
          <span className="se-indent">{c.and ? tr("かつ") : tr("または")}</span>
          <Phrase
            text="{field}が{cond}"
            parts={{
              field: (
                <ArrayFieldSelect array={step.array} value={c.field} onChange={(field) => setOr(i, { field })} />
              ),
              cond: (
                <OpEditor
                  op={c.op}
                  value={c.value}
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
    </>
  );
}
