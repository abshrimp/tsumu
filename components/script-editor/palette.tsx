"use client";

/**
 * スクリプト画面のブロックの分類・アイコン・色と、パレットに並べるブロックの一覧
 */

import { type CSSProperties } from "react";
import {
  ArrowDownToLine,
  ArrowUpDown,
  Ban,
  Calculator,
  ClipboardCopy,
  CloudDownload,
  Combine,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Funnel,
  FunnelX,
  Hash,
  ListPlus,
  ListChecks,
  LogOut,
  MousePointer2,
  MousePointerClick,
  PenLine,
  Repeat,
  IterationCw,
  Save,
  ScanEye,
  Replace,
  Scissors,
  Split,
  TextSearch,
  TextCursorInput,
  Timer,
  ToggleRight,
  Variable,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { scriptUid, TRIGGER_LABELS, TRIGGER_ORDER, type PageScript } from "../../lib/script";
import { type ScriptStep, type ScriptTrigger } from "../../lib/types";
import { tr, trc } from "../../lib/i18n";
import { type Loc } from "./step-tree";

/* ---------- ブロックの分類 ---------- */

type Cat = "event" | "load" | "look" | "move" | "input" | "var" | "array" | "store" | "control";

export const CAT_INFO: Record<Cat, { label: string; color: string }> = {
  event: { label: tr("きっかけ"), color: "#d97706" },
  load: { label: tr("データ"), color: "#059669" },
  look: { label: trc("ブロックの分類", "表示"), color: "#7c3aed" },
  move: { label: tr("移動"), color: "#0d99ff" },
  input: { label: tr("入力"), color: "#0f766e" },
  var: { label: tr("変数"), color: "#0891b2" },
  array: { label: tr("配列"), color: "#db2777" },
  store: { label: tr("ストレージ"), color: "#4f46e5" },
  control: { label: tr("制御"), color: "#52525b" },
};
export const CAT_ORDER: Cat[] = ["event", "look", "move", "input", "var", "load", "array", "store", "control"];

export const CAT_OF: Record<ScriptStep["kind"], Cat> = {
  show: "look",
  hide: "look",
  toggle: "look",
  "open-page": "move",
  "open-url": "move",
  "scroll-to": "move",
  "set-value": "input",
  "set-enabled": "input",
  fetch: "load",
  split: "array",
  "array-find": "array",
  "array-field": "array",
  join: "array",
  count: "array",
  copy: "input",
  "list-edit": "var",
  "set-var": "var",
  calc: "var",
  replace: "var",
  repeat: "control",
  "for-each": "array",
  "filter-array": "array",
  "unfilter-array": "array",
  "sort-array": "array",
  "store-save": "store",
  "store-load": "store",
  wait: "control",
  if: "control",
};

export const TRIGGER_ICON: Record<ScriptTrigger, LucideIcon> = {
  click: MousePointerClick,
  "hover-start": MousePointer2,
  "hover-end": LogOut,
  change: TextCursorInput,
  load: Zap,
  "in-view": ScanEye,
};

export const STEP_ICON: Record<ScriptStep["kind"], LucideIcon> = {
  show: Eye,
  hide: EyeOff,
  toggle: ToggleRight,
  "open-page": FileText,
  "open-url": ExternalLink,
  "scroll-to": ArrowDownToLine,
  "set-value": PenLine,
  "set-enabled": Ban,
  fetch: CloudDownload,
  split: Scissors,
  "array-find": TextSearch,
  "array-field": ListPlus,
  join: Combine,
  count: Hash,
  copy: ClipboardCopy,
  "list-edit": ListChecks,
  "set-var": Variable,
  calc: Calculator,
  replace: Replace,
  repeat: Repeat,
  "for-each": IterationCw,
  "filter-array": Funnel,
  "unfilter-array": FunnelX,
  "sort-array": ArrowUpDown,
  "store-save": Save,
  "store-load": FolderOpen,
  wait: Timer,
  if: Split,
};

export function Ico({ icon: I, cat }: { icon: LucideIcon; cat: Cat }) {
  return (
    <span className="se-ico" style={colorVar(cat)}>
      <I size={13} strokeWidth={2} />
    </span>
  );
}

function colorVar(cat: Cat): CSSProperties {
  return { "--blk": CAT_INFO[cat].color } as CSSProperties;
}

export type Payload =
  | { type: "trigger"; trigger: ScriptTrigger }
  | { type: "steps"; steps: ScriptStep[]; from?: Loc }
  /** group: 一緒に動かす選択中のスクリプト（script を含む） */
  | { type: "script"; script: PageScript; group: PageScript[] };

interface PaletteItem {
  key: string;
  cat: Cat;
  icon: LucideIcon;
  /** ［］で囲んだ部分は入力欄として表示する */
  label: string;
  make: () => Payload;
}

const st = () => scriptUid("st");
const one = (step: ScriptStep): Payload => ({ type: "steps", steps: [step] });

export const PALETTE: PaletteItem[] = [
  ...TRIGGER_ORDER.map<PaletteItem>((t) => ({
    key: t,
    cat: "event",
    icon: TRIGGER_ICON[t],
    label: TRIGGER_LABELS[t],
    make: () => ({ type: "trigger", trigger: t }),
  })),
  {
    key: "fetch",
    cat: "load",
    icon: CloudDownload,
    label: tr("［URL］のデータを取得して［名前］とする"),
    make: () => one({ id: st(), kind: "fetch", url: "" }),
  },
  {
    key: "show",
    cat: "look",
    icon: Eye,
    label: tr("［要素］を［表示する / 隠す / 切り替える］"),
    make: () => one({ id: st(), kind: "show", target: "" }),
  },
  {
    key: "open-page",
    cat: "move",
    icon: FileText,
    label: tr("［ページ / URL］を開く"),
    make: () => one({ id: st(), kind: "open-page", pageId: "" }),
  },
  {
    key: "scroll-to",
    cat: "move",
    icon: ArrowDownToLine,
    label: tr("［要素］までスクロールする"),
    make: () => one({ id: st(), kind: "scroll-to", target: "" }),
  },
  {
    key: "set-value",
    cat: "input",
    icon: PenLine,
    label: tr("［入力欄］に［値］を入れる"),
    make: () => one({ id: st(), kind: "set-value", target: "", value: "" }),
  },
  {
    key: "set-enabled",
    cat: "input",
    icon: Ban,
    label: tr("［入力欄］を［有効にする / 無効にする］"),
    make: () => one({ id: st(), kind: "set-enabled", target: "", op: "disable" }),
  },
  {
    key: "split",
    cat: "array",
    icon: Scissors,
    label: tr("文字列［］を［,］で分解して配列［］とする"),
    make: () => one({ id: st(), kind: "split", source: "", sep: ",", into: "" }),
  },
  {
    key: "join",
    cat: "array",
    icon: Combine,
    label: tr("配列［］を［、］でつないで変数［］とする"),
    make: () => one({ id: st(), kind: "join", array: "", sep: "、", into: "" }),
  },
  {
    key: "count",
    cat: "array",
    icon: Hash,
    label: tr("配列［］の件数を変数［］とする"),
    make: () => one({ id: st(), kind: "count", array: "", into: "" }),
  },
  {
    key: "array-find",
    cat: "array",
    icon: TextSearch,
    label: tr("配列［］の要素のうち、項目［］が［値］のものを変数［］とする"),
    make: () =>
      one({ id: st(), kind: "array-find", array: "", field: "", value: "{slug}", into: "" }),
  },
  {
    key: "array-field",
    cat: "array",
    icon: ListPlus,
    label: tr("配列［］の［…］を項目［］として格納する"),
    make: () => one({ id: st(), kind: "array-field", array: "", value: "", field: "" }),
  },
  {
    key: "for-each",
    cat: "array",
    icon: IterationCw,
    label: tr("配列［］の要素ごとにくり返す"),
    make: () => one({ id: st(), kind: "for-each", array: "", then: [] }),
  },
  {
    key: "filter-array",
    cat: "array",
    icon: Funnel,
    label: tr("配列［］を［項目］で絞り込む"),
    make: () =>
      one({
        id: st(),
        kind: "filter-array",
        array: "",
        field: "",
        op: "eq",
        value: "",
      }),
  },
  {
    key: "unfilter-array",
    cat: "array",
    icon: FunnelX,
    label: tr("配列［］の絞り込みを解除する"),
    make: () => one({ id: st(), kind: "unfilter-array", array: "" }),
  },
  {
    key: "sort-array",
    cat: "array",
    icon: ArrowUpDown,
    label: tr("配列［］を［項目］の［小さい順］に並べ替える"),
    make: () => one({ id: st(), kind: "sort-array", array: "", field: "", dir: "asc" }),
  },
  {
    key: "store-save",
    cat: "store",
    icon: Save,
    label: tr("ストレージの［キー］に［値］を保存する"),
    make: () => one({ id: st(), kind: "store-save", key: "", value: "" }),
  },
  {
    key: "store-load",
    cat: "store",
    icon: FolderOpen,
    label: tr("ストレージの［キー］を読み込んで変数［］とする"),
    make: () => one({ id: st(), kind: "store-load", key: "", into: "" }),
  },
  {
    key: "set-var",
    cat: "var",
    icon: Variable,
    label: tr("［値 / {データ.位置}］を変数［］とする"),
    make: () => one({ id: st(), kind: "set-var", value: "", into: "" }),
  },
  {
    key: "calc",
    cat: "var",
    icon: Calculator,
    label: tr("［{数} + 1］を計算して変数［］とする"),
    make: () => one({ id: st(), kind: "calc", expr: "", into: "" }),
  },
  {
    key: "replace",
    cat: "var",
    icon: Replace,
    label: tr("［文字］の［A］を［B］に置き換えて変数［］とする"),
    make: () => one({ id: st(), kind: "replace", source: "", find: "", to: "", into: "" }),
  },
  {
    key: "list-edit",
    cat: "var",
    icon: ListChecks,
    label: tr("変数［］の［.］区切りに［値］を［切り替える］"),
    make: () =>
      one({ id: st(), kind: "list-edit", into: "", op: "toggle", value: "", sep: "." }),
  },
  {
    key: "copy",
    cat: "input",
    icon: ClipboardCopy,
    label: tr("［文字］をコピーする"),
    make: () => one({ id: st(), kind: "copy", value: "" }),
  },
  {
    key: "wait",
    cat: "control",
    icon: Timer,
    label: tr("［1］秒待つ"),
    make: () => one({ id: st(), kind: "wait", seconds: 1 }),
  },
  {
    key: "if",
    cat: "control",
    icon: Split,
    label: tr("もし［条件］なら（でなければ）"),
    make: () =>
      one({
        id: st(),
        kind: "if",
        cond: { subject: "value", target: "", op: "eq", value: "" },
        then: [],
      }),
  },
  {
    key: "repeat",
    cat: "control",
    icon: Repeat,
    label: tr("［3］回くり返す"),
    make: () => one({ id: st(), kind: "repeat", times: 3, then: [] }),
  },
];
