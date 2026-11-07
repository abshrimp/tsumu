"use client";

/**
 * Compact, editable value pipeline. Draft changes stay local until Apply;
 * the parent saves a recipe on the actual set-var step.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { evaluateValueRecipe } from "../../lib/script-model/recipe-runtime";
import {
  defaultTransform,
  type ValueTransform,
  type ValueTransformKind,
  type ValueRecipe,
  type CompareOperation,
  type NumericOperation,
  type ValueOperandType,
} from "../../lib/script-model/compose";
import { singleValueReference } from "../../lib/variable-choice";
import { PathMenu } from "./fetch";
import { tr } from "../../lib/i18n";

export const VALUE_TRANSFORM_LABELS: Record<ValueTransformKind, string> = {
  field: "項目を取り出す",
  index: "リストから1件取り出す",
  has: "項目があるか調べる",
  length: "リストの件数を数える",
  format: "文字列に変換する",
  stringify: "JSON文字列に変換する",
  parse: "JSON文字列を読み取る",
  fallback: "値がないとき文字列を使う",
  "fallback-nullish": "値がないかnullなら文字列を使う",
  math: "数値を計算する",
  compare: "値を比較する",
  not: "真偽値を反転する",
  split: "文字列を分割する",
  join: "リストを文字列につなぐ",
  replace: "文字列を置き換える",
  find: "条件に合う1件を探す",
  filter: "条件に合うリストを作る",
  "map-field": "各項目から値を取り出す",
  "map-set": "各項目に値を入れる",
  sort: "リストを並べ替える",
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
  math: "数値に指定した数を足す・引く・掛ける・割るなどを行います。0で割るとエラーになります。",
  compare: "値と指定した値を型を保って比較し、trueまたはfalseを返します。",
  not: "trueをfalseに、falseをtrueに反転します。",
  split: "文字列を指定した区切り文字で分割し、空欄を除いたリストにします。",
  join: "リストの値を指定した区切り文字で連結します。",
  replace: "文字列の一致する部分をすべて置き換えます。正規表現も指定できます。",
  find: "リストから、条件に一致する最初の1件を取得します。見つからなければ値がありません。",
  filter: "リストから、条件に一致した項目だけを残した新しいリストを作ります。",
  "map-field": "リスト内の各データから同じ項目を取り出し、新しいリストにします。",
  "map-set": "各データに項目を追加・上書きし、新しいリストにします。元のデータは変更しません。",
  sort: "項目の値を基準にリストを並べ替えます。元の順番は変更しません。",
};

export const VALUE_TRANSFORM_GROUPS: readonly { label: string; kinds: readonly ValueTransformKind[] }[] = [
  { label: "値を取り出す", kinds: ["field", "index", "find", "map-field"] },
  { label: "値を調べる", kinds: ["has", "length", "compare", "not"] },
  { label: "値を計算・変換する", kinds: ["math", "format", "stringify", "parse", "split", "join", "replace"] },
  { label: "リストを加工する", kinds: ["filter", "map-set", "sort"] },
  { label: "値を補う", kinds: ["fallback", "fallback-nullish"] },
];
const MATH: readonly { value: NumericOperation; label: string }[] = [
  { value: "add", label: "足す" }, { value: "subtract", label: "引く" },
  { value: "multiply", label: "掛ける" }, { value: "divide", label: "割る" },
  { value: "remainder", label: "余り" },
];
const COMPARISONS: readonly { value: CompareOperation; label: string }[] = [
  { value: "eq", label: "等しい" }, { value: "neq", label: "等しくない" },
  { value: "gt", label: "より大きい" }, { value: "gte", label: "以上" },
  { value: "lt", label: "より小さい" }, { value: "lte", label: "以下" },
  { value: "contains", label: "含む" }, { value: "starts-with", label: "から始まる" },
  { value: "ends-with", label: "で終わる" },
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

function describeResult(result: ReturnType<typeof evaluateValueRecipe> | null): string {
  if (!result) return tr("元の値を選択してください");
  if (result.kind === "value") return JSON.stringify(result.value);
  if (result.kind === "missing") return tr("値がありません（未取得）");
  if (result.code === "type-mismatch") return tr("値の種類が合わないため、この加工はできません");
  if (result.code === "invalid-json") return tr("JSON文字列の形式が正しくありません");
  if (result.code === "invalid-literal") return tr("比較する値を正しく入力してください");
  if (result.code === "division-by-zero") return tr("0で割ることはできません");
  if (result.code === "invalid-regex") return tr("正規表現が正しくありません");
  if (result.code === "missing-value") return tr("一部の項目に指定した値がありません");
  if (result.code === "invalid-path") return tr("この項目名は使用できません");
  if (result.code === "limit-exceeded") return tr("データが大きすぎるため加工できません");
  return tr("この処理は見本データに適用できません（{code}）", { code: result.code });
}

/**
 * Editable combobox. Its list is portaled outside the scrolling dialog, so
 * options are never clipped by the modal. We close only on a genuine outside
 * pointer/focus event, not on the input's blur before an option click.
 */
