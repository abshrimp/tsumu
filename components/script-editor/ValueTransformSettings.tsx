"use client";

/** Pure value-operation controls for ordinary script blocks. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Phrase, TextIn } from "./inputs";
import { tr } from "../../lib/i18n";
import { formatValueOperandInput, parseValueOperandInput } from "../../lib/script-model/compose";
import type {
  ValueTransform, ValueTransformKind, NumericOperation, ValueOperandType,
} from "../../lib/script-model/compose";

export const VALUE_TRANSFORM_LABELS: Record<ValueTransformKind, string> = {
  field: "リストから項目を取り出す",
  length: "リストの項目数を数える",
  math: "数値を計算する",
  stringify: "JSON文字列に変換する",
  parse: "JSON文字列を読み取る",
  split: "文字列を分割する",
  join: "リストを文字列につなぐ",
  replace: "文字列を置き換える",
  sort: "リストを並べ替える",
  append: "リストに要素を追加する",
  fallback: "値がないとき別の値を使う",
};

export const VALUE_TRANSFORM_GROUPS: readonly { label: string; kinds: readonly ValueTransformKind[] }[] = [
  { label: "値の取得・補完", kinds: ["field", "fallback"] },
  { label: "数値・文字列の加工", kinds: ["math", "split", "replace", "join"] },
  { label: "リストの操作", kinds: ["length", "sort", "append"] },
  { label: "JSONの変換", kinds: ["stringify", "parse"] },
];
const MATH: readonly { value: NumericOperation; label: string }[] = [
  { value: "add", label: "足す" }, { value: "subtract", label: "引く" },
  { value: "multiply", label: "掛ける" }, { value: "divide", label: "割る" },
  { value: "remainder", label: "余り" },
];

/** Native select sized to the longest translated option, regardless of the selected value. */
function FixedOptionSelect({ children, ...props }: ComponentProps<"select">) {
  const selectRef = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    const select = selectRef.current;
    if (!select) return;
    const measure = () => {
      if (selectRef.current !== select) return;
      const style = getComputedStyle(select);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const longest = Math.max(0, ...Array.from(select.options, (option) =>
        ctx.measureText(option.textContent ?? "").width));
      const box = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      // Subpixel rounding and native select minimums can otherwise resize the control.
      select.style.width = `${Math.ceil(longest + box + 1)}px`;
    };
    measure();
    // Font loading may change the measured width after the initial render.
    void document.fonts.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  return <select {...props} className="se-in se-fixed-select" ref={selectRef}>{children}</select>;
}

/** Field names and variable-token suggestions use the same editable input. */
function fieldSuggestions(options: string[], samples: Record<string, unknown>, excludedVariableName?: string): string[] {
  const out = new Set(options);
  const visit = (value: unknown, name: string, depth: number) => {
    if (out.size >= 120 || !name || name.startsWith("#")) return;
    out.add("{" + name + "}");
    if (depth >= 3 || !value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [child, item] of Object.entries(value)) {
      if (out.size >= 120) break;
      visit(item, name + "." + child, depth + 1);
    }
  };
  for (const [name, value] of Object.entries(samples)) {
    if (name !== excludedVariableName) visit(value, name, 0);
  }
  return [...out];
}

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


function ValueOperandEditor({ type, text, onChange, purpose = "compare" }: {
  type: ValueOperandType;
  text: string;
  onChange: (text: string, type: ValueOperandType) => void;
  purpose?: "compare" | "list";
}) {
  const isList = purpose === "list";
  return (
    <div className="se-composer-operand">
      <TextIn vars value={formatValueOperandInput(text, type)} valueContext="value" width={144}
        placeholder={isList ? tr("追加・削除する値 / {変数}") : tr("設定する値 / {変数}")}
        onCommit={(input) => {
          const next = parseValueOperandInput(input);
          onChange(next.operand, next.operandType);
        }} />
    </div>
  );
}

