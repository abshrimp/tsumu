"use client";

/**
 * スクリプトの画面のブロックの分類・アイコン・色と、パレットに並べるブロックの一覧
 */

import { type CSSProperties } from "react";
import {
  ArrowDownToLine,
  MessageSquareWarning,
  Ban,
  ClipboardCopy,
  CloudDownload,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Funnel,
  LogOut,
  MousePointer2,
  MousePointerClick,
  PenLine,
  Repeat,
  IterationCw,
  ListMinus,
  ListPlus,
  Save,
  ScanEye,
  Split,
  TextCursorInput,
  Timer,
  ToggleRight,
  Palette,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { scriptUid, TRIGGER_LABELS, TRIGGER_ORDER, type PageScript } from "../../lib/script";
import { type ScriptStep, type ScriptTrigger } from "../../lib/types";
import { getLang, tr, trc } from "../../lib/i18n";
import { searchTermsFor } from "../../lib/locales/search-terms";
import type { Lang } from "../../lib/lang";
import { type Loc } from "./step-tree";

/* ---------- ブロックの分類 ---------- */

type Cat = "event" | "load" | "look" | "move" | "input" | "var" | "array" | "store" | "control";

export const CAT_INFO: Record<Cat, { label: string; color: string }> = {
  event: { label: tr("Triggers"), color: "#d97706" },
  load: { label: tr("Data"), color: "#059669" },
  look: { label: trc("block_category", "Looks"), color: "#7c3aed" },
  move: { label: tr("Navigation"), color: "#0d99ff" },
  input: { label: tr("Input"), color: "#0f766e" },
  var: { label: tr("Variables"), color: "#0891b2" },
  array: { label: tr("List", "list_variant_1"), color: "#db2777" },
  store: { label: tr("Storage"), color: "#4f46e5" },
  control: { label: tr("Control"), color: "#52525b" },
};
export const CAT_ORDER: Cat[] = ["event", "look", "move", "input", "var", "load", "array", "store", "control"];

export const CAT_OF: Record<ScriptStep["kind"], Cat> = {
  show: "look",
  "set-state": "look",
  hide: "look",
  toggle: "look",
  "open-page": "move",
  "open-url": "move",
  dialog: "look",
  "scroll-to": "move",
  "set-value": "input",
  "set-enabled": "input",
  fetch: "load",


  copy: "input",

  "set-var": "var",
  "set-list-item": "array",
  "remove-list-item": "array",
  "break-loop": "control",
  transform: "var",
  "list-display": "array",

  repeat: "control",
  "for-each": "array",



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
  "set-state": Palette,
  hide: EyeOff,
  toggle: ToggleRight,
  "open-page": FileText,
  "open-url": ExternalLink,
  dialog: MessageSquareWarning,
  "scroll-to": ArrowDownToLine,
  "set-value": PenLine,
  "set-enabled": Ban,
  fetch: CloudDownload,


  copy: ClipboardCopy,

  "set-var": Variable,
  "set-list-item": ListPlus,
  "remove-list-item": ListMinus,
  "break-loop": LogOut,
  transform: Workflow,
  "list-display": Funnel,

  repeat: Repeat,
  "for-each": IterationCw,



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
  | { type: "steps"; steps: ScriptStep[]; from?: { loc: Loc; remaining: PageScript[] } }
  /** group: 一緒に動かす選択中のスクリプト（script を含む） */
  | { type: "script"; script: PageScript; group: PageScript[] };

export interface PaletteItem {
  key: string;
  cat: Cat;
  icon: LucideIcon;
  /** ［］で囲んだ部分は、入力欄として表示する */
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
    label: tr("Fetch data from ［URL］ as ［name］"),
    make: () => one({ id: st(), kind: "fetch", url: "" }),
  },
  {
    key: "show",
    cat: "look",
    icon: Eye,
    label: tr("［Show / Hide / Toggle］［element］"),
    make: () => one({ id: st(), kind: "show", target: "" }),
  },
  {
    key: "dialog",
    cat: "look",
    icon: MessageSquareWarning,
    label: tr("Show ［Alert / Confirm / Prompt］ ［message］"),
    make: () => one({ id: st(), kind: "dialog", mode: "alert", message: "" }),
  },
  {
    key: "set-state",
    cat: "look",
    icon: Palette,
    label: tr("Set element ［］ to state ［state name］"),
    make: () => one({ id: st(), kind: "set-state", target: "", state: "" }),
  },
  {
    key: "open-page",
    cat: "move",
    icon: FileText,
    label: tr("Open ［page / URL］"),
    make: () => one({ id: st(), kind: "open-page", pageId: "" }),
  },
  {
    key: "scroll-to",
    cat: "move",
    icon: ArrowDownToLine,
    label: tr("Scroll to ［element］"),
    make: () => one({ id: st(), kind: "scroll-to", target: "" }),
  },
  {
    key: "set-value",
    cat: "input",
    icon: PenLine,
    label: tr("Set ［field］ to ［value］"),
    make: () => one({ id: st(), kind: "set-value", target: "", value: "" }),
  },
  {
    key: "set-enabled",
    cat: "input",
    icon: Ban,
    label: tr("Set ［field］ to ［enabled / disabled］"),
    make: () => one({ id: st(), kind: "set-enabled", target: "", op: "disable" }),
  },
  {
    key: "for-each",
    cat: "array",
    icon: IterationCw,
    label: tr("For each item in list ［］"),
    make: () => one({ id: st(), kind: "for-each", array: "", then: [] }),
  },
  {
    key: "list-display",
    cat: "array",
    icon: Funnel,
    label: tr("Filter list ［］"),
    make: () => one({ id: st(), kind: "list-display", mode: "filter", array: "", field: "", op: "eq", value: "", dir: "asc" }),
  },
  {
    key: "store-save",
    cat: "store",
    icon: Save,
    label: tr("Save ［value］ to storage key ［key］"),
    make: () => one({ id: st(), kind: "store-save", key: "", value: "" }),
  },
  {
    key: "store-load",
    cat: "store",
    icon: FolderOpen,
    label: tr("Load storage key ［key］ into variable ［］"),
    make: () => one({ id: st(), kind: "store-load", key: "", into: "" }),
  },
  {
    key: "set-var",
    cat: "var",
    icon: Variable,
    label: tr("Set variable ［］ to ［value / {data.path}］"),
    make: () => one({ id: st(), kind: "set-var", value: "", into: "" }),
  },
  {
    key: "make-list",
    cat: "array",
    icon: ListPlus,
    label: tr("Create an empty list in variable ［］"),
    make: () => one({ id: st(), kind: "set-var", value: "[]", into: "" }),
  },
  {
    key: "set-list-item",
    cat: "array",
    icon: ListPlus,
    label: tr("Set ［value］ at key ［］ of list ［］"),
    make: () => one({ id: st(), kind: "set-list-item", list: "", key: "", value: "" }),
  },
  {
    key: "remove-list-item",
    cat: "array",
    icon: ListMinus,
    label: tr("Remove entries from list ［］"),
    make: () => one({ id: st(), kind: "remove-list-item", list: "", mode: "value", value: "" }),
  },
  {
    key: "transform",
    cat: "var",
    icon: Workflow,
    label: tr("Apply an operation to a variable and store the result"),
    make: () => one({
      id: st(), kind: "transform", source: "", into: "", transform: { kind: "field", key: "" },
    }),
  },
  {
    key: "copy",
    cat: "input",
    icon: ClipboardCopy,
    label: tr("Copy ［text］"),
    make: () => one({ id: st(), kind: "copy", value: "" }),
  },
  {
    key: "wait",
    cat: "control",
    icon: Timer,
    label: tr("Wait ［1］ seconds"),
    make: () => one({ id: st(), kind: "wait", seconds: 1 }),
  },
  {
    key: "if",
    cat: "control",
    icon: Split,
    label: tr("If ［condition］ then (else)"),
    make: () =>
      one({
        id: st(),
        kind: "if",
        cond: { subject: "value", target: "", op: "eq", value: "" },
        then: [],
      }),
  },
  {
    key: "break-loop",
    cat: "control",
    icon: LogOut,
    label: tr("Break out of loop"),
    make: () => one({ id: st(), kind: "break-loop" }),
  },
  {
    key: "repeat",
    cat: "control",
    icon: Repeat,
    label: tr("Repeat ［3］ times"),
    make: () => one({ id: st(), kind: "repeat", times: 3, then: [] }),
  },
];


const normalizeSearch = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

/** 動作のパレットを、現在の表示名とキーワードで検索する。 */
export function findPaletteItems(query: string, lang: Lang = getLang()): PaletteItem[] {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return PALETTE;
  return PALETTE.filter((item) => {
    const text = normalizeSearch([
      item.key, item.label, CAT_INFO[item.cat].label, searchTermsFor(lang)[item.key] ?? "",
      item.cat === "array" && lang === "ja" ? "リスト" : "",
    ].join(" "));
    return words.every((word) => text.includes(word));
  });
}