function FieldKeyPicker({ value, onChange, options, ariaLabel, placeholder }: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  ariaLabel?: string;
  placeholder?: string;
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
        aria-label={ariaLabel ?? tr("取り出す項目名")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && filtered.length ? listId + "-" + selectedIndex : undefined}
        value={value}
        maxLength={256}
        placeholder={placeholder ?? tr("項目名")}
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


function ValueOperandEditor({ type, text, onChange }: {
  type: ValueOperandType;
  text: string;
  onChange: (text: string, type: ValueOperandType) => void;
}) {
  return (
    <div className="se-composer-operand">
      <select aria-label={tr("比較する値の種類")} value={type}
        onChange={(e) => {
          const next = e.target.value as ValueOperandType;
          onChange(next === "number" ? "0" : next === "boolean" ? "true" : "", next);
        }}>
        <option value="text">{tr("文字列")}</option>
        <option value="number">{tr("数値")}</option>
        <option value="boolean">{tr("真偽値")}</option>
        <option value="null">null</option>
      </select>
      {type === "boolean" ? (
        <select aria-label={tr("比較する値")} value={text}
          onChange={(e) => onChange(e.target.value, type)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type !== "null" && (
        <input aria-label={tr("比較する値")} type={type === "number" ? "number" : "text"}
          value={text} maxLength={type === "text" ? 4096 : undefined}
          placeholder={type === "text" ? tr("比較する文字列") : "0"}
          onChange={(e) => onChange(e.target.value, type)} />
      )}
    </div>
  );
}

function RecipeStepSettings({ transform, options, onChange }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
}) {
  if (transform.kind === "math") return (
    <div className="se-composer-step-settings">
      <select aria-label={tr("計算方法")} value={transform.operation}
        onChange={(e) => onChange({ ...transform, operation: e.target.value as NumericOperation })}>
        {MATH.map((method) => <option key={method.value} value={method.value}>{tr(method.label)}</option>)}
      </select>
      <input aria-label={tr("計算する数")} type="number" step="any"
        value={Number.isFinite(transform.operand) ? transform.operand : ""}
        onChange={(e) => onChange({ ...transform, operand: e.target.value === "" ? NaN : Number(e.target.value) })} />
    </div>
  );

  if (transform.kind === "split" || transform.kind === "join") return (
    <div className="se-composer-step-settings">
      <input aria-label={tr("区切り文字")} value={transform.separator} maxLength={256}
        placeholder={tr("区切り文字")}
        onChange={(e) => onChange({ ...transform, separator: e.target.value })} />
    </div>
  );

  if (transform.kind === "replace") return (
    <div className="se-composer-step-settings">
      <input aria-label={tr("探す文字列")} value={transform.find} maxLength={256}
        placeholder={tr("探す文字列")}
        onChange={(e) => onChange({ ...transform, find: e.target.value })} />
      <input aria-label={tr("置き換え後")} value={transform.replacement} maxLength={10000}
        placeholder={tr("置き換え後")}
        onChange={(e) => onChange({ ...transform, replacement: e.target.value })} />
      <label className="se-composer-regex">
        <input type="checkbox" checked={transform.regex}
          onChange={(e) => onChange({ ...transform, regex: e.target.checked })} />
        {tr("正規表現")}
      </label>
    </div>
  );

  if (transform.kind === "compare" || transform.kind === "find" || transform.kind === "filter" || transform.kind === "map-set") {
    return (
      <div className="se-composer-step-settings">
        {(transform.kind === "find" || transform.kind === "filter" || transform.kind === "map-set") && (
          <FieldKeyPicker value={transform.field} options={options}
            ariaLabel={tr("リスト内の項目名")} placeholder={transform.kind === "map-set" ? tr("追加する項目") : tr("項目（空なら要素自身）")}
            onChange={(field) => onChange({ ...transform, field })} />
        )}
        {transform.kind !== "map-set" && (
          <select aria-label={tr("比較方法")} value={transform.operation}
            onChange={(e) => onChange({ ...transform, operation: e.target.value as CompareOperation })}>
            {COMPARISONS.map((op) => <option key={op.value} value={op.value}>{tr(op.label)}</option>)}
          </select>
        )}
        <ValueOperandEditor type={transform.operandType} text={transform.operand}
          onChange={(operand, operandType) => onChange({ ...transform, operand, operandType })} />
      </div>
    );
  }

  if (transform.kind === "map-field" || transform.kind === "sort") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.field} options={options}
        ariaLabel={tr("リスト内の項目名")}
        placeholder={transform.kind === "sort" ? tr("項目（空なら要素自身）") : tr("取り出す項目名")}
        onChange={(field) => onChange({ ...transform, field })} />
      {transform.kind === "sort" && (
        <select aria-label={tr("並び順")} value={transform.direction}
          onChange={(e) => onChange({ ...transform, direction: e.target.value as "asc" | "desc" })}>
          <option value="asc">{tr("昇順")}</option>
          <option value="desc">{tr("降順")}</option>
        </select>
      )}
    </div>
  );
  return null;
}