function RecipeStepSettings({ transform, options, onChange, samples, excludedVariableName }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
  samples: Record<string, unknown>;
  excludedVariableName?: string;
}) {
  const allOptions = transform.kind === "sort" ? fieldSuggestions(options, samples, excludedVariableName) : [];
  if (transform.kind === "math") return (
    <div className="se-composer-step-settings">
      <FixedOptionSelect aria-label={tr("計算方法")} value={transform.operation}
        onChange={(e) => onChange({ ...transform, operation: e.target.value as NumericOperation })}>
        {MATH.map((method) => <option key={method.value} value={method.value}>{tr(method.label)}</option>)}
      </FixedOptionSelect>
      <div className="se-composer-operand">
        <TextIn vars value={transform.operandType === "variable"
          ? "{" + String(transform.operand) + "}" : String(transform.operand)}
          valueContext="value" width={154} placeholder={tr("計算する値 / {変数}")}
          onCommit={(input) => {
            const text = input.trim();
            const variable = /^\{([^{}\s"'<>]+)\}$/.exec(text);
            if (variable) onChange({ ...transform, operandType: "variable", operand: variable[1] });
            else onChange({ ...transform, operandType: "number",
              operand: text !== "" && Number.isFinite(Number(text)) ? Number(text) : text });
          }} />
      </div>
    </div>
  );

  if (transform.kind === "append") return (
    <div className="se-composer-step-settings">
      <ValueOperandEditor type={transform.operandType} text={transform.operand} purpose="list"
        onChange={(operand, operandType) => onChange({ ...transform, operand, operandType })} />
    </div>
  );

  if (transform.kind === "split" || transform.kind === "join") return (
    <div className="se-composer-step-settings">
      <TextIn vars value={transform.separator} width={144} placeholder={tr("区切り文字")}
        onCommit={(separator) => onChange({ ...transform, separator })} />
    </div>
  );

  if (transform.kind === "replace") return (
    <div className="se-composer-step-settings">
      <TextIn vars value={transform.find} width={144} placeholder={tr("探す文字列")}
        onCommit={(find) => onChange({ ...transform, find })} />
      <TextIn vars value={transform.replacement} width={144} placeholder={tr("置き換え後")}
        onCommit={(replacement) => onChange({ ...transform, replacement })} />
      <label className="se-composer-regex">
        <input type="checkbox" checked={transform.regex}
          onChange={(e) => onChange({ ...transform, regex: e.target.checked })} />
        {tr("正規表現")}
      </label>
    </div>
  );

  if (transform.kind === "sort") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.field} options={allOptions}
        ariaLabel={tr("リスト内の項目名")}
        placeholder={tr("項目（空なら要素自身）")}
        onChange={(field) => onChange({ ...transform, field })} />
        <FixedOptionSelect aria-label={tr("並び順")} value={transform.direction}
          onChange={(e) => onChange({ ...transform, direction: e.target.value as "asc" | "desc" })}>
          <option value="asc">{tr("昇順")}</option>
          <option value="desc">{tr("降順")}</option>
        </FixedOptionSelect>
    </div>
  );
  return null;
}


/** Standalone controls for a block on the script canvas, not a modal recipe. */
export function ValueTransformSettings({ transform, options, onChange, samples, excludedVariableName }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
  samples: Record<string, unknown>;
  excludedVariableName?: string;
}) {
  const allOptions = transform.kind === "field" ? fieldSuggestions(options, samples, excludedVariableName) : [];
  if (transform.kind === "field") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.key} options={allOptions}
        placeholder={tr("項目名 / {変数}")}
        onChange={(key) => onChange({ ...transform, key })} />
    </div>
  );
  if (transform.kind === "fallback") return (
    <div className="se-composer-step-settings">
      <select className="se-in se-fixed-select"
        aria-label={tr("値を補う条件")}
        value={transform.when ?? "missing"}
        onChange={(event) => onChange({ kind: "fallback", text: transform.text,
          when: event.target.value === "nullish" ? "nullish" : "missing" })}>
        <option value="missing">{tr("値が存在しない場合")}</option>
        <option value="nullish">{tr("値が存在しないかnullの場合")}</option>
      </select>
      <TextIn vars value={transform.text} width={174} placeholder={tr("代わりに使う値 / {変数}")}
        onCommit={(text) => onChange({ ...transform, text })} />
    </div>
  );
  return <RecipeStepSettings transform={transform} options={options} onChange={onChange} samples={samples}
    excludedVariableName={excludedVariableName} />;
}

