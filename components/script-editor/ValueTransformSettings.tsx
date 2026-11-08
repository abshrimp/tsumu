"use client";

/** Pure value-operation controls for ordinary script blocks. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, X } from "lucide-react";
import { PathMenu } from "./fetch";
import { CONDITION_OPERATORS, NegationSelect, Phrase, TextIn } from "./inputs";
import { tr } from "../../lib/i18n";
import { formatValueOperandInput, parseValueOperandInput } from "../../lib/script-model/compose";
import type {
  ValueTransform, ValueTransformKind, CompareOperation,
  NumericOperation, ValueOperandType, ValueCondition,
} from "../../lib/script-model/compose";

export const VALUE_TRANSFORM_LABELS: Record<ValueTransformKind, string> = {
  field: "リストから項目を取り出す",
  index: "リストから1件取り出す",
  has: "項目があるか調べる",
  length: "リストの項目数を数える",
  format: "表示用の文字にする",
  stringify: "JSON文字列に変換する",
  parse: "JSON文字列を読み取る",
  "object-entries": "オブジェクトをリストに変換する",
  fallback: "値がないとき別の値を使う",
  "fallback-nullish": "値がないかnullなら別の値を使う",
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
  append: "リストに要素を追加する",
  remove: "リストから一致する要素を削除する",
  "remove-at": "リストの指定位置を削除する",
};

const DESCRIPTIONS: Record<ValueTransformKind, string> = {
  field: "リストから指定したキーの値を取り出します。配列・辞書のどちらでも使えます。キーには{変数}も使えます。",
  index: "リストの先頭を0として、指定した位置の値を取り出します。",
  has: "指定した項目が存在するかをtrueまたはfalseで返します。",
  length: "配列・辞書どちらの場合もリストの項目数を返します。",
  format: "文字・数値・真偽値を文字列にします。リストは変換できません。",
  stringify: "リストや項目付きデータも含め、JSON形式の文字列にします。",
  parse: "JSON形式の文字列を読み取り、データとして使える値にします。",
  "object-entries": "オブジェクトのキーと値を、列名を指定できるリストに変換します。元のデータは変更しません。",
  fallback: "値が存在しない場合だけ別の値を使います。nullには適用しません。",
  "fallback-nullish": "値が存在しない場合とnullの場合に、別の値を使います。",
  math: "数値に指定した数を足す・引く・掛ける・割るなどを行います。0で割るとエラーになります。",
  compare: "値と指定した値を型を保って比較し、trueまたはfalseを返します。",
  not: "trueをfalseに、falseをtrueに反転します。",
  split: "文字列を指定した区切り文字で分割し、空欄を除いたリストにします。",
  join: "リストの各項目の値を列挙順に、指定した区切り文字で連結します。",
  replace: "文字列の一致する部分をすべて置き換えます。正規表現も指定できます。",
  find: "リストから、条件に一致する最初の1件を取得します。見つからなければ値がありません。",
  filter: "リストから、条件に一致した項目だけを残した新しいリストを作ります。",
  "map-field": "リスト内の各データから同じ項目を取り出し、新しいリストにします。",
  "map-set": "各データに項目を追加・上書きし、新しいリストにします。元のデータは変更しません。",
  sort: "項目の値を基準にリストを並べ替えます。元の順番は変更しません。",
  append: "リストの末尾に値を1件追加した新しいリストを作ります。",
  remove: "指定した値と等しい要素をすべて取り除いた新しいリストを作ります。",
  "remove-at": "先頭を0とする指定位置の要素だけを削除した新しいリストを作ります。-1は末尾です。",
};

export const VALUE_TRANSFORM_GROUPS: readonly { label: string; kinds: readonly ValueTransformKind[] }[] = [
  { label: "値を取り出す", kinds: ["field"] },
  { label: "値を調べる", kinds: ["length"] },
  { label: "値を計算・変換する", kinds: ["math", "format", "stringify", "parse", "split", "join", "replace"] },
  { label: "リストを加工する", kinds: ["sort", "append"] },
  { label: "値を補う", kinds: ["fallback"] },
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
function fieldSuggestions(options: string[], samples: Record<string, unknown>): string[] {
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
  for (const [name, value] of Object.entries(samples)) visit(value, name, 0);
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

/** Condition syntax is shared with "if" and list display filters. */
function RecipeConditionLine({ condition, fieldEnabled, options, onChange,
  join, onJoinChange, onRemove }: {
  condition: ValueCondition;
  fieldEnabled: boolean;
  options: string[];
  onChange: (patch: Partial<ValueCondition>) => void;
  join?: "and" | "or";
  onJoinChange?: (join: "and" | "or") => void;
  onRemove?: () => void;
}) {
  // Parts are arranged by the translated phrase, not a hardcoded ja/en branch.
  // A future locale may freely reorder every control using these named slots.
  return (
    <div className="se-composer-condition-line">
      <Phrase
        text={fieldEnabled
          ? "{join}{field}が{value}{op}{negation}{remove}"
          : "{join}{value}{op}{negation}{remove}"}
        parts={{
          join: join ? (
            <FixedOptionSelect aria-label={tr("条件のつなぎ方")}
              value={join} onChange={(e) => onJoinChange?.(e.target.value as "and" | "or")}>
              <option value="and">{tr("かつ")}</option>
              <option value="or">{tr("または")}</option>
            </FixedOptionSelect>
          ) : false,
          field: fieldEnabled && <FieldKeyPicker value={condition.field} options={options}
            ariaLabel={tr("リスト内の項目名")} placeholder={tr("項目（空なら要素自身）")}
            onChange={(field) => onChange({ field })} />,
          value: condition.operation !== "empty" && (
            <TextIn vars value={condition.operand} width={150}
              valueContext="value" placeholder={tr("値 / {変数}")}
              onCommit={(operand) => onChange({ operand })} />
          ),
          op: (
            <FixedOptionSelect aria-label={tr("比較方法")}
              value={condition.operation}
              onChange={(e) => onChange({ operation: e.target.value as CompareOperation })}>
              {CONDITION_OPERATORS.map((op) =>
                <option key={op.value} value={op.value}>{op.label}</option>)}
            </FixedOptionSelect>
          ),
          negation: <NegationSelect not={condition.not}
            operation={condition.operation} onChange={(not) => onChange({ not })} />,
          remove: onRemove ? (
            <button type="button" className="se-mini" aria-label={tr("この条件を削除")}
              onClick={onRemove}><X size={12} /></button>
          ) : false,
        }}
      />
    </div>
  );
}