/** Standalone controls for a block on the script canvas, not a modal recipe. */
export function ValueTransformSettings({ transform, options, onChange }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
}) {
  if (transform.kind === "field" || transform.kind === "has") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.key} options={options}
        onChange={(key) => onChange({ ...transform, key })} />
    </div>
  );
  if (transform.kind === "index") return (
    <div className="se-composer-step-settings">
      <input aria-label={tr("取り出す位置")} type="number" min="-1" step="1"
        value={transform.index}
        onChange={(e) => onChange({ ...transform, index: e.target.value === "" ? -1 : Number(e.target.value) })} />
    </div>
  );
  if (transform.kind === "fallback" || transform.kind === "fallback-nullish") return (
    <div className="se-composer-step-settings">
      <input aria-label={tr("値がないときの文字列")} maxLength={10000} value={transform.text}
        onChange={(e) => onChange({ ...transform, text: e.target.value })} />
    </div>
  );
  return <RecipeStepSettings transform={transform} options={options} onChange={onChange} />;
}

function RecipeDialog({
  currentValue, samples, excludedName, initialRecipe, onApply, onClose,
}: {
  currentValue: string;
  samples: Record<string, unknown>;
  excludedName: string;
  initialRecipe?: ValueRecipe;
  onApply: (recipe: ValueRecipe) => void;
  onClose: () => void;
}) {
  const availableSamples = useMemo(() => Object.fromEntries(
    Object.entries(samples).filter(([name]) => name && !name.startsWith("#") && name !== excludedName),
  ), [samples, excludedName]);
  const names = Object.keys(availableSamples);
  const [source, setSource] = useState(() => {
    if (initialRecipe) return initialRecipe.source;
    const ref = singleValueReference(currentValue);
    return ref && sampleAtPath(availableSamples, ref) !== undefined ? ref : names[0] ?? "";
  });
  const [rows, setRows] = useState<Row[]>(() =>
    (initialRecipe?.steps ?? []).map((transform, id) => ({ id, transform })));
  const nextId = useRef(initialRecipe?.steps.length ?? 0);
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

  const result = useMemo(() => source
    ? evaluateValueRecipe(variables[source], rows.map((row) => row.transform))
    : null, [source, rows, variables]);

  const suggestedFields = useMemo(() => {
    const suggestions = new Map<number, string[]>();
    if (!source) return suggestions;
    rows.forEach((row, index) => {
      const kind = row.transform.kind;
      const objectField = kind === "field" || kind === "has";
      const listField = kind === "find" || kind === "filter" || kind === "map-field" ||
        kind === "map-set" || kind === "sort";
      if (!objectField && !listField) return;
      const previous = evaluateValueRecipe(variables[source], rows.slice(0, index).map((item) => item.transform));
      if (previous.kind !== "value") return;
      const candidate = objectField ? previous.value
        : Array.isArray(previous.value) ? previous.value.find((item) =>
            item !== null && typeof item === "object" && !Array.isArray(item)) : undefined;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        suggestions.set(row.id, Object.keys(candidate));
      }
    });
    return suggestions;
  }, [rows, source, variables]);

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
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  const apply = () => {
    if (!source) return;
    onApply({ source, steps: rows.map((row) => row.transform) });
    onClose();
  };
  const invalid = !source || rows.length > 32 || rows.some(({ transform }) => {
    if (transform.kind === "field" || transform.kind === "has") return !transform.key.trim();
    if (transform.kind === "map-field") return !transform.field.trim();
    if (transform.kind === "math") return !Number.isFinite(transform.operand);
    if (transform.kind === "compare" || transform.kind === "find" ||
        transform.kind === "filter" || transform.kind === "map-set") {
      if (transform.kind === "map-set" && (!transform.field.trim() ||
          ["__proto__", "constructor", "prototype"].includes(transform.field))) return true;
      if (transform.operandType === "number") return !transform.operand.trim() ||
        !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(transform.operand.trim()) ||
        !Number.isFinite(Number(transform.operand));
      if (transform.operandType === "boolean") return !["true", "false"].includes(transform.operand);
    }
    return false;
  });

  return createPortal(
    <div
      className="se-composer-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); if (event.currentTarget === event.target) onClose(); }}
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
          <h3>{tr("値を組み立てる")}</h3>
          <button type="button" className="icon-btn" aria-label={tr("閉じる")} onClick={onClose}><X size={16}/></button>
        </header>
        <div className="se-composer-main">
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
          </div>
          {!names.length && <span className="se-composer-no-samples">{tr("使える見本データがありません")}</span>}
          <ol className="se-composer-steps" aria-label={tr("加工する順番")}>
            {rows.map((row, index) => {
              const operation = row.transform;
              return (
                <li key={row.id} className="se-composer-step">
                  <span className="se-composer-number">{index + 1}</span>
                  <span className="se-composer-step-label" title={tr(DESCRIPTIONS[operation.kind])}>{tr(VALUE_TRANSFORM_LABELS[operation.kind])}</span>
                  {(operation.kind === "field" || operation.kind === "has") && (
                    <FieldKeyPicker value={operation.key} options={suggestedFields.get(row.id) ?? []}
                      onChange={(key) => update(row.id, { ...operation, key })} />
                  )}
                  {operation.kind === "index" && (
                    <input aria-label={tr("取り出す位置")} type="number" min="-1" step="1"
                      value={operation.index}
                      onChange={(event) => update(row.id, { ...operation, index: event.target.value === "" ? -1 : Number(event.target.value) })} />
                  )}
                  {(operation.kind === "fallback" || operation.kind === "fallback-nullish") && (
                    <input aria-label={tr("値がないときの文字列")} value={operation.text} maxLength={10000}
                      placeholder={tr("代わりに使う文字列")}
                      onChange={(event) => update(row.id, { ...operation, text: event.target.value })} />
                  )}
                  <div className="se-composer-step-actions">
                    <button type="button" aria-label={tr("上へ")} title={tr("上へ")} disabled={index === 0}
                      onClick={() => move(row.id, -1)}><ArrowUp size={14} aria-hidden="true"/></button>
                    <button type="button" aria-label={tr("下へ")} title={tr("下へ")} disabled={index === rows.length - 1}
                      onClick={() => move(row.id, 1)}><ArrowDown size={14} aria-hidden="true"/></button>
                    <button type="button" aria-label={tr("削除")} title={tr("削除")}
                      onClick={() => setRows((before) => before.filter((item) => item.id !== row.id))}><Trash2 size={14} aria-hidden="true"/></button>
                  </div>
                  <RecipeStepSettings transform={operation} options={suggestedFields.get(row.id) ?? []}
                    onChange={(next) => update(row.id, next)} />
                </li>
              );
            })}
          </ol>
          <label className="se-composer-add">
            <Plus size={14} aria-hidden="true"/>
            <select aria-label={tr("加工を追加")} value="" disabled={rows.length >= 32} onChange={(event) => {
              const kind = event.target.value as ValueTransformKind;
              if (kind) add(kind);
            }}>
              <option value="">{tr("加工を追加")}</option>
              {VALUE_TRANSFORM_GROUPS.map((group) => (
                <optgroup key={group.label} label={tr(group.label)}>
                  {group.kinds.map((kind) => <option key={kind} value={kind} title={tr(DESCRIPTIONS[kind])}>{tr(VALUE_TRANSFORM_LABELS[kind])}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <section className="se-composer-result">
            <strong>{tr("見本の結果")}</strong>
            <output aria-live="polite" data-result-kind={result?.kind ?? "missing"}>{short(describeResult(result), 500)}</output>
          </section>
        </div>
        <footer className="se-composer-foot">
          <button type="button" className="btn" onClick={onClose}>{tr("キャンセル")}</button>
          <button type="button" className="btn btn-primary" disabled={invalid} onClick={apply}>{tr("ブロックに反映")}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

export function ValueComposerPreview({ currentValue, samples, excludedName, recipe, onApply }: {
  currentValue: string;
  samples: Record<string, unknown>;
  excludedName: string;
  recipe?: ValueRecipe;
  onApply: (recipe: ValueRecipe) => void;
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
        {recipe ? tr("加工を編集") : tr("値を組み立てる")}
      </button>
      {open && (
        <RecipeDialog currentValue={currentValue} samples={samples} excludedName={excludedName}
          initialRecipe={recipe} onApply={onApply} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
