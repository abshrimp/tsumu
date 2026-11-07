"use client";

/** Pure value-operation controls for ordinary script blocks. */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { PathMenu } from "./fetch";
import { TextIn } from "./inputs";
import { tr } from "../../lib/i18n";
import type {
  ValueTransform, ValueTransformKind, CompareOperation,
  NumericOperation, ValueOperandType,
} from "../../lib/script-model/compose";

export const VALUE_TRANSFORM_LABELS: Record<ValueTransformKind, string> = {
  field: "項目を取り出す",
  index: "リストから1件取り出す",
  has: "項目があるか調べる",
  length: "リストの件数を数える",
  format: "文字列に変換する",
  stringify: "JSON文字列に変換する",
  parse: "JSON文字列を読み取る",
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
  field: "項目付きデータから指定した項目の値を取り出します。",
  index: "リストの先頭を0として、指定した位置の値を取り出します。",
  has: "指定した項目が存在するかをtrueまたはfalseで返します。",
  length: "リストにある要素の数を返します。",
  format: "文字・数値・真偽値を文字列にします。リストは変換できません。",
  stringify: "リストや項目付きデータも含め、JSON形式の文字列にします。",
  parse: "JSON形式の文字列を読み取り、データとして使える値にします。",
  fallback: "値が存在しない場合だけ別の値を使います。nullには適用しません。",
  "fallback-nullish": "値が存在しない場合とnullの場合に、別の値を使います。",
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
  append: "リストの末尾に値を1件追加した新しいリストを作ります。",
  remove: "指定した値と等しい要素をすべて取り除いた新しいリストを作ります。",
  "remove-at": "先頭を0とする指定位置の要素だけを削除した新しいリストを作ります。-1は末尾です。",
};

export const VALUE_TRANSFORM_GROUPS: readonly { label: string; kinds: readonly ValueTransformKind[] }[] = [
  { label: "値を取り出す", kinds: ["field", "index", "find", "map-field"] },
  { label: "値を調べる", kinds: ["has", "length", "compare", "not"] },
  { label: "値を計算・変換する", kinds: ["math", "format", "stringify", "parse", "split", "join", "replace"] },
  { label: "リストを加工する", kinds: ["filter", "map-set", "sort", "append", "remove", "remove-at"] },
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


function ValueOperandEditor({ type, text, onChange, samples, purpose = "compare" }: {
  type: ValueOperandType;
  text: string;
  onChange: (text: string, type: ValueOperandType) => void;
  samples: Record<string, unknown>;
  purpose?: "compare" | "list";
}) {
  const isList = purpose === "list";
  return (
    <div className="se-composer-operand">
      <select className="se-in se-fixed-select" aria-label={isList ? tr("操作する値の種類") : tr("比較する値の種類")} value={type}
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
        <select className="se-in se-fixed-select" aria-label={isList ? tr("操作する値") : tr("比較する値")} value={text}
          onChange={(e) => onChange(e.target.value, type)}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type !== "null" && (
        <TextIn vars value={type === "variable" ? "{" + text + "}" : text}
          valueContext="value" width={144}
          type={type === "number" ? "number" : "text"}
          placeholder={type === "number" ? "0" : (isList ? tr("追加・削除する文字列") : tr("比較する文字列"))}
          onCommit={(next) => onChange(next, type === "variable" ? "text" : type)} />
      )}
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
  if (transform.kind === "math") return (
    <div className="se-composer-step-settings">
      <select className="se-in se-fixed-select" aria-label={tr("計算方法")} value={transform.operation}
        onChange={(e) => onChange({ ...transform, operation: e.target.value as NumericOperation })}>
        {MATH.map((method) => <option key={method.value} value={method.value}>{tr(method.label)}</option>)}
      </select>
      <div className="se-composer-operand">
        <select className="se-in se-fixed-select" aria-label={tr("計算する値の種類")}
          value={transform.operandType === "variable" ? "variable" : "number"}
          onChange={(e) => onChange(e.target.value === "variable"
            ? { ...transform, operandType: "variable", operand: "" }
            : { ...transform, operandType: "number", operand: 1 })}>
          <option value="number">{tr("数値")}</option>
          <option value="variable">{tr("変数")}</option>
        </select>
        {transform.operandType === "variable" ? (
          <PathMenu root={samples} path={String(transform.operand)} mode="any" allowRoot={false}
            ariaLabel={tr("計算する変数")} placeholder={tr("変数を選択")}
            onChange={(path) => onChange({ ...transform, operand: path })}
            portalZIndex={560} />
        ) : (
          <input aria-label={tr("計算する数")} type="number" step="any"
            value={typeof transform.operand === "number" && Number.isFinite(transform.operand) ? transform.operand : ""}
            onChange={(e) => onChange({ ...transform, operand: e.target.value === "" ? NaN : Number(e.target.value) })} />
        )}
      </div>
    </div>
  );

  if (transform.kind === "append" || transform.kind === "remove") return (
    <div className="se-composer-step-settings">
      <ValueOperandEditor type={transform.operandType} text={transform.operand} samples={samples} purpose="list"
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

  if (transform.kind === "compare" || transform.kind === "find" || transform.kind === "filter" || transform.kind === "map-set") {
    return (
      <div className="se-composer-step-settings">
        {(transform.kind === "find" || transform.kind === "filter" || transform.kind === "map-set") && (
          <FieldKeyPicker value={transform.field} options={allOptions}
            ariaLabel={tr("リスト内の項目名")} placeholder={transform.kind === "map-set" ? tr("追加する項目") : tr("項目（空なら要素自身）")}
            onChange={(field) => onChange({ ...transform, field })} />
        )}
        {transform.kind !== "map-set" && (
          <select className="se-in se-fixed-select" aria-label={tr("比較方法")} value={transform.operation}
            onChange={(e) => onChange({ ...transform, operation: e.target.value as CompareOperation })}>
            {COMPARISONS.map((op) => <option key={op.value} value={op.value}>{tr(op.label)}</option>)}
          </select>
        )}
        <ValueOperandEditor type={transform.operandType} text={transform.operand} samples={samples}
          onChange={(operand, operandType) => onChange({ ...transform, operand, operandType })} />
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
        <select className="se-in se-fixed-select" aria-label={tr("並び順")} value={transform.direction}
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
      <TextIn vars value={transform.text} width={174} placeholder={tr("代わりに使う値 / {変数}")}
        onCommit={(text) => onChange({ ...transform, text })} />
    </div>
  );
  return <RecipeStepSettings transform={transform} options={options} onChange={onChange} samples={samples} />;
}

