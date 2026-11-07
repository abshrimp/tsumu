"use client";

import { useContext } from "react";
import type { ScriptStep } from "../../lib/types";
import { tr } from "../../lib/i18n";
import {
  isValueOperation,
  switchValueOperation,
  VALUE_OPERATION_KINDS,
  type ValueOperationKind,
} from "../../lib/script-value-operations";
import { Ctx } from "./context";

const LABELS: Record<ValueOperationKind, string> = {
  "set-var": "値をそのまま入れる",
  count: "リストの件数を数える",
  join: "リストを文字列につなぐ",
  split: "文字列をリストに分ける",
  "array-find": "リストから1件探す",
  calc: "式を計算する",
  replace: "文字列を置き換える",
};

export function ValueOperationSelect({ step }: { step: ScriptStep }) {
  const { updateStep, readOnly } = useContext(Ctx);
  if (!isValueOperation(step)) return null;
  if (readOnly) return <span className="se-blk-note">{tr(LABELS[step.kind])}</span>;

  return (
    <label className="se-value-operation">
      <span>{tr("値の作り方")}</span>
      <select
        className="se-in se-value-operation-select"
        aria-label={tr("値の作り方")}
        title={tr("操作を変えても変数名は残ります。入力内容は必要に応じて設定し直してください。")}
        value={step.kind}
        onChange={(e) => {
          const target = e.target.value as ValueOperationKind;
          updateStep(step.id, (current) => switchValueOperation(current, target));
        }}
      >
        {VALUE_OPERATION_KINDS.map((kind) => (
          <option key={kind} value={kind}>{tr(LABELS[kind])}</option>
        ))}
      </select>
    </label>
  );
}
