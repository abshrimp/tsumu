"use client";

import { isEnterKey } from "../lib/keys";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Info,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import type { PropInfo } from "../lib/style";
import { BP_INFO, STATE_INFO, bpIconKind, parseNumeric, sameValue } from "../lib/style";
import { useEditor } from "../lib/store";
import { openHelp } from "../lib/help";
import {
  findVarQuery,
  varQueryEnd,
  isVarListShortcut,
  matchVarNames,
  type VarQuery,
} from "../lib/vars";
import { glyphs } from "./Glyph";
import VarExplorer from "./VarExplorer";
import { tr } from "../lib/i18n";

/** ブレークポイントの絵柄（幅から選ぶ） */
export function BpIcon({ bp, size = 13 }: { bp: string; size?: number }) {
  const kind = bpIconKind(bp);
  if (kind === "monitor") return <Monitor size={size} />;
  if (kind === "tablet") return <Tablet size={size} />;
  if (kind === "mobileL") return <Smartphone size={size} style={{ rotate: "90deg" }} />;
  return <Smartphone size={size} />;
}

/* ---------- 説明アイコン（ホバーで説明を表示） ---------- */

/** 長い説明文の代わりに置く小さな「i」アイコン。ホバー・フォーカスで説明を出す */
export function InfoTip({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      className="info-tip"
      data-tip={text}
      tabIndex={0}
      role="img"
      aria-label={text}
      style={style}
    >
      <Info size={12} strokeWidth={2} />
    </span>
  );
}

/**
 * 折りたためるセクションの見出し。行全体がクリック判定になる
 * （説明アイコンと右端のツールはクリックしても開閉しない）。
 */
export function SecHead({
  title,
  info,
  open,
  onToggle,
  tools,
  isSet,
  help,
}: {
  title: ReactNode;
  info?: string;
  open: boolean;
  onToggle: () => void;
  tools?: ReactNode;
  /** 閉じた中に変更済みの設定がある（見出しに変更の色を付ける） */
  isSet?: boolean;
  /** 使い方を説明するヘルプの記事ID（見出しに「?」を出す） */
  help?: string;
}) {
  return (
    <div
      className={`sec-head is-toggle${open ? " is-open" : ""}${isSet ? " is-set" : ""}`}
      onClick={onToggle}
    >
      <button type="button" className="sec-title" aria-expanded={open}>
        {title}
      </button>
      {info && (
        <span className="sec-info" onClick={(e) => e.stopPropagation()}>
          <InfoTip text={info} />
        </span>
      )}
      {help && (
        <button
          type="button"
          className="sec-help"
          aria-label={tr("{p1}の使い方", { p1: typeof title === "string" ? title : "" })}
          data-tip={tr("使い方を見る")}
          onClick={(e) => {
            e.stopPropagation();
            openHelp(help);
          }}
        >
          <CircleHelp size={13} />
        </button>
      )}
      {tools && (
        <span className="sec-tools" onClick={(e) => e.stopPropagation()}>
          {tools}
        </span>
      )}
      <span className="sec-chev" aria-hidden>
        <ChevronRight size={12} className="chev" strokeWidth={1.5} />
      </span>
    </div>
  );
}

/**
 * 折りたためるセクション。閉じても中身は隠して描画したままにし、
 * 中に変更済みの設定（.is-set）があれば見出しに色を付ける
 */
