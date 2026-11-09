"use client";

/**
 * ブロックの中の入力欄（文字・変数入り文字・フォームの値）と条件の編集
 */

import { isEnterKey } from "../../lib/keys";
import { Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import { VarInput } from "../controls";
import { dataVarNames, fieldLabel, flattenFields, ITEM_VALUE, scriptInputDoc, varGroupsAt, varNamesAt, varSamplesAt } from "../../lib/data";
import { lookupVar, splitRegexVars } from "../../lib/vars";
import { evaluateValueRecipe } from "../../lib/script-model/recipe-runtime";
import { canPickVariable, localVariableNames, variableChoiceSamples, singleValueReference, type ValueContext } from "../../lib/variable-choice";
import { fieldVarName, isRadioItem } from "../../lib/fields";
import { SELF_TARGET, type FieldContent, type ScriptCond, type ScriptOp } from "../../lib/types";
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
  /** {変数} の候補を出す（「{」を入れなくても出る。「変数を探す」も使える） */
  vars?: boolean;
  /** 候補の先頭に出す、配列の要素の項目名（とその見本） */
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
      style={{ width }}
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

/** Number and {variable} share one input. No type-selection control is needed. */
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
  return <TextIn vars value={String(value)} width={Math.max(width, 100)}
    placeholder={tr("数値 / {変数}")} valueContext="value"
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
  const { doc: savedDoc, pageId, readOnly } = useContext(Ctx);
  const stepId = useContext(ScriptStepCtx);
  // Every input formerly copied and traversed every script on mount.
  // Produce its suggestions only when the user actually focuses it.
  const [active, setActive] = useState(false);
  const doc = useMemo(
    () => active && !readOnly ? scriptInputDoc(savedDoc, stepId) : null,
    [active, readOnly, savedDoc, stepId]
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
    const raw = variableChoiceSamples(varGroupsAt(doc, pageId, nodeId), item);
    // 取得したデータの項目と親のまとまりも、同じスコープの見本から選べるようにする。
    const nested = localVariableNames(flattenFields(raw, 4).map((field) => field.field));
    const available = [...new Set([...at, ...made, ...nested])];
    return {
      names: [...item, ...available.filter((n) => !item.includes(n) && canPickVariable(lookupVar(raw, n), valueContext))],
      samples: {
        ...Object.fromEntries(Object.entries(varSamplesAt(doc, pageId, nodeId)).filter(([name]) => !item.some((n) => n.split(".")[0] === name.split(".")[0]))),
        ...Object.assign({}, ...[...loops].reverse().map((l) => l.samples)),
        ...itemSamples,
      },
      extra: made.filter((n) => !item.includes(n)),
    };
  }, [doc, pageId, nodeId, itemFields, itemSamples, loops, valueContext]);
  if (readOnly) {
    return (
      <span className={`se-in se-in-fake${value ? "" : " is-empty"}`} style={{ width }}>
        {value || placeholder}
      </span>
    );
  }
  return (
    <VarInput
      key={value}
      onActivate={() => setActive(true)}
      onDeactivate={() => setActive(false)}
      value={value}
      className={`se-in${value ? "" : " is-empty"}`}
      style={{ width }}
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

/** 単独参照は値をそのまま渡し、文章は既存の文字列テンプレートとして編集する。 */
export function ValueIn({ value, onCommit, itemFields, itemSamples, width = 150 }: {
  value: string; onCommit: (v: string) => void; itemFields?: string[];
  itemSamples?: Record<string, string>; width?: number;
}) {
  const { readOnly, samples, variableIndex } = useContext(Ctx);
  const stepId = useContext(ScriptStepCtx);
  const loops = useContext(LoopCtx);
  const source = singleValueReference(value);
  // Use the shared preview without materializing a modified document for every
  // input. A local loop or list-item root shadows the page sample completely.
  const produced = variableIndex?.byStep.get(stepId);
  const exclusiveOwnOutput = source && [source, source.split(".")[0]].some((name) =>
    produced?.has(name) && !variableIndex?.hasOther(name, stepId));
  const sourceRoot = source?.split(".")[0];
  const sameRoot = (name: string) => name.split(".")[0] === sourceRoot;
  const locallyShadowed = !!sourceRoot &&
    ((itemFields?.some(sameRoot) ?? false) || loops.some((loop) =>
      loop.fields.some(sameRoot) || (loop.roots?.some(sameRoot) ?? false)));
  const sample = source && !exclusiveOwnOutput && !locallyShadowed
    ? lookupVar(samples, source) : undefined;
  const kind = sample === undefined ? null : sample !== null && typeof sample === "object" ? tr("リスト") : tr("値");
  if (readOnly) return <span className="se-in se-in-fake">{source ? fieldLabel(source) : value}</span>;
  return <span className="se-value-choice">
    <TextIn value={value} onCommit={onCommit} vars valueContext="value" width={width}
      itemFields={itemFields} itemSamples={itemSamples} placeholder={tr("値 / {変数}")} />
    {source && kind && (
      <span className="se-value-info">
        <span className="vx-kind">{kind}</span>
      </span>
    )}
  </span>;
}

/** 対象（ID属性 / きっかけの要素）の入力欄の設定と、選べる値（ラジオは同じIDのボタンの文字） */
function useTargetField(target: string): { kind: FieldContent["kind"]; choices: string[]; bool: boolean } | null {
  const { doc, tree, fieldLookup } = useContext(Ctx);
  const selfId = useContext(ScriptNodeCtx);
  return useMemo(() => {
    if (fieldLookup) {
      if (target !== SELF_TARGET) return fieldLookup.byAttr.get(target) ?? null;
      if (fieldLookup.byNode.has(selfId)) return fieldLookup.byNode.get(selfId) ?? null;
    }
    // Standalone/read-only contexts may not supply the workspace index.
    const nodes = tree.map((r) => doc.nodes[r.id]).filter(Boolean);
    const node =
      target === SELF_TARGET ? doc.nodes[selfId] : target ? nodes.find((n) => n.attrId === target) : undefined;
    const f = node?.type === "field" ? node.field : undefined;
    if (!f) return null;
    // チェックボックス・グループのラジオボタン1つは true / false
    if (f.kind === "checkbox" || isRadioItem(node!)) return { kind: f.kind, choices: [], bool: true };
    if (f.kind === "select") return { kind: f.kind, choices: (f.options ?? []).filter(Boolean), bool: false };
    if (f.kind === "radio") {
      const group = fieldVarName(node!);
      const labels = nodes
        .filter((n) => n.field?.kind === "radio" && group && fieldVarName(n) === group)
        .map((n) => n.field!.label ?? "");
      return { kind: f.kind, choices: [...new Set(labels)].filter(Boolean), bool: false };
    }
    return { kind: f.kind, choices: [], bool: false };
  }, [doc, tree, selfId, target, fieldLookup]);
}

/** 「その他（変数・文字）」を選んだしるし */
const OTHER_VALUE = "\u0000other";

/**
 * 入力欄に入れる・比べる値。チェックボックスは「オン / オフ」、
 * セレクト・ラジオは選択肢から選べる（「その他」で変数・文字も書ける）
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
          { value: "true", label: tr("選んでいる（true）") },
          { value: "false", label: tr("選んでいない（false）") },
        ]
      : [
          { value: "true", label: tr("オン（チェックあり・true）") },
          { value: "false", label: tr("オフ（チェックなし・false）") },
        ]
      : field && (field.kind === "select" || field.kind === "radio") && field.choices.length
        ? field.choices.map((c) => ({ value: c, label: c }))
        : null;
  const boolValue = bool && (value === "true" || value === "false") ? value : null;
  const known = boolValue !== null || !!choices?.some((c) => c.value === value);
  if (!choices || free || (value && !known)) {
    return (
      <TextIn value={value} placeholder={placeholder ?? tr("値 / {変数}")} vars width={width} onCommit={onCommit} />
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
      {!value && <option value="">{tr("選択…")}</option>}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
      <option value={OTHER_VALUE}>{tr("その他（変数・文字列）…")}</option>
    </select>
  );
}

/** Reject malformed or unsafe regex syntax using the same checks as exported runtime. */
export function regexError(pattern: string): boolean {
  // Dynamic variables are unknown until execution, so validate literal parts here.
  const literal = splitRegexVars(pattern)
    .map((part) => part.var !== undefined ? "" : part.text)
    .join("");
  const result = evaluateValueRecipe("", [{
    kind: "replace", find: literal, replacement: "", regex: true,
  }]);
  return result.kind === "error";
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
      {tr("新しいタブ")}
    </label>
  );
}