function RecipeStepSettings({ transform, options, onChange, samples }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
  samples: Record<string, unknown>;
}) {
  const allOptions = fieldSuggestions(options, samples);
  if (transform.kind === "object-entries") return (
    <div className="se-composer-step-settings">
      <Phrase text="キーの項目名{key}値の項目名{value}" parts={{
        key: <TextIn vars value={transform.keyField} width={125}
          placeholder={tr("キーの項目名")}
          onCommit={(keyField) => onChange({ ...transform, keyField })} />,
        value: <TextIn vars value={transform.valueField} width={125}
          placeholder={tr("値の項目名")}
          onCommit={(valueField) => onChange({ ...transform, valueField })} />,
      }} />
    </div>
  );

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

  if (transform.kind === "append" || transform.kind === "remove") return (
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

  if (transform.kind === "map-set") {
    return <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.field} options={allOptions}
        ariaLabel={tr("リスト内の項目名")} placeholder={tr("追加する項目")}
        onChange={(field) => onChange({ ...transform, field })} />
      <ValueOperandEditor type={transform.operandType} text={transform.operand}
        onChange={(operand, operandType) => onChange({ ...transform, operand, operandType })} />
    </div>;
  }

  if (transform.kind === "compare" || transform.kind === "find" || transform.kind === "filter") {
    const fieldEnabled = transform.kind !== "compare";
    const first: ValueCondition = {
      field: fieldEnabled ? transform.field : "",
      operation: transform.operation,
      operand: transform.operand,
      not: transform.not,
    };
    const clauses = transform.conditions ?? [];
    const setExtra = (index: number, patch: Partial<ValueCondition>, activate = false) =>
      onChange({ ...transform, conditions: clauses.map((condition, i) => {
        if (i !== index) return condition;
        const updated = { ...condition, ...patch };
        // Enabled is the default. Remove the temporary marker once edited
        // rather than persisting a redundant true flag in doc.json.
        if (activate) delete updated.configured;
        return updated;
      }) });
    const add = (and: boolean) => {
      if (clauses.length >= 32) return;
      onChange({ ...transform, conditions: [...clauses, {
        field: fieldEnabled ? transform.field : "",
        operation: "eq" as const,
        operand: "",
        and,
        configured: false,
      }] });
    };
    return (
      <div className="se-composer-step-settings se-composer-conditions">
        <RecipeConditionLine condition={first} fieldEnabled={fieldEnabled}
          options={allOptions}
          onChange={(patch) => onChange({ ...transform, ...patch })} />
        {clauses.map((condition, index) =>
          <RecipeConditionLine key={index} condition={condition}
            fieldEnabled={fieldEnabled} options={allOptions}
            join={condition.and ? "and" : "or"}
            onJoinChange={(join) => setExtra(index, { and: join === "and" })}
            onChange={(patch) => setExtra(index, patch, true)}
            onRemove={() => onChange({ ...transform,
              conditions: clauses.filter((_, i) => i !== index) })} />)}
        <div className="se-composer-condition-actions">
          <button type="button" className="se-mini se-mini-text" disabled={clauses.length >= 32} onClick={() => add(true)}>
            <Plus size={12} />{tr("かつ")}
          </button>
          <button type="button" className="se-mini se-mini-text" disabled={clauses.length >= 32} onClick={() => add(false)}>
            <Plus size={12} />{tr("または")}
          </button>
        </div>
      </div>
    );
  }

  if (transform.kind === "map-field" || transform.kind === "sort") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.field} options={allOptions}
        ariaLabel={tr("リスト内の項目名")}
        placeholder={transform.kind === "sort" ? tr("項目（空なら要素自身）") : tr("取り出す項目名")}
        onChange={(field) => onChange({ ...transform, field })} />
      {transform.kind === "sort" && (
        <FixedOptionSelect aria-label={tr("並び順")} value={transform.direction}
          onChange={(e) => onChange({ ...transform, direction: e.target.value as "asc" | "desc" })}>
          <option value="asc">{tr("昇順")}</option>
          <option value="desc">{tr("降順")}</option>
        </FixedOptionSelect>
      )}
    </div>
  );
  return null;
}


