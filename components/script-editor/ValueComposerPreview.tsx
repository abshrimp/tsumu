"use client";

/**
 * Review-only UI for composing value expressions. Recipes stay in local state,
 * never change SiteDoc, and use sample data only.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { evaluateExpression } from "../../lib/script-model/evaluate";
import {
  composeValueExpression,
  defaultTransform,
  type ValueTransform,
  type ValueTransformKind,
} from "../../lib/script-model/compose";
import { singleValueReference } from "../../lib/variable-choice";
import { PathMenu } from "./fetch";
import { tr } from "../../lib/i18n";

const LABELS: Record<ValueTransformKind, string> = {
  field: "項目を取り出す",
  index: "リストから1件取り出す",
  has: "項目があるか調べる",
  length: "リストの件数を数える",
  format: "文字列に変換する",
  stringify: "JSON文字列に変換する",
  parse: "JSON文字列を読み取る",
  fallback: "値がないとき文字列を使う",
  "fallback-nullish": "値がないかnullなら文字列を使う",
};

const DESCRIPTIONS: Record<ValueTransformKind, string> = {
  field: "項目付きデータから指定した項目の値を取り出します。",
  index: "リストの先頭を0として、指定した位置の値を取り出します。",
  has: "指定した項目が存在するかをtrueまたはfalseで返します。",
  length: "リストにある要素の数を返します。",
  format: "文字・数値・真偽値を文字列にします。リストは変換できません。",
  stringify: "リストや項目付きデータも含め、JSON形式の文字列にします。",
  parse: "JSON形式の文字列を読み取り、データとして使える値にします。",
  fallback: "値が存在しない場合だけ代わりの文字列を使います。nullには適用しません。",
  "fallback-nullish": "値が存在しない場合とnullの場合に、代わりの文字列を使います。",
};

const GROUPS: readonly { label: string; kinds: readonly ValueTransformKind[] }[] = [
  { label: "値を取り出す", kinds: ["field", "index"] },
  { label: "値を調べる", kinds: ["has", "length"] },
  { label: "値を変換する", kinds: ["format", "stringify", "parse"] },
  { label: "値を補う", kinds: ["fallback", "fallback-nullish"] },
];

interface Row {
  readonly id: number;
  readonly transform: ValueTransform;
}

function short(text: string, max = 120): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
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

function describeResult(result: ReturnType<typeof evaluateExpression> | null): string {
  if (!result) return tr("元の値を選択してください");
  if (result.kind === "value") return JSON.stringify(result.value);
  if (result.kind === "missing") return tr("値がありません（未取得）");
  if (result.code === "type-mismatch") return tr("値の種類が合わないため、この加工はできません");
  if (result.code === "invalid-json") return tr("JSON文字列の形式が正しくありません");
  return tr("この処理は見本データに適用できません（{code}）", { code: result.code });
}

/**
 * Editable combobox. Its list is portaled outside the scrolling dialog, so
 * options are never clipped by the modal. We close only on a genuine outside
 * pointer/focus event, not on the input's blur before an option click.
 */