const COND_SUBJECTS: { value: string; label: string }[] = [
  { value: "value", label: tr("の値が") },
  { value: "checked", label: tr("がチェックされている") },
  { value: "visible", label: tr("が表示されている") },
  { value: "hovered", label: tr("にホバーしている") },
];

export const CONDITION_OPERATORS: readonly { value: ScriptOp; label: string }[] = [
  { value: "eq", label: trc("条件比較", "と同じ") },
  { value: "contains", label: trc("条件比較", "を含む") },
  { value: "starts-with", label: trc("条件比較", "で始まる") },
  { value: "ends-with", label: trc("条件比較", "で終わる") },
  { value: "gt", label: trc("条件比較", "より大きい") },
  { value: "gte", label: trc("条件比較", "以上") },
  { value: "lt", label: trc("条件比較", "より小さい") },
  { value: "lte", label: trc("条件比較", "以下") },
  { value: "in", label: trc("条件比較", "のいずれかと同じ") },
  { value: "empty", label: trc("条件比較", "空") },
  { value: "has-key", label: tr("項目が存在する") },
];

/** "である / でない" is shared by if conditions and every list filter clause. */
export function NegationSelect({ not, onChange, operation }: {
  not?: boolean;
  onChange: (not: boolean) => void;
  operation?: ScriptOp;
}) {
  // Contextual translations let each language choose the appropriate auxiliary verb.
  const context = operation === "contains" || operation === "starts-with" || operation === "ends-with"
    ? "条件の判定・動詞" : "条件の判定";
  return (
    <select className="se-in se-fixed-select" aria-label={tr("条件の判定")}
      value={not ? "not" : "is"} onChange={(e) => onChange(e.target.value === "not")}>
      <option value="is">{trc(context, "である")}</option>
      <option value="not">{trc(context, "でない")}</option>
    </select>
  );
}

