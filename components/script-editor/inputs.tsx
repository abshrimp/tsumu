"use client";

/**
 * ブロックの中の入力欄（文字・変数入り文字・フォームの値）と条件の編集
 */

import { isEnterKey } from "../../lib/keys";
import { Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import { VarInput } from "../controls";
import { dataVarNames, fieldLabel, flattenFields, ITEM_VALUE, scriptInputDoc, varGroupsAt, varNamesAt, varSamplesAt } from "../../lib/data";
import { lookupVar, splitRegexVars } from "../../lib/vars";
import { canPickVariable, localVariableNames, variableChoiceSamples, singleValueReference, type ValueContext } from "../../lib/variable-choice";
import { fieldVarName, isRadioItem } from "../../lib/fields";
import { SELF_TARGET, type FieldContent, type ScriptCond, type ScriptOp } from "../../lib/types";
import { tr, trNodes } from "../../lib/i18n";
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

/** Fixed-increment numeric value or an editable variable reference. */
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
  const variable = typeof value === "string";
  return (
    <span className="se-quantity">
      <select className="se-in se-fixed-select" aria-label={tr("値の指定方法")}
        value={variable ? "variable" : "number"}
        onChange={(e) => onCommit(e.target.value === "variable" ? "" : Math.max(min, 1))}>
        <option value="number">{tr("数値")}</option>
        <option value="variable">{tr("変数")}</option>
      </select>
      {variable ? (
        <TextIn vars value={value} width={Math.max(100, width + 40)}
          valueContext="value" placeholder={tr("{変数}")}
          onCommit={(v) => {
            const name = v.trim();
            onCommit(name && !name.includes("{") && !name.includes("}") ? `{${name}}` : name);
          }} />
      ) : (
        <TextIn value={String(value)} type="number" width={width}
          numberStep={integer ? 1 : 0.1}
          onCommit={(v) => {
            const n = Number(v);
            if (!v.trim() || !Number.isFinite(n)) return;
            const rounded = integer ? Math.round(n) : n;
            onCommit(Math.max(min, max === undefined ? rounded : Math.min(max, rounded)));
          }} />
      )}
    </span>
  );
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
  const doc = useMemo(() => scriptInputDoc(savedDoc, stepId), [savedDoc, stepId]);
  const nodeId = useContext(ScriptNodeCtx);
  const loops = useContext(LoopCtx);
  // 候補: 配列の要素の項目 + くり返し中の要素の項目 + その位置で使える変数 + スクリプトで作る変数
  const { names, samples, extra } = useMemo(() => {
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
  const { doc: savedDoc, pageId, readOnly } = useContext(Ctx);
  const stepId = useContext(ScriptStepCtx);
  const doc = useMemo(() => scriptInputDoc(savedDoc, stepId), [savedDoc, stepId]);
  const nodeId = useContext(ScriptNodeCtx);
  const loops = useContext(LoopCtx);
  const source = singleValueReference(value);
  const local = localVariableNames([...(itemFields ?? []), ...loops.flatMap((l) => [...l.fields, ...(l.roots ?? [])])]);
  const sample = source ? lookupVar(variableChoiceSamples(varGroupsAt(doc, pageId, nodeId), local), source) : undefined;
  const kind = sample === undefined ? null : sample === null ? "null" : Array.isArray(sample) ? tr("リスト") :
    typeof sample === "object" ? tr("項目付きデータ") : typeof sample === "boolean" ? "true/false" :
    typeof sample === "number" ? tr("数値") : tr("文字列");
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
  const { doc, tree } = useContext(Ctx);
  const selfId = useContext(ScriptNodeCtx);
  return useMemo(() => {
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
  }, [doc, tree, selfId, target]);
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

/** 正規表現として読めなければ true（{変数} は値が決まるまで分からないため空として確かめる） */
export function regexError(pattern: string): boolean {
  try {
    new RegExp(
      splitRegexVars(pattern)
        .map((p) => (p.var !== undefined ? "" : p.text))
        .join(""),
      "g"
    );
    return false;
  } catch {
    return true;
  }
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

const OPS: { value: ScriptOp; label: string }[] = [
  { value: "eq", label: tr("と同じ") },
  { value: "contains", label: tr("を含む") },
  { value: "starts-with", label: tr("で始まる") },
  { value: "ends-with", label: tr("で終わる") },
  { value: "gt", label: tr("より大きい") },
  { value: "lt", label: tr("より小さい") },
  { value: "in", label: tr("のいずれかと同じ") },
  { value: "empty", label: tr("空") },
];

/** "である / でない" is shared by if conditions and every list filter clause. */
export function NegationSelect({ not, onChange }: {
  not?: boolean;
  onChange: (not: boolean) => void;
}) {
  return (
    <select className="se-in se-fixed-select" aria-label={tr("条件の判定")}
      value={not ? "not" : "is"} onChange={(e) => onChange(e.target.value === "not")}>
      <option value="is">{tr("である")}</option>
      <option value="not">{tr("でない")}</option>
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
      text="{value}{op}{negation}"
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
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ),
        negation: onNotChange && <NegationSelect not={not} onChange={onNotChange} />,
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
