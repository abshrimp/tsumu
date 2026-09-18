"use client";

/** 通常のスクリプトのブロックで使う、値を加工する純粋な処理の設定欄。 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { TextIn } from "./inputs";
import { tr } from "../../lib/i18n";
import type {
  ValueTransform, ValueTransformKind, NumericOperation,
} from "../../lib/script-model/compose";

export const VALUE_TRANSFORM_LABELS: Record<ValueTransformKind, string> = {
  field: "Get an item from a list",
  length: "Count list items",
  math: "Calculate a number",
  stringify: "Convert to JSON text",
  parse: "Parse JSON text",
  split: "Split text",
  join: "Join a list as text",
  replace: "Replace text",
  sort: "Sort a list",
  fallback: "Use another value if missing",
};

export const VALUE_TRANSFORM_GROUPS: readonly { label: string; kinds: readonly ValueTransformKind[] }[] = [
  { label: "Extract and fallback", kinds: ["field", "fallback"] },
  { label: "Number and text operations", kinds: ["math", "split", "replace", "join"] },
  { label: "List operations", kinds: ["length", "sort"] },
  { label: "JSON conversion", kinds: ["stringify", "parse"] },
];
const MATH: readonly { value: NumericOperation; label: () => string }[] = [
  { value: "add", label: () => tr("Add", "add_variant_1") },
  { value: "subtract", label: () => tr("Subtract") },
  { value: "multiply", label: () => tr("Multiply", "multiply_variant_1") },
  { value: "divide", label: () => tr("Divide") },
  { value: "remainder", label: () => tr("Remainder") },
];

/** 選択中の値にかかわらず、訳した選択肢のうち最も長いものに合わせた幅の標準の選択欄。 */
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
      // こうしないと、サブピクセルの丸めや標準の選択欄の最小幅で、部品の大きさが変わってしまう。
      select.style.width = `${Math.ceil(longest + box + 1)}px`;
    };
    measure();
    // フォントの読み込みで、最初の描画の後に測った幅が変わることがある。
    void document.fonts.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });
  return <select {...props} className="se-in se-fixed-select" ref={selectRef}>{children}</select>;
}

/** 項目名と変数の候補は、同じ入力欄で編集する。 */
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

function FieldKeyPicker({ value, onChange, options, samples, excludedVariableName, ariaLabel, placeholder }: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  samples?: Record<string, unknown>;
  excludedVariableName?: string;
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
  // 隠れている選択欄では、ワークスペースのすべての変数を列挙しない。
  const choices = useMemo(() => open && samples
    ? fieldSuggestions(options, samples, excludedVariableName) : options,
    [open, options, samples, excludedVariableName]);
  const filtered = (showAll ? choices : choices.filter((option) =>
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
        aria-label={ariaLabel ?? tr("Field name to read")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && filtered.length ? listId + "-" + selectedIndex : undefined}
        value={value}
        maxLength={256}
        placeholder={placeholder ?? tr("Field name")}
        onFocus={() => { setOpen(true); setShowAll(true); setActive(0); }}
        onChange={(event) => {
          onChange(event.target.value);
          setShowAll(false);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          // IME で変換している間は、候補の確定・移動・終了を入力メソッドに任せる。
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
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
        aria-label={tr("Show suggested fields")}
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
          aria-label={tr("Suggested fields")}
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
              {tr(choices.length
                ? "No matching fields. You can type a field name."
                : "No fields available. You can type a field name.")}
            </p>
          )}
        </div>,
        document.body,
      )}
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
  if (transform.kind === "math") return (
    <div className="se-composer-step-settings">
      <FixedOptionSelect aria-label={tr("Arithmetic operation")} value={transform.operation}
        onChange={(e) => onChange({ ...transform, operation: e.target.value as NumericOperation })}>
        {MATH.map((method) => <option key={method.value} value={method.value}>{method.label()}</option>)}
      </FixedOptionSelect>
      <div className="se-composer-operand">
        <TextIn vars value={transform.operandType === "variable"
          ? "{" + String(transform.operand) + "}" : String(transform.operand)}
          valueContext="value" width={154} placeholder={tr("Number or {variable}")}
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

  if (transform.kind === "split" || transform.kind === "join") return (
    <div className="se-composer-step-settings">
      <TextIn vars value={transform.separator} width={144} placeholder={tr("Delimiter")}
        onCommit={(separator) => onChange({ ...transform, separator })} />
    </div>
  );

  if (transform.kind === "replace") return (
    <div className="se-composer-step-settings">
      <TextIn vars value={transform.find} width={144} placeholder={tr("String to find")}
        onCommit={(find) => onChange({ ...transform, find })} />
      <TextIn vars value={transform.replacement} width={144} placeholder={tr("Replacement")}
        onCommit={(replacement) => onChange({ ...transform, replacement })} />
      <label className="se-composer-regex">
        <input type="checkbox" checked={transform.regex}
          onChange={(e) => onChange({ ...transform, regex: e.target.checked })} />
        {tr("Regex")}
      </label>
    </div>
  );

  if (transform.kind === "sort") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.field} options={options} samples={samples}
        excludedVariableName={excludedVariableName}
        ariaLabel={tr("List item field")}
        placeholder={tr("Field (blank = item itself)")}
        onChange={(field) => onChange({ ...transform, field })} />
        <FixedOptionSelect aria-label={tr("Sort order")} value={transform.direction}
          onChange={(e) => onChange({ ...transform, direction: e.target.value as "asc" | "desc" })}>
          <option value="asc">{tr("Ascending")}</option>
          <option value="desc">{tr("Descending")}</option>
        </FixedOptionSelect>
    </div>
  );
  return null;
}


/** スクリプトのキャンバス上のブロックに置く、独立した設定欄（モーダルではない）。 */
export function ValueTransformSettings({ transform, options, onChange, samples, excludedVariableName }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
  samples: Record<string, unknown>;
  excludedVariableName?: string;
}) {
  if (transform.kind === "field") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.key} options={options} samples={samples}
        excludedVariableName={excludedVariableName}
        placeholder={tr("Field name / {variable}")}
        onChange={(key) => onChange({ ...transform, key })} />
    </div>
  );
  if (transform.kind === "fallback") return (
    <div className="se-composer-step-settings">
      <select className="se-in se-fixed-select"
        aria-label={tr("When to use a fallback")}
        value={transform.when}
        onChange={(event) => onChange({ kind: "fallback", text: transform.text,
          when: event.target.value === "nullish" ? "nullish" : "missing" })}>
        <option value="missing">{tr("When the value is missing")}</option>
        <option value="nullish">{tr("When the value is missing or null")}</option>
      </select>
      <TextIn vars value={transform.text} width={174} placeholder={tr("Replacement value / {variable}")}
        onCommit={(text) => onChange({ ...transform, text })} />
    </div>
  );
  return <RecipeStepSettings transform={transform} options={options} onChange={onChange} samples={samples}
    excludedVariableName={excludedVariableName} />;
}