function FieldKeyPicker({ value, onChange, options }: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const filtered = (showAll ? options : options.filter((option) =>
    option.toLocaleLowerCase().includes(value.toLocaleLowerCase()))).slice(0, 50);
  const selectedIndex = Math.min(active, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setOpen(false);
        return;
      }
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      const belowSpace = window.innerHeight - rect.bottom - 8;
      const aboveSpace = rect.top - 8;
      const below = belowSpace >= 160 || belowSpace >= aboveSpace;
      const maxHeight = Math.max(64, Math.min(220, (below ? belowSpace : aboveSpace) - 6));
      setPosition({
        position: "fixed",
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        maxHeight,
        zIndex: 560,
        ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
      });
    };
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && (rootRef.current?.contains(target) || menuRef.current?.contains(target));
    const dismissOutside = (event: Event) => {
      if (!isInside(event.target)) setOpen(false);
    };
    const followScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) reposition();
    };
    reposition();
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", followScroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", followScroll, true);
    };
  }, [open]);

  const choose = (key: string) => {
    onChange(key);
    inputRef.current?.focus();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="se-composer-field">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={tr("取り出す項目名")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && filtered.length ? listId + "-" + selectedIndex : undefined}
        value={value}
        placeholder={tr("項目名")}
        onFocus={() => { setOpen(true); setShowAll(true); setActive(0); }}
        onChange={(event) => {
          onChange(event.target.value);
          setShowAll(false);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { setShowAll(true); setOpen(true); setActive(0); }
            else if (filtered.length) {
              setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
            }
          } else if (event.key === "Enter" && open && filtered.length) {
            event.preventDefault();
            choose(filtered[selectedIndex]);
          }
        }}
      />
      <button
        type="button"
        className="se-composer-field-toggle"
        aria-label={tr("項目の候補を表示")}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open && showAll) setOpen(false);
          else { setShowAll(true); setActive(0); setOpen(true); }
        }}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          className="se-composer-field-menu"
          role="listbox"
          id={listId}
          aria-label={tr("項目の候補")}
          data-se-popover=""
          style={position}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              inputRef.current?.focus();
            }
          }}
        >
          {filtered.length ? filtered.map((key, index) => (
            <button
              key={key}
              id={listId + "-" + index}
              type="button"
              role="option"
              aria-selected={value === key}
              className={index === selectedIndex ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(key)}
            >{key}</button>
          )) : (
            <p className="se-composer-field-empty" role="status">
              {tr(options.length
                ? "一致する候補がありません。項目名を直接入力できます。"
                : "候補がありません。項目名を直接入力できます。")}
            </p>
          )}
        </div>,
        document.body,
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

  const variables = useMemo(() => {
    const selected = sampleAtPath(availableSamples, source);
    const values: Record<string, unknown> = Object.create(null);
    if (source && selected !== undefined) values[source] = selected;
    return values;
  }, [availableSamples, source]);

  const expression = useMemo(() => source
    ? composeValueExpression(source, rows.map((row) => row.transform))
    : null, [source, rows]);
  const result = useMemo(() => expression
    ? evaluateExpression(expression, variables)
    : null, [expression, variables]);

  const progress = useMemo(() => source
    ? rows.map((_, index) => evaluateExpression(composeValueExpression(
      source, rows.slice(0, index + 1).map((row) => row.transform),
    ), variables))
    : [], [source, rows, variables]);

  const suggestedFields = useMemo(() => {
    const suggestions = new Map<number, string[]>();
    if (!source) return suggestions;
    rows.forEach((row, index) => {
      if (row.transform.kind !== "field" && row.transform.kind !== "has") return;
      const before = composeValueExpression(source, rows.slice(0, index).map((item) => item.transform));
      const previous = evaluateExpression(before, variables);
      if (previous.kind === "value" && previous.value &&
        typeof previous.value === "object" && !Array.isArray(previous.value)) {
        suggestions.set(row.id, Object.keys(previous.value));
      }
    });
    return suggestions;
  }, [rows, source, variables]);

  const sourceSample = sampleAtPath(availableSamples, source);
  const sourcePreview = sourceSample === undefined ? tr("値がありません（未取得）") : short(JSON.stringify(sourceSample), 120);
  const display = short(describeResult(result), 500);

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
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.currentTarget === event.target) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
        if (event.key === "Tab") {
          const controls = [...(dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
          ) ?? [])];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <div ref={dialog} className="se-composer" role="dialog" aria-modal="true" aria-label={tr("値を組み立てる")}>
        <header className="se-composer-head">
          <div>
            <h3>{tr("値を組み立てる")}</h3>
            <p className="se-composer-disclaimer">{tr("試作中：見本データで結果を確認するだけです。ここでの加工は保存・実行されません。")}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={tr("閉じる")} onClick={onClose}><X size={17}/></button>
        </header>

        <div className="se-composer-content">
          <div className="se-composer-edit">
            <section className="se-composer-section" aria-label={tr("元の値")}>
              <h4>{tr("1. 元の値")}</h4>
              <p className="se-composer-hint">{tr("加工する変数やデータを選んでください。")}</p>
              <div className="se-composer-source">
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
              </div>
              {!names.length
                ? <span className="se-composer-no-samples">{tr("使える見本データがありません")}</span>
                : <div className="se-composer-source-preview">{tr("元の値の見本")} <code>{sourcePreview}</code></div>}
            </section>

            <section className="se-composer-section" aria-label={tr("加工する順番")}>
              <h4>{tr("2. 加工する順番")}</h4>
              <p className="se-composer-hint">{tr("上から順番に実行します。各手順の結果を確認できます。")}</p>
              <ol className="se-composer-steps">
                {!rows.length && (
                  <li className="se-composer-empty">{tr("加工はまだありません。元の値がそのまま結果になります。")}</li>
                )}
                {rows.map((row, index) => {
                  const operation = row.transform;
                  return (
                    <li key={row.id} className="se-composer-step">
                      <div className="se-composer-step-head">
                        <span className="se-composer-number" aria-hidden="true">{index + 1}</span>
                        <div className="se-composer-step-heading">
                          <strong>{tr(LABELS[operation.kind])}</strong>
                          <p>{tr(DESCRIPTIONS[operation.kind])}</p>
                        </div>
                        <div className="se-composer-step-actions">
                          <button type="button" aria-label={tr("上へ")} title={tr("上へ")}
                            disabled={index === 0} onClick={() => move(row.id, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
                          <button type="button" aria-label={tr("下へ")} title={tr("下へ")}
                            disabled={index === rows.length - 1} onClick={() => move(row.id, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
                          <button type="button" aria-label={tr("削除")} title={tr("削除")}
                            onClick={() => setRows((before) => before.filter((item) => item.id !== row.id))}><Trash2 size={15} aria-hidden="true" /></button>
                        </div>
                      </div>

                      {(operation.kind === "field" || operation.kind === "has") && (
                        <div className="se-composer-step-input">
                          <FieldKeyPicker value={operation.key} options={suggestedFields.get(row.id) ?? []}
                            onChange={(key) => update(row.id, { ...operation, key })} />
                        </div>
                      )}
                      {operation.kind === "index" && (
                        <div className="se-composer-step-input">
                          <input aria-label={tr("取り出す位置")} type="number" min="0" step="1"
                            value={operation.index < 0 ? "" : operation.index}
                            onChange={(event) => update(row.id, {
                              ...operation, index: event.target.value === "" ? -1 : Number(event.target.value),
                            })} />
                        </div>
                      )}
                      {(operation.kind === "fallback" || operation.kind === "fallback-nullish") && (
                        <div className="se-composer-step-input">
                          <input aria-label={tr("値がないときの文字列")} value={operation.text}
                            placeholder={tr("代わりに使う文字列")}
                            onChange={(event) => update(row.id, { ...operation, text: event.target.value })} />
                        </div>
                      )}
                      <div className="se-composer-progress" data-result-kind={progress[index]?.kind ?? "missing"}>
                        <span>{tr("ここまでの結果")}</span>
                        <code>{short(describeResult(progress[index] ?? null))}</code>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <label className="se-composer-add">
                <Plus size={15} aria-hidden="true" />
                <span>{tr("加工を追加")}</span>
                <select aria-label={tr("加工を追加")} value="" onChange={(event) => {
                  const kind = event.target.value as ValueTransformKind;
                  if (kind) add(kind);
                }}>
                  <option value="">{tr("加工を選択してください")}</option>
                  {GROUPS.map((group) => (
                    <optgroup key={group.label} label={tr(group.label)}>
                      {group.kinds.map((kind) => <option key={kind} value={kind}>{tr(LABELS[kind])}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            </section>
          </div>

          <aside className="se-composer-result">
            <h4>{tr("3. 見本の結果")}</h4>
            <p className="se-composer-hint">{tr("選んだ元の値に加工を順番に適用した結果です。")}</p>
            <output aria-live="polite" data-result-kind={result?.kind ?? "missing"}>{display}</output>
            <p className="se-composer-hint">{tr("計算やリストの絞り込みは、まだこの試作では選べません。")}</p>
          </aside>
        </div>

        <footer className="se-composer-foot">
          <span>{tr("元の値やスクリプトは変更されません。")}</span>
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
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
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