/** The editor offers positive operations; the negation selector inverts any of them. */
export function OpEditor({
  op,
  value,
  onChange,
  placeholder = tr("値"),
  target,
  not,
  onNotChange,
}: {
  op: ScriptOp;
  value: string;
  onChange: (op: ScriptOp, value: string) => void;
  placeholder?: string;
  /** 比べる入力欄（あれば、チェックボックス・選択肢に合わせた入力にする） */
  target?: string;
  not?: boolean;
  onNotChange?: (not: boolean) => void;
}) {
  const noValue = op === "empty";
  const pick = target !== undefined && op === "eq";
  return (
    <Phrase
      text={op === "has-key" ? "{value}という{op}{negation}" : "{value}{op}{negation}"}
      parts={{
        value: !noValue &&
          (pick ? (
            <FieldValueIn target={target} value={value} placeholder={placeholder} onCommit={(v) => onChange(op, v)} />
          ) : (
            <TextIn
              value={value}
              placeholder={placeholder}
              width={96}
              vars
              onCommit={(v) => onChange(op, v)}
            />
          )),
        op: (
          <select
            className="se-in"
            value={op}
            onChange={(e) => onChange(e.target.value as ScriptOp, value)}
          >
            {CONDITION_OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ),
        negation: onNotChange && <NegationSelect not={not} onChange={onNotChange} operation={op} />,
      }}
    />
  );
}

export function CondEditor({
  cond,
  onChange,
}: {
  cond: ScriptCond;
  onChange: (c: ScriptCond) => void;
}) {
  const subject = cond.subject;
  const op = cond.op ?? "eq";
  const isVar = cond.subject === "var";
  // 比べるもの: 要素（値・チェック・表示など） / 変数（{変数} と文字を混ぜて書ける）
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
      <option value="el">{tr("要素")}</option>
      <option value="var">{tr("変数")}</option>
    </select>
  );
  if (isVar) {
    return (
      <>
        {kindSelect}
        <Phrase
          text="{left}が{cond}"
          parts={{
            left: (
              <TextIn
                value={cond.left ?? ""}
                placeholder={tr("{変数}")}
                width={96}
                vars
                onCommit={(v) => onChange({ ...cond, left: v })}
              />
            ),
            cond: (
              <OpEditor
                op={op}
                value={cond.value ?? ""}
                placeholder={tr("値 / {変数}")}
                onChange={(o, v) => onChange({ ...cond, op: o, value: v })}
                not={cond.not} onNotChange={(not) => onChange({ ...cond, not })}
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
          onChange={(o, v) => onChange({ ...cond, op: o, value: v })}
          not={cond.not} onNotChange={(not) => onChange({ ...cond, not })}
        />
      )}
      {cond.subject !== "value" && <NegationSelect not={cond.not}
        onChange={(not) => onChange({ ...cond, not })} />}
    </>
  );
}

/* ---------- ブロック ---------- */

/**
 * ブロックの文。{名前} の位置に入力欄などの部品を入れる（言語によって語順が変わるため、
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
