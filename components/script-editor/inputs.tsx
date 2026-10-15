"use client";

/**
 * ブロックの中の入力欄（文字・変数入りの文字・フォームの値）と、条件の編集
 */

import { isEnterKey } from "../../lib/keys";
import { Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import { VarInput } from "../controls";
import { dataVarNames, flattenFields, ITEM_VALUE, scriptInputDoc, varGroupsAt, varNamesAt, varSamplesAt } from "../../lib/data";
import { lookupVar } from "../../lib/vars";
import { canPickVariable, localVariableNames, variableChoiceSamples, singleValueReference, type ValueContext } from "../../lib/variable-choice";
import { changeIfVariableLeft, ifVariableOperators } from "../../lib/if-variable-conditions";
import { SELF_TARGET, type ScriptCond, type ScriptOp } from "../../lib/types";
import type { FieldTargetInfo } from "./field-index";
import { tr, trc, trNodes } from "../../lib/i18n";
import { Ctx, LoopCtx, ScriptNodeCtx, ScriptStepCtx } from "./context";
import { TargetSelect } from "./targets";

export function TextIn({
  value,
  onCommit,
  placeholder,
  width,
  type = "text",
  vars,
  itemFields,
  itemSamples,
  valueContext = "text",
  numberStep = 0.1,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  width?: number;
  type?: "text" | "number";
  numberStep?: number;
  /** {変数} の候補を表示する（「{」を入れなくても表示する。「変数を探す」も使える） */
  vars?: boolean;
  /** 候補の先頭に表示する、配列の要素の項目名（とその見本） */
  itemFields?: string[];
  itemSamples?: Record<string, string>;
  valueContext?: ValueContext;
}) {
  if (vars && type === "text") {
    return (
      <VarTextIn
        value={value}
        onCommit={onCommit}
        placeholder={placeholder}
        width={width}
        itemFields={itemFields}
        itemSamples={itemSamples}
        valueContext={valueContext}
      />
    );
  }
  return (
    <input
      key={value}
      className={`se-in${value ? "" : " is-empty"}`}
      type={type}
      defaultValue={value}
      placeholder={placeholder}
      style={{ minInlineSize: width }}
      step={type === "number" ? numberStep : undefined}
      min={type === "number" ? 0 : undefined}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** 数値と {変数} を同じ入力欄で扱う。型を選ぶ部品は必要ない。 */
export function NumericVariableIn({
  value, onCommit, integer = false, min = 0, max, width = 60,
}: {
  value: number | string;
  onCommit: (value: number | string) => void;
  integer?: boolean;
  min?: number;
  max?: number;
  width?: number;
}) {
  return <TextIn vars value={String(value)} width={width}
    placeholder={tr("Number / {variable}")} valueContext="value"
    onCommit={(input) => {
      const text = input.trim();
      if (/^\{[^{}\s"'<>]+\}$/.test(text)) { onCommit(text); return; }
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return;
      const number = Number(text);
      if (!Number.isFinite(number) || integer && !Number.isInteger(number) ||
          number < min || max !== undefined && number > max) return;
      onCommit(number);
    }} />;
}

function VarTextIn({
  value,
  onCommit,
  placeholder,
  width,
  itemFields,
  itemSamples,
  valueContext = "text",
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  width?: number;
  itemFields?: string[];
  itemSamples?: Record<string, string>;
  valueContext?: ValueContext;
}) {
  const { doc: savedDoc, pageId } = useContext(Ctx);
  const stepId = useContext(ScriptStepCtx);
  // 使われていない入力欄まで調べないよう、候補はフォーカスがあるときだけ作る。
  const [active, setActive] = useState(false);
  const doc = useMemo(
    () => active ? scriptInputDoc(savedDoc, stepId) : null,
    [active, savedDoc, stepId]
  );
  const nodeId = useContext(ScriptNodeCtx);
  const loops = useContext(LoopCtx);
  // 候補: 配列の要素の項目 + くり返し中の要素の項目 + その位置で使える変数 + スクリプトで作る変数
  const { names, samples, extra } = useMemo(() => {
    if (!doc) return { names: [], samples: {}, extra: [] };
    const at = varNamesAt(doc, pageId, nodeId);
    const made = [...dataVarNames(doc, pageId)].filter(
      (n) => n !== ITEM_VALUE && n !== "slug" && !at.includes(n)
    );
    const item = localVariableNames([...(itemFields ?? []), ...loops.flatMap((l) => [...l.fields, ...(l.roots ?? [])])]);
    const raw = variableChoiceSamples(varGroupsAt(doc, pageId, nodeId).filter((group) => !group.advanced), item);
    // 取得したデータの項目と、その親のまとまりも、同じ範囲の見本から選べるようにする。
    const nested = localVariableNames(flattenFields(raw, 4).map((field) => field.field));
    const available = [...new Set([...at, ...made, ...nested])];
    return {
      names: [...item, ...available.filter((n) => !item.includes(n) && canPickVariable(lookupVar(raw, n), valueContext))],
      samples: {
        ...Object.fromEntries(Object.entries(varSamplesAt(doc, pageId, nodeId)).filter(([name]) => !item.some((n) => n.split(".")[0] === name.split(".")[0]))),
        ...Object.assign({}, ...loops.toReversed().map((l) => l.samples)),
        ...itemSamples,
      },
      extra: made.filter((n) => !item.includes(n)),
    };
  }, [doc, pageId, nodeId, itemFields, itemSamples, loops, valueContext]);
  return (
    <VarInput
      key={value}
      onActivate={() => setActive(true)}
      onDeactivate={() => setActive(false)}
      value={value}
      className={`se-in${value ? "" : " is-empty"}`}
      style={{ minInlineSize: width }}
      placeholder={placeholder}
      names={names}
      samples={samples}
      nodeId={nodeId}
      sourceStepId={stepId}
      extraNames={extra}
      localNames={localVariableNames([...(itemFields ?? []), ...loops.flatMap((l) => [...l.fields, ...(l.roots ?? [])])])}
      valueContext={valueContext}
      eager
      onCommit={(v) => {
        if (v !== value) onCommit(v);
      }}
    />
  );
}

/** 変数だけを参照する場合は値をそのまま渡し、文章の場合は文字列のテンプレートとして編集する。 */
export function ValueIn({ value, onCommit, itemFields, itemSamples, width = 150 }: {
  value: string; onCommit: (v: string) => void; itemFields?: string[];
  itemSamples?: Record<string, string>; width?: number;
}) {
  const { samples, variableIndex } = useContext(Ctx);
  const stepId = useContext(ScriptStepCtx);
  const loops = useContext(LoopCtx);
  const source = singleValueReference(value);
  // 入力欄ごとに書き換えた文書を作らず、共有のプレビューを使う。ループやリストの項目の
  // ルートが手元にある場合は、ページの見本を完全に隠す。
  const produced = variableIndex.byStep.get(stepId);
  const exclusiveOwnOutput = source && [source, source.split(".")[0]].some((name) =>
    produced?.has(name) && !variableIndex.hasOther(name, stepId));
  const sourceRoot = source?.split(".")[0];
  const sameRoot = (name: string) => name.split(".")[0] === sourceRoot;
  const locallyShadowed = !!sourceRoot &&
    ((itemFields?.some(sameRoot) ?? false) || loops.some((loop) =>
      loop.fields.some(sameRoot) || (loop.roots?.some(sameRoot) ?? false)));
  const sample = source && !exclusiveOwnOutput && !locallyShadowed
    ? lookupVar(samples, source) : undefined;
  const kind = sample === undefined ? null : sample !== null && typeof sample === "object" ? tr("List", "list_variant_1") : tr("Value");
  return <span className="se-value-choice">
    <TextIn value={value} onCommit={onCommit} vars valueContext="value" width={width}
      itemFields={itemFields} itemSamples={itemSamples} placeholder={tr("value / {variable}")} />
    {source && kind && (
      <span className="se-value-info">
        <span className="vx-kind">{kind}</span>
      </span>
    )}
  </span>;
}

/** 対象（ID 属性、またはきっかけの要素）の入力欄の設定と、選べる値（ラジオは、同じ ID のボタンの文字） */
function useTargetField(target: string): FieldTargetInfo | null {
  const { fieldLookup } = useContext(Ctx);
  const selfId = useContext(ScriptNodeCtx);
  if (target !== SELF_TARGET) return fieldLookup.byAttr.get(target) ?? null;
  return fieldLookup.byNode.get(selfId) ?? null;
}

/** 「その他（変数・文字）」を選んだことを表す印 */
const OTHER_VALUE = "\u0000other";

/**
 * 入力欄に入れる値、または比べる値。チェックボックスは「オン / オフ」、
 * セレクトとラジオは選択肢から選べる（「その他」で変数や文字も書ける）
 */
export function FieldValueIn({
  target,
  value,
  onCommit,
  placeholder,
  width = 96,
}: {
  target: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  const field = useTargetField(target);
  const [free, setFree] = useState(false);
  const bool = !!field?.bool;
  const choices = bool
    ? field?.kind === "radio"
      ? [
          { value: "true", label: tr("Selected (true)") },
          { value: "false", label: tr("Not selected (false)") },
        ]
      : [
          { value: "true", label: tr("On (checked, true)") },
          { value: "false", label: tr("Off (unchecked, false)") },
        ]
      : field && (field.kind === "select" || field.kind === "radio") && field.choices.length
        ? field.choices.map((c) => ({ value: c, label: c }))
        : null;
  const boolValue = bool && (value === "true" || value === "false") ? value : null;
  const known = boolValue !== null || !!choices?.some((c) => c.value === value);
  if (!choices || free || (value && !known)) {
    return (
      <TextIn value={value} placeholder={placeholder ?? tr("value / {variable}")} vars width={width} onCommit={onCommit} />
    );
  }
  return (
    <select
      className="se-in"
      value={boolValue ?? value ?? ""}
      onChange={(e) => {
        if (e.target.value === OTHER_VALUE) setFree(true);
        else onCommit(e.target.value);
      }}
    >
      {!value && <option value="">{tr("Choose…")}</option>}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
      <option value={OTHER_VALUE}>{tr("Other (variable or text)…")}</option>
    </select>
  );
}

export function NewTabCheck({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="se-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {tr("Open in a new tab")}
    </label>
  );
}

const COND_SUBJECTS: { value: string; label: string }[] = [
  { value: "value", label: tr("'s value") },
  { value: "checked", label: tr("is checked") },
  { value: "visible", label: tr("is visible") },
  { value: "hovered", label: tr("is hovered") },
];

const CONDITION_OPERATORS: readonly { value: ScriptOp; label: string; negated: string }[] = [
  { value: "eq", label: trc("condition_comparison", "equal to"), negated: trc("condition_comparison", "not equal to") },
  { value: "contains", label: trc("condition_comparison", "contain"), negated: trc("condition_comparison", "not contain") },
  { value: "contains-any", label: trc("condition_comparison", "contain any of"), negated: trc("condition_comparison", "contain none of") },
  { value: "starts-with", label: trc("condition_comparison", "start with"), negated: trc("condition_comparison", "not start with") },
  { value: "ends-with", label: trc("condition_comparison", "end with"), negated: trc("condition_comparison", "not end with") },
  { value: "gt", label: trc("condition_comparison", "greater than"), negated: trc("condition_comparison", "not greater than") },
  { value: "gte", label: trc("condition_comparison", "at least"), negated: trc("condition_comparison", "not at least") },
  { value: "lt", label: trc("condition_comparison", "less than"), negated: trc("condition_comparison", "not less than") },
  { value: "lte", label: trc("condition_comparison", "at most"), negated: trc("condition_comparison", "not at most") },
  { value: "in", label: trc("condition_comparison", "one of"), negated: trc("condition_comparison", "not one of") },
  { value: "empty", label: trc("condition_comparison", "empty"), negated: trc("condition_comparison", "not empty") },
  { value: "has-key", label: trc("condition_comparison", "have an item"), negated: trc("condition_comparison", "not have an item") },
];

/** 大小の比較の否定は、逆向きの比較で表せるので一覧には出さない（保存済みのものは表示する）。 */
const ORDER_OPERATORS = new Set<ScriptOp>(["gt", "gte", "lt", "lte"]);

/** 「表示されている / いない」のように、比べる値の無い条件の肯定・否定。 */
function NegationSelect({ not, onChange }: { not?: boolean; onChange: (not: boolean) => void }) {
  return (
    <select className="se-in" aria-label={tr("Condition polarity")}
      value={not ? "not" : "is"} onChange={(e) => onChange(e.target.value === "not")}>
      <option value="is">{trc("condition_check", "is")}</option>
      <option value="not">{trc("condition_check", "is not")}</option>
    </select>
  );
}

/**
 * 比べ方と比べる値。「と同じ」「と同じでない」のように肯定と否定を1つの選択欄にまとめ、
 * 文として続けて読める順（値 → 比べ方）に並べる。
 */
export function OpEditor({
  op,
  value,
  onChange,
  placeholder = tr("Value"),
  target,
  not,
  operators,
  valueContext = "text",
}: {
  op: ScriptOp;
  value: string;
  onChange: (op: ScriptOp, value: string, not: boolean) => void;
  placeholder?: string;
  /** 比べる入力欄（あれば、チェックボックスや選択肢に合わせた入力欄にする） */
  target?: string;
  not?: boolean;
  /** 種類の分かっているリストや項目には、それに合う比較を表示する。保存済みの比較はそのまま残す。 */
  operators?: readonly ScriptOp[];
  /** リスト全体を比べるときは、変数の元の型を保つ。 */
  valueContext?: ValueContext;
}) {
  const noValue = op === "empty";
  const availableOperators = operators
    ? CONDITION_OPERATORS.filter((entry) => operators.includes(entry.value) || entry.value === op)
    : CONDITION_OPERATORS;
  const pick = target !== undefined && op === "eq";
  const current = `${op}${not ? "!" : ""}`;
  return (
    <Phrase
      text={op === "has-key" ? "{op} named {value}" : "{op} {value}"}
      parts={{
        value: !noValue &&
          (pick ? (
            <FieldValueIn target={target} value={value} placeholder={placeholder} onCommit={(v) => onChange(op, v, !!not)} />
          ) : (
            <TextIn
              value={value}
              placeholder={placeholder}
              width={96}
              vars
              valueContext={valueContext}
              onCommit={(v) => onChange(op, v, !!not)}
            />
          )),
        op: (
          <select
            className="se-in"
            aria-label={tr("How to compare")}
            value={current}
            onChange={(e) => {
              const negated = e.target.value.endsWith("!");
              onChange((negated ? e.target.value.slice(0, -1) : e.target.value) as ScriptOp, value, negated);
            }}
          >
            {availableOperators.flatMap((o) => [
              <option key={o.value} value={o.value}>{o.label}</option>,
              ...(!ORDER_OPERATORS.has(o.value) || current === `${o.value}!`
                ? [<option key={`${o.value}!`} value={`${o.value}!`}>{o.negated}</option>] : []),
            ])}
          </select>
        ),
      }}
    />
  );
}

export function CondEditor({
  cond,
  onChange,
  renderPathMenu,
}: {
  cond: ScriptCond;
  onChange: (c: ScriptCond) => void;
  renderPathMenu: (root: Record<string, unknown>, path: string, onPick: (path: string) => void) => ReactNode;
}) {
  const { samples, variableIndex } = useContext(Ctx);
  const variableOptions = useMemo(() => {
    const names = variableIndex.names;
    return Object.fromEntries([
      ...Object.entries(samples).filter(([name]) => !name.startsWith("#")),
      ...names.filter((name) => !Object.hasOwn(samples, name)).map((name) => [name, undefined] as const),
    ]);
  }, [samples, variableIndex]);
  const subject = cond.subject;
  const op = cond.op ?? "eq";
  const isVar = cond.subject === "var";
  // 比較元は単一の変数参照を選び、比較値は文字列と変数を自由に組み合わせられる。
  const kindSelect = (
    <select
      className="se-in"
      value={isVar ? "var" : "el"}
      onChange={(e) =>
        onChange(
          e.target.value === "var"
            ? { subject: "var", target: "", left: "", op, value: cond.value ?? "", ...(cond.not ? { not: true } : {}) }
            : { subject: "value", target: "", op, value: cond.value ?? "", ...(cond.not ? { not: true } : {}) }
        )
      }
    >
      <option value="el">{tr("Element")}</option>
      <option value="var">{tr("Variables")}</option>
    </select>
  );
  if (isVar) {
    return (
      <>
        {kindSelect}
        <Phrase
          text="{left} {cond}"
          parts={{
            left: (
              renderPathMenu(
                variableOptions,
                singleValueReference(cond.left ?? "") ?? "",
                (path) => onChange({
                  ...cond,
                  ...changeIfVariableLeft(cond, path ? `{${path}}` : "", samples),
                }),
              )
            ),
            cond: (
              <OpEditor
                op={op}
                value={cond.value ?? ""}
                operators={ifVariableOperators(cond.left ?? "", samples)}
                valueContext={op === "has-key" ? "text" : "value"}
                placeholder={tr("value / {variable}")}
                not={cond.not}
                onChange={(o, v, not) => onChange({ ...cond, op: o, value: v, not: not || undefined })}
              />
            ),
          }}
        />
      </>
    );
  }
  return (
    <>
      {kindSelect}
      <TargetSelect
        value={cond.target}
        onChange={(v) => onChange({ ...cond, target: v })}
      />
      <select
        className="se-in"
        value={subject}
        onChange={(e) => {
          const subj = e.target.value as ScriptCond["subject"];
          onChange(
            subj === "value"
              ? { subject: subj, target: cond.target, op, value: cond.value ?? "", not: cond.not }
              : { subject: subj, target: cond.target, not: cond.not }
          );
        }}
      >
        {COND_SUBJECTS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {cond.subject === "value" && (
        <OpEditor
          op={op}
          value={cond.value ?? ""}
          target={cond.target}
          not={cond.not}
          onChange={(o, v, not) => onChange({ ...cond, op: o, value: v, not: not || undefined })}
        />
      )}
      {cond.subject !== "value" && <NegationSelect not={cond.not}
        onChange={(not) => onChange({ ...cond, not })} />}
    </>
  );
}

/* ---------- ブロック ---------- */

/**
 * ブロックの文。{名前} の位置に、入力欄などの部品を入れる（言語によって語順が変わるため、
 * 部品の並びは訳文の側で決まる）。文字の部分は <span> になる
 */
export function Phrase({ text, parts }: { text: string; parts: Record<string, ReactNode> }) {
  return (
    <>
      {trNodes(text, parts).map((p, i) =>
        typeof p === "string" ? (
          p.trim() ? <span key={i}>{p.trim()}</span> : null
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </>
  );
}
