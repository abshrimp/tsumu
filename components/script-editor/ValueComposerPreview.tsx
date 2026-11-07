"use client";

/**
 * Review-only UI for composing value expressions.
 * The recipe is held in component state. It never writes to SiteDoc or executes
 * a script. The evaluator runs only against editor sample data.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, Plus, X } from "lucide-react";
import { evaluateExpression } from "../../lib/script-model/evaluate";
import {
  composeValueExpression,
  defaultTransform,
  VALUE_TRANSFORM_KINDS,
  type ValueTransform,
  type ValueTransformKind,
} from "../../lib/script-model/compose";
import { singleValueReference } from "../../lib/variable-choice";
import { PathMenu } from "./fetch";
import { tr } from "../../lib/i18n";

const LABELS: Record<ValueTransformKind, string> = {
  field: "項目を取り出す",
  index: "リストの位置を取り出す",
  length: "リストの件数を数える",
  format: "文字列に変換する",
  stringify: "JSON文字列に変換する",
  parse: "JSON文字列を読み取る",
  fallback: "値がないとき文字列を使う",
};

interface Row {
  readonly id: number;
  readonly transform: ValueTransform;
}

/** Resolve the selected variable or nested sample, without inherited keys. */
function sampleAtPath(samples: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (Object.prototype.hasOwnProperty.call(samples, path)) return samples[path];
  let current: unknown = samples;
  for (const key of path.split(".")) {
    if (Array.isArray(current) && key === "-1") {
      current = current[current.length - 1];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Editable field name with suggestions from the value before this operation. */
function FieldKeyPicker({ value, onChange, options }: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = options.filter((option) => option.toLocaleLowerCase().includes(value.toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const choose = (key: string) => { onChange(key); setOpen(false); };
  return (
    <div ref={ref} className="se-composer-field" onBlurCapture={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    }}>
      <input
        role="combobox"
        aria-label={tr("取り出す項目名")}
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
        aria-controls={listId}
        value={value}
        placeholder={tr("項目名")}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
          else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && filtered.length) {
            e.preventDefault();
            setOpen(true);
            setActive((index) => (index + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
          } else if (e.key === "Enter" && open && filtered.length) {
            e.preventDefault();
            choose(filtered[Math.min(active, filtered.length - 1)]);
          }
        }}
      />
      {options.length > 0 && (
        <button type="button" className="se-composer-field-toggle"
          aria-label={tr("項目の候補を表示")} aria-expanded={open}
          onClick={() => { setActive(0); setOpen((prev) => !prev); }}>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
      {open && filtered.length > 0 && (
        <div className="se-composer-field-menu" role="listbox" id={listId} aria-label={tr("項目の候補")}>
          {filtered.slice(0, 50).map((key, index) => (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={value === key}
              className={index === active ? "is-active" : ""}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(key)}
            >{key}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function RecipeDialog({
  currentValue, samples, excludedName, onClose,
}: {
  currentValue: string;
  samples: Record<string, unknown>;
  excludedName: string;
  onClose: () => void;
}) {
  const availableSamples = useMemo(() => Object.fromEntries(
    Object.entries(samples).filter(([name]) => name && !name.startsWith("#") && name !== excludedName),
  ), [samples, excludedName]);
  const names = Object.keys(availableSamples);
  const [source, setSource] = useState(() => {
    const ref = singleValueReference(currentValue);
    return ref && sampleAtPath(availableSamples, ref) !== undefined ? ref : names[0] ?? "";
  });
  const [rows, setRows] = useState<Row[]>([]);
  const nextId = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const preferred = dialog.current?.querySelector<HTMLElement>('button[aria-label="元の変数を選ぶ"]');
    (preferred ?? dialog.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const expression = useMemo(
    () => source ? composeValueExpression(source, rows.map((row) => row.transform)) : null,
    [source, rows],
  );
  // The selected variable may be nested; evaluate the chosen value only.
  const variables = useMemo(() => {
    const selected = sampleAtPath(availableSamples, source);
    const result: Record<string, unknown> = Object.create(null);
    if (source && selected !== undefined) result[source] = selected;
    return result;
  }, [availableSamples, source]);
  const result = useMemo(
    () => expression ? evaluateExpression(expression, variables) : null,
    [expression, variables],
  );

  const suggestedFields = useMemo(() => {
    const result = new Map<number, string[]>();
    if (!source) return result;
    rows.forEach((row, index) => {
      if (row.transform.kind !== "field") return;
      const prefix = composeValueExpression(source, rows.slice(0, index).map((item) => item.transform));
      const previous = evaluateExpression(prefix, variables);
      if (previous.kind === "value" && previous.value && typeof previous.value === "object" && !Array.isArray(previous.value)) {
        result.set(row.id, Object.keys(previous.value));
      }
    });
    return result;
  }, [rows, source, variables]);

  const preview = result?.kind === "value"
    ? JSON.stringify(result.value)
    : result?.kind === "missing"
      ? tr("値がありません（未取得）")
      : result?.kind === "error"
        ? tr("この処理は見本データに適用できません（{code}）", { code: result.code })
        : tr("元の値を選択してください");
  const display = (preview ?? "").length > 500 ? `${preview!.slice(0, 500)}…` : preview;

  function add(kind: ValueTransformKind) {
    setRows((previous) => [...previous, { id: nextId.current++, transform: defaultTransform(kind) }]);
  }
  function update(id: number, transform: ValueTransform) {
    setRows((previous) => previous.map((row) => row.id === id ? { ...row, transform } : row));
  }
  function move(id: number, distance: -1 | 1) {
    setRows((previous) => {
      const index = previous.findIndex((row) => row.id === id);
      const target = index + distance;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const reordered = [...previous];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  }

  return createPortal(
    <div
      className="se-composer-backdrop"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (e.currentTarget === e.target) onClose(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
          ) ?? [])];
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}
    >
      <div ref={dialog} className="se-composer" role="dialog" aria-modal="true" aria-label={tr("値を組み立てる")}>
        <header className="se-composer-head">
          <h3>{tr("値を組み立てる")}</h3>
          <button type="button" className="icon-btn" aria-label={tr("閉じる")} onClick={onClose}><X size={16}/></button>
        </header>
        <p className="se-composer-disclaimer">{tr("試作中：見本データで結果を確認するだけです。ここでの加工は保存・実行されません。")}</p>
        <div className="se-composer-source">
          <span>{tr("元の値")}</span>
          <PathMenu
            root={availableSamples}
            path={source}
            onChange={setSource}
            mode="any"
            placeholder={tr("変数を選択")}
            ariaLabel={tr("元の変数を選ぶ")}
            allowRoot={false}
            portalZIndex={550}
          />
          {!names.length && <span className="se-composer-no-samples">{tr("使える見本データがありません")}</span>}
        </div>
        <ol className="se-composer-steps" aria-label={tr("加工する順番")}>
          {rows.map((row, index) => {
            const operation = row.transform;
            return (
              <li key={row.id} className="se-composer-step">
                <span className="se-composer-step-label">{tr(LABELS[operation.kind])}</span>
                {operation.kind === "field" && (
                  <FieldKeyPicker value={operation.key} options={suggestedFields.get(row.id) ?? []}
                    onChange={(key) => update(row.id, { ...operation, key })} />
                )}
                {operation.kind === "index" && (
                  <input aria-label={tr("取り出す位置")} type="number" min="0" step="1"
                    value={operation.index}
                    onChange={(e) => update(row.id, { ...operation, index: e.target.value === "" ? -1 : Number(e.target.value) })} />
                )}
                {operation.kind === "fallback" && (
                  <input aria-label={tr("値がないときの文字列")} value={operation.text}
                    onChange={(e) => update(row.id, { ...operation, text: e.target.value })} />
                )}
                <div className="se-composer-step-actions">
                  <button type="button" aria-label={tr("上へ")} title={tr("上へ")} disabled={index === 0} onClick={() => move(row.id, -1)}><ArrowUp size={14} aria-hidden="true" /></button>
                  <button type="button" aria-label={tr("下へ")} title={tr("下へ")} disabled={index === rows.length - 1} onClick={() => move(row.id, 1)}><ArrowDown size={14} aria-hidden="true" /></button>
                  <button type="button" aria-label={tr("削除")} onClick={() => setRows((before) => before.filter((item) => item.id !== row.id))}>{tr("削除")}</button>
                </div>
              </li>
            );
          })}
        </ol>
        <label className="se-composer-add">
          <Plus size={14}/>
          <span>{tr("加工を追加")}</span>
          <select aria-label={tr("加工を追加")} value="" onChange={(e) => {
            const kind = e.target.value as ValueTransformKind;
            if (kind) add(kind);
          }}>
            <option value="">{tr("選択してください")}</option>
            {VALUE_TRANSFORM_KINDS.map((kind) => <option key={kind} value={kind}>{tr(LABELS[kind])}</option>)}
          </select>
        </label>
        <div className="se-composer-result">
          <strong>{tr("見本の結果")}</strong>
          <output aria-live="polite" data-result-kind={result?.kind ?? "missing"}>{display}</output>
        </div>
        <footer className="se-composer-foot">
          <span>{tr("上から順番に加工します。元の値やスクリプトは変更されません。")}</span>
          <button type="button" className="btn" onClick={onClose}>{tr("閉じる")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function ValueComposerPreview({ currentValue, samples, excludedName }: {
  currentValue: string;
  samples: Record<string, unknown>;
  excludedName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="se-mini se-mini-text"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {tr("値を組み立てる")}
      </button>
      {open && (
        <RecipeDialog currentValue={currentValue} samples={samples} excludedName={excludedName}
          onClose={() => setOpen(false)} />
      )}
    </>
  );
}