/** Standalone controls for a block on the script canvas, not a modal recipe. */
export function ValueTransformSettings({ transform, options, onChange, samples }: {
  transform: ValueTransform;
  options: string[];
  onChange: (next: ValueTransform) => void;
  samples: Record<string, unknown>;
}) {
  const allOptions = fieldSuggestions(options, samples);
  if (transform.kind === "field" || transform.kind === "has") return (
    <div className="se-composer-step-settings">
      <FieldKeyPicker value={transform.key} options={allOptions}
        placeholder={tr("項目名 / {変数}")}
        onChange={(key) => onChange({ ...transform, key })} />
    </div>
  );
  if (transform.kind === "index" || transform.kind === "remove-at") return (
    <div className="se-composer-step-settings">
      <input aria-label={tr(transform.kind === "remove-at" ? "削除する位置" : "取り出す位置")} type="number" min="-1" step="1"
        value={transform.index}
        onChange={(e) => onChange({ ...transform, index: e.target.value === "" ? -1 : Number(e.target.value) })} />
    </div>
  );
  if (transform.kind === "fallback" || transform.kind === "fallback-nullish") return (
    <div className="se-composer-step-settings">
      <select className="se-in se-fixed-select"
        aria-label={tr("値を補う条件")}
        value={transform.kind === "fallback-nullish" ? "nullish" : transform.when ?? "missing"}
        onChange={(event) => onChange({ kind: "fallback", text: transform.text,
          when: event.target.value === "nullish" ? "nullish" : "missing" })}>
        <option value="missing">{tr("値が存在しない場合")}</option>
        <option value="nullish">{tr("値が存在しないかnullの場合")}</option>
      </select>
      <TextIn vars value={transform.text} width={174} placeholder={tr("代わりに使う値 / {変数}")}
        onCommit={(text) => onChange({ ...transform, text })} />
    </div>
  );
  return <RecipeStepSettings transform={transform} options={options} onChange={onChange} samples={samples} />;
}