export function Section({
  title,
  info,
  children,
  tools,
  defaultOpen = true,
  tutorialTarget,
  help,
}: {
  title: string;
  /** 見出し横の「i」にホバーで出す説明 */
  info?: string;
  children: ReactNode;
  tools?: ReactNode;
  defaultOpen?: boolean;
  tutorialTarget?: string;
  /** 使い方を説明するヘルプの記事ID */
  help?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hasSet, setHasSet] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 設定が初めて追加されたときは、セクション自体を再マウントせずに開く。
  // key による再マウントは、開いているドロップダウンの削除と競合する。
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const check = () => setHasSet(!!body.querySelector(".is-set"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  return (
    <div className="sec" data-tutorial={tutorialTarget}>
      <SecHead
        title={title}
        info={info}
        open={open}
        onToggle={() => setOpen(!open)}
        tools={tools}
        isSet={!open && hasSet}
        help={help}
      />
      <div ref={bodyRef} className="sec-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/* ---------- インスペクタコンテキスト ---------- */

export interface Inspector {
  get: (prop: string) => PropInfo;
  /** null で現在の (bp, state) から削除 */
  set: (props: Record<string, string | null>) => void;
  /** 欄を空にしたときに書き込む値（大きい画面の値を打ち消す初期値、または null） */
  cleared: (prop: string) => string | null;
  setTransient: (props: Record<string, string | null>) => void;
  checkpoint: () => void;
}

export const InspectorCtx = createContext<Inspector | null>(null);

export function useInspector(): Inspector {
  const ctx = useContext(InspectorCtx);
  if (!ctx) throw new Error("InspectorCtx is missing");
  return ctx;
}

/* ---------- ラベル付きグループ（ラベルは上） ---------- */

export function Grp({
  label,
  info,
  setHere: setHereProp,
  onReset: onResetProp,
  props,
  children,
}: {
  label?: string;
  /** ラベル横の「i」にホバーで出す説明 */
  info?: string;
  setHere?: boolean;
  onReset?: () => void;
  /**
   * このグループで設定するスタイルのプロパティ。setHere / onReset を省略すると、
   * これらのどれかが変更済みなら色を付け、右クリックでまとめて解除する
   */
  props?: string[];
  children: ReactNode;
}) {
  const insp = useContext(InspectorCtx);
  const setHere =
    setHereProp ?? (!!insp && !!props?.some((p) => insp.get(p).changed));
  const onReset =
    onResetProp ??
    (insp && props?.length
      ? () => insp.set(Object.fromEntries(props.map((p) => [p, null])))
      : undefined);
  const bpLabel = useEditor((s) =>
    s.breakpoint === "base" ? null : BP_INFO[s.breakpoint].label
  );
  const stateLabel = useEditor((s) =>
    s.styleState === "default" ? null : STATE_INFO[s.styleState].label
  );
  return (
    <div className={`grp${setHere ? " is-set" : ""}`}>
      {label !== undefined && (
        <span
          className={`grp-label${setHere ? " is-set" : ""}`}
          data-tip={
            setHere
              ? stateLabel
                ? tr("{stateLabel}用に変更済み（右クリックで解除すると、通常時の設定に戻ります）", { stateLabel })
                : bpLabel
                  ? tr("{bpLabel}用に変更済み（右クリックで解除すると、大きい画面の設定に戻ります）", { bpLabel })
                  : tr("右クリックでリセット")
              : undefined
          }
          onContextMenu={(e) => {
            if (!onReset) return;
            e.preventDefault();
            onReset();
          }}
        >
          {label}
          {info && <InfoTip text={info} />}
        </span>
      )}
      {children}
    </div>
  );
}

/* ---------- 単位の換算 ---------- */

/** % のときに親の幅を基準にするプロパティ（余白は上下も幅が基準） */
const PCT_OF_WIDTH = new Set([
  "width",
  "minWidth",
  "maxWidth",
  "left",
  "right",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
]);
/** % のときに親の高さを基準にするプロパティ */
const PCT_OF_HEIGHT = new Set(["height", "minHeight", "maxHeight", "top", "bottom"]);

/** いま選んでいる要素（キャンバス上の実物） */
function selectedCanvasEl(): HTMLElement | null {
  const id = useEditor.getState().selection;
  if (!id) return null;
  if (id === "__body__") return document.querySelector<HTMLElement>(".cv-root");
  return document.querySelector<HTMLElement>(`.cv-root [data-node="${CSS.escape(id)}"]`);
}

/** % の基準になる大きさ（親の中身の幅・高さ。自由配置なら基準の要素の大きさ） */
function percentBase(el: HTMLElement, axis: "w" | "h"): number | null {
  const pos = getComputedStyle(el).position;
  if (pos === "absolute") {
    const ref = el.offsetParent as HTMLElement | null;
    if (!ref) return null;
    return axis === "w" ? ref.clientWidth : ref.clientHeight;
  }
  if (pos === "fixed") {
    const frame = el.closest<HTMLElement>(".canvas-frame");
    if (!frame) return null;
    return axis === "w" ? frame.clientWidth : frame.clientHeight;
  }
  const parent = el.parentElement;
  if (!parent) return null;
  const cs = getComputedStyle(parent);
  return axis === "w"
    ? parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    : parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
}

/**
 * 単位を切り替えたとき、見た目の大きさが変わらないよう数値を換算する関数。
 * 選んでいる要素の実際の大きさ（親の幅・文字の大きさ）を使う。換算できなければ null
 */
export function unitConverter(prop: string) {
  return (num: number, from: string, to: string): number | null => {
    const el = selectedCanvasEl();
    const pxPer = (unit: string): number | null => {
      if (unit === "px") return 1;
      if (unit === "rem") return 16;
      if (unit === "%") {
        if (!el) return null;
        const base = PCT_OF_WIDTH.has(prop)
          ? percentBase(el, "w")
          : PCT_OF_HEIGHT.has(prop)
            ? percentBase(el, "h")
            : null;
        return base ? base / 100 : null;
      }
      if (unit === "em" || unit === "") {
        if (!el) return null;
        // 文字の大きさの em は親の文字、それ以外（字間・行間）は自分の文字の大きさが基準
        const ref = prop === "fontSize" ? el.parentElement : el;
        const size = ref ? parseFloat(getComputedStyle(ref).fontSize) : NaN;
        return size > 0 ? size : null;
      }
      return null;
    };
    const a = pxPer(from);
    const b = pxPer(to);
    if (a === null || b === null) return null;
    return (num * a) / b;
  };
}

/** 単位に合わせた桁で丸める（px は整数、% は小数1桁、rem / em / 単位なしは2桁） */
function roundForUnit(n: number, unit: string): number {
  const digits = unit === "px" ? 0 : unit === "%" ? 1 : 2;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/* ---------- 数値フィールド（プレフィックス付き / Figma風） ---------- */

export function NumField({
  value,
  onChange,
  pre,
  units = ["px"],
  min,
  max,
  placeholder,
  title,
  onScrubStart,
  onScrub,
  scrubFrom,
  convert,
}: {
  value: string | undefined;
  onChange: (v: string | null) => void;
  /** 単位を切り替えたときの換算（見た目の大きさを保つ）。無ければ数値はそのまま */
  convert?: (num: number, from: string, to: string) => number | null;
  /** 左端の文字 or アイコン */
  pre?: ReactNode;
  units?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  title?: string;
  /**
   * ドラッグ増減（左端の文字・アイコンを左右にドラッグ）。
   * 省略時は onChange で反映し、1回のドラッグを1つの「元に戻す」にまとめる
   */
  onScrubStart?: () => void;
  onScrub?: (v: string) => void;
  /** 値が数値でない（空・auto・none）ときにドラッグを始める値（px） */
  scrubFrom?: () => number | undefined;
}) {
  const parsed = parseNumeric(value);
  const [unit, setUnit] = useState(parsed?.unit ?? units[0]);
  /** 空欄で確定したら、値が変わらなくても欄を作り直して戻った値（大きい画面の値など）を見せる */
  const [resetKey, setResetKey] = useState(0);
  const activeUnit = parsed ? parsed.unit : unit;
  const canCycle = units.length > 1;
  const scrubbable = true;

  useEffect(() => {
    if (parsed && parsed.unit !== unit) setUnit(parsed.unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clampNum = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  const commit = (raw: string) => {
    const t = raw.trim();
    // 触っただけ（表示中の値のまま）なら書き込まない（大きい画面から受け継いだ値をここに固定しない）
    if (t === String(parsed?.num ?? "")) return;
    if (t === "") {
      onChange(null);
      setResetKey((k) => k + 1);
      return;
    }
    const n = parseFloat(t);
    if (Number.isNaN(n)) return;
    onChange(`${clampNum(n)}${activeUnit}`);
  };

  const startScrub = (e: React.PointerEvent) => {
    if (!scrubbable) return;
    const startX = e.clientX;
    const from = parsed ? undefined : scrubFrom?.();
    const startVal = parsed?.num ?? from ?? 0;
    const u = parsed?.unit ?? (from !== undefined ? "px" : units[0]);
    let started = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let last = "";
    const onMove = (ev: PointerEvent) => {
      if (!started && ev.clientX !== startX) {
        started = true;
        if (onScrub) onScrubStart?.();
        else useEditor.getState().beginGesture();
        document.body.classList.add("is-scrubbing");
      }
      if (!started) return;
      const mult = ev.shiftKey ? 10 : 1;
      const v = clampNum(
        startVal + Math.round((ev.clientX - startX) / 2) * mult
      );
      const next = `${Math.round(v * 100) / 100}${u}`;
      if (next === last) return;
      last = next;
      if (onScrub) onScrub(next);
      else onChange(next);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-scrubbing");
      if (started && !onScrub) useEditor.getState().endGesture();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="field" data-tip={title}>
      {pre !== undefined && (
        <span
          className={`field-pre${scrubbable ? " scrub" : ""}`}
          onPointerDown={startScrub}
        >
          {pre}
        </span>
      )}
      <input
        key={`${value ?? "_empty"}:${resetKey}`}
        defaultValue={parsed?.num ?? ""}
        placeholder={placeholder ?? "—"}
        inputMode="decimal"
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const cur = parseFloat((e.target as HTMLInputElement).value) || 0;
            const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
            (e.target as HTMLInputElement).value = String(cur + d);
            commit(String(cur + d));
          }
        }}
      />
      {activeUnit !== "" && (
        <button
          type="button"
          className={`field-unit${canCycle ? " clickable" : ""}`}
          tabIndex={-1}
          data-tip={canCycle ? (convert ? tr("クリックで単位を切り替え（見た目の大きさはそのまま）") : tr("クリックで単位を切り替え")) : undefined}
          onClick={() => {
            if (!canCycle) return;
            const next = units[(units.indexOf(activeUnit) + 1) % units.length];
            setUnit(next);
            if (parsed) {
              const converted = convert?.(parsed.num, parsed.unit, next);
              onChange(`${converted != null ? roundForUnit(converted, next) : parsed.num}${next}`);
            }
          }}
        >
          {activeUnit}
        </button>
      )}
    </div>
  );
}

/** インスペクタ連携版：ドラッグ増減・右クリックリセット付き */
export function PropNum({
  prop,
  pre,
  units = ["px"],
  min,
  max,
  placeholder,
  title,
  emptyValue,
  scrubFrom,
}: {
  prop: string;
  pre?: ReactNode;
  units?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  title?: string;
  /** 入力を空欄で確定したときに設定する値。未指定ならプロパティを削除 */
  emptyValue?: string;
  /** 値が数値でないときにドラッグを始める値（px） */
  scrubFrom?: () => number | undefined;
}) {
  const insp = useInspector();
  const info = insp.get(prop);
  /**
   * 空欄で確定したときの値。パソコン幅以外では消すと大きい画面の値が出てくるため、
   * CSS の初期値（なし・auto など）で上書きする（元に戻すのは右クリック）
   */
  const cleared = emptyValue ?? insp.cleared(prop);
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        insp.set({ [prop]: null });
      }}
      // 変更済みの欄は青くする。複数の欄をまとめたグループ（余白の4方向など）では、
      // グループ全体の色を受け継がず、欄ごとに変更済みかどうかで塗り分ける
      style={{ ["--field" as string]: info.changed ? "var(--field-set)" : "var(--field-base)" }}
    >
      <NumField
        value={info.value ?? emptyValue}
        units={units}
        min={min}
        max={max}
        placeholder={placeholder}
        title={title}
        pre={pre}
        onChange={(v) => insp.set({ [prop]: v === null ? cleared : v })}
        onScrubStart={() => insp.checkpoint()}
        onScrub={(v) => insp.setTransient({ [prop]: v })}
        scrubFrom={scrubFrom}
        convert={units.length > 1 ? unitConverter(prop) : undefined}
      />
    </div>
  );
}

/* ---------- テキストフィールド ---------- */

export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string | undefined;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      key={value ?? "_"}
      className="input"
      defaultValue={value ?? ""}
      placeholder={placeholder ?? tr("未設定")}
      onBlur={(e) => {
        const v = e.target.value.trim();
        // 触っただけなら書き込まない
        if (v === (value ?? "").trim()) return;
        onChange(v || null);
      }}
      onKeyDown={(e) => {
        if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/* ---------- 確定（blur）で書き込む入力欄 ---------- */

/**
 * blur で確定する入力欄を、外での変更（元に戻す・レイヤーでの名前変更・他の編集者の変更）に
 * 合わせて表示し直す。入力中（フォーカス中）は書き換えない。
 * 確定した値が整形された・空欄を取り消したときも、書き込まれた値を表示し直す
 */
function useCommitSync<T extends HTMLInputElement | HTMLTextAreaElement>(value: string) {
  const ref = useRef<T>(null);
  const latest = useRef(value);
  latest.current = value;
  const sync = () => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.value !== latest.current) {
      el.value = latest.current;
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => sync(), [value]);
  return { ref, afterCommit: () => requestAnimationFrame(sync) };
}

type CommitProps<T> = {
  value: string;
  onCommit: (v: string) => void;
} & Omit<T, "value" | "defaultValue" | "onBlur">;

/** blur（Enter などで外す）で値を確定する入力欄。表示は value に追従する */
export function CommitInput({
  value,
  onCommit,
  ...rest
}: CommitProps<InputHTMLAttributes<HTMLInputElement>>) {
  const { ref, afterCommit } = useCommitSync<HTMLInputElement>(value);
  return (
    <input
      {...rest}
      ref={ref}
      defaultValue={value}
      onBlur={(e) => {
        onCommit(e.target.value);
        afterCommit();
      }}
    />
  );
}

/** blur で値を確定する複数行の入力欄。表示は value に追従する */
export function CommitTextarea({
  value,
  onCommit,
  ...rest
}: CommitProps<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  const { ref, afterCommit } = useCommitSync<HTMLTextAreaElement>(value);
  return (
    <textarea
      {...rest}
      ref={ref}
      defaultValue={value}
      onBlur={(e) => {
        onCommit(e.target.value);
        afterCommit();
      }}
    />
  );
}

/* ---------- {変数} 予測変換 ---------- */

/** 変数一覧を開くショートカットの表記（glyphs で Mac 以外は Ctrl+/ になる） */
export const VAR_LIST_KBD = "⌘/";

export interface VarSuggest {
  pos: CSSProperties;
  query: VarQuery;
  matches: string[];
  index: number;
  /** 末尾に「変数を探す」を出す（index === matches.length で選択中） */
  explore?: boolean;
}

/** 候補の上下移動 */
export function moveVarSuggest(s: VarSuggest, dir: 1 | -1): VarSuggest {
  const n = s.matches.length + (s.explore ? 1 : 0);
  return { ...s, index: (s.index + dir + n) % n };
}

/** 確定する候補の変数名（null = 「変数を探す」を選んでいる） */
export function pickedVar(s: VarSuggest): string | null {
  return s.matches[s.index] ?? null;
}

/**
 * 候補メニューを出すか。「{」や一覧のショートカットでは、候補が無くても
 * 「変数を探す」を出す
 */
export function shouldShowVarSuggest(q: VarQuery | null, matches: string[], explore: boolean) {
  return !!q && (matches.length > 0 || (explore && q.mode !== "word"));
}

/** 候補を確定するキーか（「{」なしの予測変換は Enter を改行・確定に残し Tab のみ） */
export function isVarAcceptKey(s: VarSuggest, key: string): boolean {
  return key === "Tab" || (key === "Enter" && s.query.mode !== "word");
}

/**
 * 基準の矩形に付けて出すメニューの位置。下に入らなければ広い方（上 / 下）に出し、
 * 高さはそちら側の空きまでに抑えて画面からはみ出さないようにする
 */
export function anchoredMenuPos(
  r: { left: number; top: number; bottom: number },
  width: number,
  height: number,
  /** false = height は上下を決めるだけに使い、高さは空きまで許す（中身の高さに任せる） */
  capToHeight = true
): CSSProperties {
  const margin = 8;
  const gap = 4;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - r.bottom - gap - margin;
  const spaceAbove = r.top - gap - margin;
  const below = spaceBelow >= height || spaceBelow >= spaceAbove;
  const w = Math.min(width, vw - margin * 2);
  return {
    left: Math.max(margin, Math.min(r.left, vw - w - margin)),
    width: w,
    maxHeight: Math.max(0, Math.min(capToHeight ? height : Infinity, below ? spaceBelow : spaceAbove)),
    ...(below ? { top: r.bottom + gap } : { bottom: vh - r.top + gap }),
  };
}

/** 候補メニューの位置（基準の矩形の下、入らなければ上） */
export function varSuggestPos(
  r: { left: number; top: number; bottom: number },
  count: number,
  width = 240
): CSSProperties {
  // 一覧（CSS で最大 256px）と、見出し・「変数を探す」・操作の案内。
  // 見積もりは上下を決めるだけに使い、高さは中身に任せる（見積もりで一覧を縮めない）
  return anchoredMenuPos(r, width, Math.min(count * 32, 256) + 96, false);
}

/** 変数の候補メニュー（キャンバスのテキスト編集・VarInput 共用） */
export function VarSuggestMenu({
  suggest,
  samples,
  onPick,
  onExplore,
  menuRef,
}: {
  suggest: VarSuggest;
  samples?: Record<string, string>;
  onPick: (name: string) => void;
  /** 「変数を探す」を押したとき */
  onExplore?: () => void;
  menuRef?: Ref<HTMLDivElement>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const { query, matches, index } = suggest;

  useEffect(() => {
    const el =
      (listRef.current?.children[index] as HTMLElement | undefined) ??
      listRef.current?.parentElement?.querySelector<HTMLElement>(".var-comp-explore");
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const mark = (name: string) => {
    const p = query.partial.toLowerCase();
    const at = p ? name.toLowerCase().indexOf(p) : -1;
    if (at < 0) return name;
    return (
      <>
        {name.slice(0, at)}
        <b>{name.slice(at, at + p.length)}</b>
        {name.slice(at + p.length)}
      </>
    );
  };

  // 拡大縮小（CSS zoom）された中でも位置がずれないよう、body 直下に出す
  return createPortal(
    <div
      ref={menuRef}
      className="dd-menu var-comp"
      style={suggest.pos}
      // スクリプト画面の Esc（画面を閉じる）より先に、この候補を閉じさせる
      data-se-popover=""
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="var-comp-head">
        {query.mode === "manual" ? tr("変数") : tr("変数の候補")}
      </div>
      {!matches.length && (
        <div className="var-comp-none">
          {query.partial ? tr("「{partial}」に一致する変数はありません", { partial: query.partial }) : tr("この位置で使える変数はありません")}
        </div>
      )}
      <div ref={listRef} className="var-comp-list">
        {matches.map((name, i) => (
          <button
            key={name}
            type="button"
            className={`dd-item${i === index ? " is-sel-key" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(name);
            }}
          >
            <span className="var-chip">{mark(name)}</span>
            {samples?.[name] && <span className="var-comp-sample">{samples[name]}</span>}
          </button>
        ))}
      </div>
      {onExplore && suggest.explore && (
        <button
          type="button"
          className={`dd-item var-comp-explore${index === matches.length ? " is-sel-key" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onExplore();
          }}
        >
          <Search size={13} />
          <span>{tr("変数を探す…")}</span>
          <span className="var-comp-sample">{tr("値を見ながら選ぶ")}</span>
        </button>
      )}
      <div className="var-comp-foot">
        <span>
          <kbd>{glyphs("↑")}</kbd>
          <kbd>{glyphs("↓")}</kbd> {tr("選択")}
        </span>
        <span>
          <kbd>{query.mode === "word" ? "Tab" : "Enter"}</kbd> {tr("挿入")}
        </span>
        <span>
          <kbd>{glyphs(VAR_LIST_KBD)}</kbd> {tr("一覧")}
        </span>
      </div>
    </div>,
    document.body
  );
}

/* ---------- {変数} 予測変換つきテキスト入力 ---------- */

export function VarInput({
  value,
  onCommit,
  placeholder,
  names,
  samples,
  nodeId,
  eager,
  extraNames,
  className,
  style,
}: {
  value: string;
  /** blur時に確定（Enterでもblurする） */
  onCommit: (v: string) => void;
  placeholder?: string;
  /** 補完する変数名の候補 */
  names: string[];
  /** 候補に添える値の見本 */
  samples?: Record<string, string>;
  /** 指定すると候補の末尾に「変数を探す」を出す（この要素の位置で使える変数を見せる） */
  nodeId?: string;
  /** 「{」を入れなくても、入力中の語やフォーカス時に候補を出す */
  eager?: boolean;
  /** 「変数を探す」に足す、見本の無い変数（スクリプトで作る変数など） */
  extraNames?: string[];
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sug, setSug] = useState<VarSuggest | null>(null);
  /** 「変数を探す」で置き換える範囲（開いている間は blur で確定しない） */
  const [explore, setExplore] = useState<{ start: number; end: number } | null>(null);

  const explorable = nodeId !== undefined;
  const update = (manual = false) => {
    const el = ref.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart ?? 0);
    let query = findVarQuery(before, names, manual && !eager);
    if (eager && (!query || query.mode === "word")) {
      // 「{」なし: 入力中の語の途中まで一致する変数（空欄・ショートカットなら一覧）を出す
      const q = findVarQuery(before, names, true);
      if (q && (q.partial || !el.value || manual)) query = q;
    }
    const matches = query ? matchVarNames(names, query).slice(0, 50) : [];
    const show =
      !!query &&
      (eager && query.mode === "manual" && query.partial
        ? matches.length > 0
        : shouldShowVarSuggest(query, matches, explorable));
    if (!query || !show) {
      setSug(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setSug({
      pos: varSuggestPos(r, matches.length + (explorable ? 1 : 0), Math.max(r.width, 240)),
      query,
      matches,
      index: 0,
      explore: explorable,
    });
  };

  const replace = (start: number, end: number, name: string) => {
    const el = ref.current;
    if (!el) return;
    el.value = el.value.slice(0, start) + `{${name}}` + el.value.slice(end);
    const caret = start + name.length + 2;
    el.focus();
    el.setSelectionRange(caret, caret);
  };

  const insert = (name: string) => {
    const el = ref.current;
    if (!el || !sug) return;
    const pos = el.selectionStart ?? el.value.length;
    replace(Math.min(sug.query.start, pos), varQueryEnd(el.value, sug.query, pos), name);
    setSug(null);
  };

  const openExplore = () => {
    const el = ref.current;
    if (!el || !sug) return;
    const pos = el.selectionStart ?? el.value.length;
    setExplore({ start: Math.min(sug.query.start, pos), end: varQueryEnd(el.value, sug.query, pos) });
    setSug(null);
  };

  const open = !!sug;
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setSug(null);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <input
        ref={ref}
        className={className ?? "input"}
        style={style}
        defaultValue={value}
        placeholder={placeholder}
        onFocus={() => {
          // 「{」なしで出すときは、フォーカスした時点で候補を見せる（空欄なら一覧）
          if (eager && !explore) requestAnimationFrame(() => update());
        }}
        onInput={(e) => {
          if ((e.nativeEvent as InputEvent).isComposing) return;
          update(!eager && sug?.query.mode === "manual");
        }}
        onCompositionEnd={() => update(!eager && sug?.query.mode === "manual")}
        onBlur={(e) => {
          setSug(null);
          if (!explore) onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (isVarListShortcut(e)) {
            e.preventDefault();
            update(true);
            return;
          }
          if (sug) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSug((p) => p && moveVarSuggest(p, e.key === "ArrowDown" ? 1 : -1));
              return;
            }
            if (isVarAcceptKey(sug, e.key)) {
              e.preventDefault();
              const name = pickedVar(sug);
              if (name) insert(name);
              else openExplore();
              return;
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setSug(null);
              return;
            }
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") setSug(null);
          }
          if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
        }}
      />
      {sug && (
        <VarSuggestMenu
          suggest={sug}
          samples={samples}
          onPick={insert}
          onExplore={openExplore}
          menuRef={menuRef}
        />
      )}
      {explore && nodeId !== undefined && (
        <VarExplorer
          nodeId={nodeId}
          extraNames={extraNames}
          onPick={(name) => {
            replace(explore.start, explore.end, name);
            setExplore(null);
          }}
          onClose={() => {
            setExplore(null);
            const el = ref.current;
            el?.focus();
            el?.setSelectionRange(explore.end, explore.end);
          }}
        />
      )}
    </>
  );
}

/* ---------- ドロップダウン（オリジナルUI） ---------- */

export interface DdOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  desc?: string;
  labelStyle?: CSSProperties;
}

export function Dropdown({
  value,
  options,
  onChange,
  placeholder = tr("未設定"),
  style,
  menuWidth,
  trigger,
  title,
}: {
  value: string | undefined;
  options: DdOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  style?: CSSProperties;
  menuWidth?: number;
  /** 通常の選択欄ではなく、アイコン等を開閉ボタンとして使う */
  trigger?: ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});

  const selected = options.find((o) => o.value === (value ?? ""));

  // 開いたらボタン位置からメニューを固定配置（下に収まらなければ上へ）
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const estH = Math.min(
      320,
      options.reduce((h, o) => h + (o.desc ? 44 : 32), 16)
    );
    // 見積もりは上下どちらに出すかの判定だけに使い、高さは中身に任せる（見積もりより項目が高いと最後が切れるため）
    setPos(anchoredMenuPos(r, menuWidth ?? Math.max(r.width, 160), estH, false));
  }, [open, options, menuWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${trigger ? "icon-btn sm" : "dd"}${open ? " is-open" : ""}`}
        style={style}
        data-tip={title}
        aria-label={title}
        onClick={() => setOpen(!open)}
      >
        {trigger ?? (
          <>
            {selected?.icon && <span className="dd-icon">{selected.icon}</span>}
            <span
              className="dd-label"
              style={{
                ...selected?.labelStyle,
                color: selected ? undefined : "var(--text-3)",
              }}
            >
              {selected ? selected.label : placeholder}
            </span>
            <ChevronDown size={12} className="dd-chev" strokeWidth={1.6} />
          </>
        )}
      </button>
      {open && (
        <div ref={menuRef} className="dd-menu" style={pos}>
          {options.map((o) => {
            const isSel = o.value === (value ?? "");
            return (
              <button
                key={o.value}
                type="button"
                className={`dd-item${o.desc ? " tall" : ""}${isSel ? " is-sel" : ""}`}
                onClick={() => {
                  // 選択による親側の再描画より先にメニューを閉じる。
                  // 親が選択結果に応じて構造を変える場合でも、開いたメニューの
                  // DOM と React の削除処理が競合しないようにする。
                  setOpen(false);
                  onChange(o.value);
                }}
              >
                <span className="dd-check">
                  {isSel && <Check size={12} strokeWidth={2} />}
                </span>
                {o.icon && <span className="dd-icon">{o.icon}</span>}
                {o.desc ? (
                  <span className="dd-col">
                    <span style={o.labelStyle}>{o.label}</span>
                    <span className="dd-desc">{o.desc}</span>
                  </span>
                ) : (
                  <span className="dd-col" style={o.labelStyle}>
                    {o.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** インスペクタ連携版（先頭に「未設定」を付ける） */
export function PropSelect({
  prop,
  options,
  unsetLabel = tr("未設定"),
  menuWidth,
}: {
  prop: string;
  options: DdOption[];
  unsetLabel?: string;
  menuWidth?: number;
}) {
  const insp = useInspector();
  const info = insp.get(prop);
  return (
    <Dropdown
      value={info.value ?? ""}
      options={[{ value: "", label: unsetLabel }, ...options]}
      onChange={(v) => insp.set({ [prop]: v || null })}
      menuWidth={menuWidth}
    />
  );
}

/* ---------- セグメント ---------- */

export function Seg({
  value,
  options,
  onChange,
  full = true,
}: {
  value: string | undefined;
  options: { label: ReactNode; value: string; title?: string }[];
  onChange: (v: string) => void;
  full?: boolean;
}) {
  return (
    <div className={`seg${full ? " seg-full" : ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-tip={o.title}
          className={value === o.value ? "is-on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PropSeg({
  prop,
  options,
  allowUnset = true,
}: {
  prop: string;
  options: { label: ReactNode; value: string; title?: string }[];
  allowUnset?: boolean;
}) {
  const insp = useInspector();
  const info = insp.get(prop);
  return (
    <Seg
      value={info.value}
      options={options}
      onChange={(v) => {
        // 選択中のものを押すと解除（この画面幅・状態で設定したものだけ。受け継いだ値はそのまま）
        if (v === info.value) {
          if (allowUnset && info.setHere) insp.set({ [prop]: null });
          return;
        }
        insp.set({ [prop]: v });
      }}
    />
  );
}

/* ---------- カラー ---------- */

export function parseColor(v: string | undefined): { hex: string; alpha: number } {
  if (!v) return { hex: "#000000", alpha: 1 };
  const hexm = /^#([0-9a-f]{6})$/i.exec(v.trim());
  if (hexm) return { hex: `#${hexm[1]}`, alpha: 1 };
  const short = /^#([0-9a-f]{3})$/i.exec(v.trim());
  if (short) {
    const [r, g, b] = short[1].split("");
    return { hex: `#${r}${r}${g}${g}${b}${b}`, alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)$/.exec(
    v.trim()
  );
  if (rgba) {
    const to2 = (n: number) => n.toString(16).padStart(2, "0");
    return {
      hex: `#${to2(+rgba[1])}${to2(+rgba[2])}${to2(+rgba[3])}`,
      alpha: rgba[4] !== undefined ? parseFloat(rgba[4]) : 1,
    };
  }
  return { hex: "#000000", alpha: 1 };
}

export function composeColor(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

/* ---------- 最近使った色 ---------- */

const RECENT_COLORS_KEY = "recent-colors-v1";
const RECENT_COLORS_MAX = 14;
const EMPTY_COLOR_PALETTE: readonly string[] = [];

export function getRecentColors(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_COLORS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function pushRecentColor(color: string): void {
  const c = color.trim();
  if (!c) return;
  try {
    const list = [c, ...getRecentColors().filter((x) => x !== c)].slice(
      0,
      RECENT_COLORS_MAX
    );
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list));
  } catch {
    return;
  }
}

/** Figmaの塗り行：スウォッチ + HEX + 不透明度% */
export function FillControl({
  value,
  onChange,
  onChangeStart,
  onChangeTransient,
  allowClear = true,
}: {
  value: string | undefined;
  onChange: (v: string | null) => void;
  /** ピッカー・不透明度スライダーの連続変更を1回の履歴にまとめる */
  onChangeStart?: () => void;
  onChangeTransient?: (v: string | null) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const palette =
    useEditor((s) => s.doc.colorPalette) ?? EMPTY_COLOR_PALETTE;
  const updateDoc = useEditor((s) => s.updateDoc);
  const ref = useRef<HTMLDivElement>(null);
  const { hex, alpha } = parseColor(value);
  const isSet = value !== undefined;
  // ピッカーを閉じたとき、その時点の色を「最近使った色」に記録する
  const latest = useRef<string | undefined>(value);
  const changing = useRef(false);
  latest.current = value;

  const changeContinuously = (next: string) => {
    if (!changing.current) {
      changing.current = true;
      onChangeStart?.();
    }
    (onChangeTransient ?? onChange)(next);
  };

  const finishContinuousChange = () => {
    changing.current = false;
  };

  const addToPalette = () => {
    if (!value) return;
    updateDoc((doc) => {
      const current = doc.colorPalette ?? [];
      if (!current.includes(value)) doc.colorPalette = [...current, value];
    });
  };

  const removeFromPalette = (color: string) => {
    updateDoc((doc) => {
      doc.colorPalette = (doc.colorPalette ?? []).filter((c) => c !== color);
    });
  };

  useEffect(() => {
    if (!open) return;
    setRecent(getRecentColors());
    const close = () => {
      if (latest.current) pushRecentColor(latest.current);
      setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="fill-row" ref={ref}>
      <div className="fill-main">
        <button
          type="button"
          className="color-swatch"
          style={{ ["--sw" as string]: value ?? "transparent" }}
          onClick={() => setOpen(!open)}
          data-tip={value ?? tr("未設定")}
        />
        <input
          key={value ?? "_"}
          defaultValue={isSet ? hex.slice(1) : ""}
          placeholder={tr("未設定")}
          onBlur={(e) => {
            const t = e.target.value.trim().replace(/^#/, "");
            // 触っただけなら書き込まない（名前付きの色・透明などが黒に変わらないように）
            if (t === (isSet ? hex.slice(1) : "")) return;
            if (t === "") {
              if (allowClear) onChange(null);
              return;
            }
            let next: string | null = null;
            if (/^[0-9a-f]{6}$/i.test(t)) next = composeColor(`#${t}`, alpha);
            else if (/^[0-9a-f]{3}$/i.test(t))
              next = composeColor(parseColor(`#${t}`).hex, alpha);
            if (next) {
              onChange(next);
              pushRecentColor(next);
            }
          }}
          onKeyDown={(e) => {
            if (isEnterKey(e)) (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="fill-alpha">
        <NumField
          value={isSet ? `${Math.round(alpha * 100)}%` : undefined}
          units={["%"]}
          min={0}
          max={100}
          placeholder="100"
          onChange={(v) => {
            const n = v ? (parseNumeric(v)?.num ?? 100) : 100;
            onChange(composeColor(hex, Math.max(0, Math.min(100, n)) / 100));
          }}
        />
      </div>
      {open && (
        <div className="color-pop">
          <input
            type="color"
            value={hex}
            onChange={(e) =>
              changeContinuously(composeColor(e.target.value, alpha))
            }
            onBlur={finishContinuousChange}
          />
          <input
            type="range"
            className="range"
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            onChange={(e) =>
              changeContinuously(composeColor(hex, +e.target.value / 100))
            }
            onPointerUp={finishContinuousChange}
            onBlur={finishContinuousChange}
          />
          <div className="saved-colors">
            <div className="saved-colors-head">
              <span className="grp-label">{tr("カラーパレット")}</span>
              <button
                type="button"
                className="icon-btn sm"
                disabled={!value || palette.includes(value)}
                data-tip={tr("現在の色を登録")}
                onClick={addToPalette}
              >
                <Plus size={12} />
              </button>
            </div>
            {palette.length > 0 ? (
              <div className="saved-colors-grid">
                {palette.map((c) => (
                  <div className="saved-color-wrap" key={c}>
                    <button
                      type="button"
                      className="recent-color"
                      style={{ ["--sw" as string]: c }}
                      data-tip={c}
                      onClick={() => {
                        onChange(c);
                        pushRecentColor(c);
                        setOpen(false);
                      }}
                    />
                    <button
                      type="button"
                      className="saved-color-remove"
                      data-tip={tr("登録色を削除")}
                      onClick={() => removeFromPalette(c)}
                      aria-label={tr("{c}を削除", { c })}
                    >
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <span className="saved-colors-empty">
                {tr("＋で現在の色を登録できます")}
              </span>
            )}
          </div>
          {recent.length > 0 && (
            <div className="recent-colors">
              <span className="grp-label">{tr("最近使った色")}</span>
              <div className="recent-colors-grid">
                {recent.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="recent-color"
                    style={{ ["--sw" as string]: c }}
                    data-tip={c}
                    onClick={() => {
                      onChange(c);
                      pushRecentColor(c);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {allowClear && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {tr("クリア")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PropFill({
  label,
  info: tip,
  prop,
  allowClear = true,
  dflt,
}: {
  label?: string;
  /** ラベル横の「i」にホバーで出す説明 */
  info?: string;
  prop: string;
  allowClear?: boolean;
  /** 上位が未設定のときに比べる値（ほかの設定と一緒にパネルが入れる色。線の太さと一緒に入る線の色など） */
  dflt?: string;
}) {
  const insp = useInspector();
  const info = insp.get(prop);
  const changed =
    dflt !== undefined && info.baseline === undefined
      ? info.setHere && !sameValue(info.value, dflt)
      : info.changed;
  return (
    <Grp
      label={label}
      info={tip}
      setHere={changed}
      onReset={() => insp.set({ [prop]: null })}
    >
      <FillControl
        value={info.value}
        allowClear={allowClear}
        onChange={(v) => insp.set({ [prop]: v ?? insp.cleared(prop) })}
        onChangeStart={insp.checkpoint}
        onChangeTransient={(v) => insp.setTransient({ [prop]: v })}
      />
    </Grp>
  );
}

/* ---------- 4方向（余白）/ 4隅（角丸） ---------- */

/** CSSショートハンド（1〜4値）から i 番目（上右下左）の値を取り出す */
export function shorthandSide(
  sh: string | undefined,
  i: number
): string | undefined {
  if (!sh) return undefined;
  const p = sh.trim().split(/\s+/);
  if (p.length === 1) return p[0];
  if (p.length === 2) return i % 2 === 0 ? p[0] : p[1];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]][i];
  if (p.length === 4) return p[i];
  return undefined;
}

/* ---------- 3x3 配置グリッド ---------- */

const POS_VALUES = ["flex-start", "center", "flex-end"];
/** 配置グリッドの各マスの名前（[縦][横]） */
const POS_NAMES = [
  [tr("左上"), tr("上中央"), tr("右上")],
  [tr("左中央"), tr("中央"), tr("右中央")],
  [tr("左下"), tr("下中央"), tr("右下")],
];

export function AlignGrid({ isColumn }: { isColumn: boolean }) {
  const insp = useInspector();
  const justify = insp.get("justifyContent").value ?? "flex-start";
  const align = insp.get("alignItems").value ?? "stretch";

  const cells = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const j = POS_VALUES[isColumn ? y : x];
      const a = POS_VALUES[isColumn ? x : y];
      const on =
        (justify === j || (justify.startsWith("space") && j === "center")) &&
        align === a;
      // 3本線グリフ: 縦フローは横線を積む（横位置=align）、横フローは縦線を並べる
      const glyphStyle: CSSProperties = isColumn
        ? { flexDirection: "column", alignItems: POS_VALUES[x] }
        : { flexDirection: "row", alignItems: POS_VALUES[y] };
      cells.push(
        <button
          key={`${x}-${y}`}
          type="button"
          className={on ? "is-on" : ""}
          data-tip={
            on
              ? tr("{pos}に揃える（もう一度押すと解除）", { pos: POS_NAMES[y][x] })
              : tr("{pos}に揃える", { pos: POS_NAMES[y][x] })
          }
          aria-pressed={on}
          onClick={() =>
            // 選んでいる位置をもう一度押すと解除する（「間隔」の均等配置は残す）
            on
              ? insp.set({
                  justifyContent: justify.startsWith("space") ? justify : insp.cleared("justifyContent"),
                  alignItems: insp.cleared("alignItems"),
                })
              : insp.set({
                  justifyContent: justify.startsWith("space") ? justify : j,
                  alignItems: a,
                })
          }
        >
          <span className="ag-glyph" style={glyphStyle}>
            <i />
            <i />
            <i />
          </span>
        </button>
      );
    }
  }

  return (
    <div className={`align-grid${isColumn ? "" : " is-row"}`}>{cells}</div>
  );
}
