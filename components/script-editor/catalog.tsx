"use client";

/**
 * スクリプトの画面で選べる「きっかけ」と「動作」の一覧（分類・アイコン・説明・検索）
 */

import { type CSSProperties } from "react";
import {
  ArrowDownToLine,
  Ban,
  ClipboardCopy,
  CloudDownload,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Funnel,
  IterationCw,
  ListMinus,
  ListPlus,
  LogOut,
  MessageSquareWarning,
  MousePointer2,
  MousePointerClick,
  Palette,
  PenLine,
  Repeat,
  Save,
  ScanEye,
  Split,
  TextCursorInput,
  Timer,
  ToggleRight,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { scriptUid, TRIGGER_LABELS, TRIGGER_ORDER } from "../../lib/script";
import { type ScriptStep, type ScriptTrigger } from "../../lib/types";
import { getLang, tr } from "../../lib/i18n";
import { searchTermsFor } from "../../lib/locales/search-terms";
import type { Lang } from "../../lib/lang";

/* ---------- 分類 ---------- */

type Cat = "event" | "look" | "move" | "input" | "control" | "var" | "load" | "array" | "store";

export const CAT_INFO: Record<Cat, { label: string; color: string }> = {
  event: { label: tr("Triggers"), color: "#b45309" },
  look: { label: tr("Looks (block category)"), color: "#7c3aed" },
  move: { label: tr("Navigation"), color: "#0b6bcb" },
  input: { label: tr("Input"), color: "#0f766e" },
  control: { label: tr("Flow (block category)"), color: "#52525b" },
  var: { label: tr("Variables"), color: "#0e7490" },
  load: { label: tr("Data"), color: "#047857" },
  array: { label: tr("List (data type)"), color: "#be185d" },
  store: { label: tr("Storage"), color: "#4338ca" },
};

/** 動作を選ぶ一覧での並び順。よく使う、やさしいものを先に置く。 */
export const CAT_ORDER: Exclude<Cat, "event">[] = ["look", "move", "input", "control", "var", "load", "array", "store"];

export const CAT_OF: Record<ScriptStep["kind"], Cat> = {
  show: "look",
  hide: "look",
  toggle: "look",
  "set-state": "look",
  dialog: "look",
  "open-page": "move",
  "open-url": "move",
  "scroll-to": "move",
  "set-value": "input",
  "set-enabled": "input",
  copy: "input",
  wait: "control",
  if: "control",
  repeat: "control",
  "break-loop": "control",
  "set-var": "var",
  transform: "var",
  fetch: "load",
  "for-each": "array",
  "list-display": "array",
  "set-list-item": "array",
  "remove-list-item": "array",
  "store-save": "store",
  "store-load": "store",
};

export const TRIGGER_ICON: Record<ScriptTrigger, LucideIcon> = {
  click: MousePointerClick,
  "hover-start": MousePointer2,
  "hover-end": LogOut,
  change: TextCursorInput,
  load: Zap,
  "in-view": ScanEye,
};

/** きっかけを選ぶ画面で、名前の下に添える説明。 */
export const TRIGGER_HINT: Record<ScriptTrigger, string> = {
  click: tr("Runs when a button, image, or any other element is clicked or tapped."),
  "hover-start": tr("Runs when the mouse pointer moves onto an element."),
  "hover-end": tr("Runs when the mouse pointer leaves an element."),
  change: tr("Runs when the content of an input field or a variable changes."),
  load: tr("Runs once, as soon as this page is displayed."),
  "in-view": tr("Runs when an element scrolls into the visible part of the screen."),
};

/** 要素を選ばなくても使えるきっかけ。 */
export const isPageTrigger = (trigger: ScriptTrigger) => trigger === "load";

export const TRIGGERS: readonly ScriptTrigger[] = TRIGGER_ORDER;
export { TRIGGER_LABELS };

export const STEP_ICON: Record<ScriptStep["kind"], LucideIcon> = {
  show: Eye,
  hide: EyeOff,
  toggle: ToggleRight,
  "set-state": Palette,
  dialog: MessageSquareWarning,
  "open-page": FileText,
  "open-url": ExternalLink,
  "scroll-to": ArrowDownToLine,
  "set-value": PenLine,
  "set-enabled": Ban,
  copy: ClipboardCopy,
  wait: Timer,
  if: Split,
  repeat: Repeat,
  "break-loop": LogOut,
  "set-var": Variable,
  transform: Workflow,
  fetch: CloudDownload,
  "for-each": IterationCw,
  "list-display": Funnel,
  "set-list-item": ListPlus,
  "remove-list-item": ListMinus,
  "store-save": Save,
  "store-load": FolderOpen,
};

export function catStyle(cat: Cat): CSSProperties {
  return { "--cat": CAT_INFO[cat].color } as CSSProperties;
}

export function Ico({ icon: I, cat, size = 14 }: { icon: LucideIcon; cat: Cat; size?: number }) {
  return (
    <span className="se-ico" style={catStyle(cat)} aria-hidden="true">
      <I size={size} strokeWidth={2} />
    </span>
  );
}

/* ---------- 動作の一覧 ---------- */

/** その動作を置ける場所の条件。満たさない場所では、理由を添えて選べなくする。 */
type ActionPlace = "anywhere" | "inside-loop";

export interface ActionItem {
  key: string;
  cat: Exclude<Cat, "event">;
  icon: LucideIcon;
  /** 一覧に表示する短い名前 */
  title: string;
  /** 何が起きるかを、専門用語を使わずに1文で */
  hint: string;
  place: ActionPlace;
  make: () => ScriptStep;
}

const st = () => scriptUid("st");

export const ACTIONS: ActionItem[] = [
  {
    key: "show", cat: "look", icon: Eye, place: "anywhere",
    title: tr("Show or hide an element"),
    hint: tr("Make an element appear, disappear, or switch between the two."),
    make: () => ({ id: st(), kind: "show", target: "" }),
  },
  {
    key: "set-state", cat: "look", icon: Palette, place: "anywhere",
    title: tr("Change an element's look"),
    hint: tr("Switch an element to a state you designed, such as \"selected\" or \"open\"."),
    make: () => ({ id: st(), kind: "set-state", target: "", state: "" }),
  },
  {
    key: "dialog", cat: "look", icon: MessageSquareWarning, place: "anywhere",
    title: tr("Show a message"),
    hint: tr("Show a message box, ask yes or no, or ask the visitor to type something."),
    make: () => ({ id: st(), kind: "dialog", mode: "alert", message: "" }),
  },
  {
    key: "open-page", cat: "move", icon: FileText, place: "anywhere",
    title: tr("Open a page or link"),
    hint: tr("Go to another page of this site, or to any web address."),
    make: () => ({ id: st(), kind: "open-page", pageId: "" }),
  },
  {
    key: "scroll-to", cat: "move", icon: ArrowDownToLine, place: "anywhere",
    title: tr("Scroll to an element"),
    hint: tr("Smoothly move the screen until the element is visible."),
    make: () => ({ id: st(), kind: "scroll-to", target: "" }),
  },
  {
    key: "set-value", cat: "input", icon: PenLine, place: "anywhere",
    title: tr("Fill in an input field"),
    hint: tr("Put text into a field, or switch a checkbox on or off."),
    make: () => ({ id: st(), kind: "set-value", target: "", value: "" }),
  },
  {
    key: "set-enabled", cat: "input", icon: Ban, place: "anywhere",
    title: tr("Enable or disable a field"),
    hint: tr("Decide whether a field or button can be used."),
    make: () => ({ id: st(), kind: "set-enabled", target: "", op: "disable" }),
  },
  {
    key: "copy", cat: "input", icon: ClipboardCopy, place: "anywhere",
    title: tr("Copy text"),
    hint: tr("Copy text to the visitor's clipboard so they can paste it elsewhere."),
    make: () => ({ id: st(), kind: "copy", value: "" }),
  },
  {
    key: "wait", cat: "control", icon: Timer, place: "anywhere",
    title: tr("Wait"),
    hint: tr("Pause for a few seconds before the next action."),
    make: () => ({ id: st(), kind: "wait", seconds: 1 }),
  },
  {
    key: "if", cat: "control", icon: Split, place: "anywhere",
    title: tr("If… then"),
    hint: tr("Run the actions inside only when a condition is met."),
    make: () => ({
      id: st(), kind: "if",
      cond: { subject: "value", target: "", op: "eq", value: "" },
      then: [],
    }),
  },
  {
    key: "repeat", cat: "control", icon: Repeat, place: "anywhere",
    title: tr("Repeat"),
    hint: tr("Run the actions inside a number of times, or forever."),
    make: () => ({ id: st(), kind: "repeat", times: 3, then: [] }),
  },
  {
    key: "break-loop", cat: "control", icon: LogOut, place: "inside-loop",
    title: tr("Stop repeating"),
    hint: tr("Leave the surrounding repeat early and continue after it."),
    make: () => ({ id: st(), kind: "break-loop" }),
  },
  {
    key: "set-var", cat: "var", icon: Variable, place: "anywhere",
    title: tr("Remember a value"),
    hint: tr("Give a value a name (a variable) so later actions and elements can use it."),
    make: () => ({ id: st(), kind: "set-var", value: "", into: "" }),
  },
  {
    key: "transform", cat: "var", icon: Workflow, place: "anywhere",
    title: tr("Change a value"),
    hint: tr("Calculate, replace text, count items, and more, then keep the result."),
    make: () => ({
      id: st(), kind: "transform", source: "", into: "", transform: { kind: "field", key: "" },
    }),
  },
  {
    key: "fetch", cat: "load", icon: CloudDownload, place: "anywhere",
    title: tr("Fetch data from the internet"),
    hint: tr("Load data from a web address so the page can show it."),
    make: () => ({ id: st(), kind: "fetch", url: "" }),
  },
  {
    key: "for-each", cat: "array", icon: IterationCw, place: "anywhere",
    title: tr("Repeat for each list item"),
    hint: tr("Run the actions inside once for every item in a list."),
    make: () => ({ id: st(), kind: "for-each", array: "", then: [] }),
  },
  {
    key: "list-display", cat: "array", icon: Funnel, place: "anywhere",
    title: tr("Filter or sort a displayed list"),
    hint: tr("Narrow down or reorder the items a list element shows, without changing the data."),
    make: () => ({ id: st(), kind: "list-display", mode: "filter", array: "", field: "", op: "eq", value: "", dir: "asc" }),
  },
  {
    key: "make-list", cat: "array", icon: ListPlus, place: "anywhere",
    title: tr("Create an empty list"),
    hint: tr("Start a new list that you can add items to."),
    make: () => ({ id: st(), kind: "set-var", value: "[]", into: "" }),
  },
  {
    key: "set-list-item", cat: "array", icon: ListPlus, place: "anywhere",
    title: tr("Add an item to a list"),
    hint: tr("Append a value to a list, or replace the item at a given position."),
    make: () => ({ id: st(), kind: "set-list-item", list: "", key: "", value: "" }),
  },
  {
    key: "remove-list-item", cat: "array", icon: ListMinus, place: "anywhere",
    title: tr("Remove items from a list"),
    hint: tr("Delete matching values, or the item at a given position."),
    make: () => ({ id: st(), kind: "remove-list-item", list: "", mode: "value", value: "" }),
  },
  {
    key: "store-save", cat: "store", icon: Save, place: "anywhere",
    title: tr("Save in the visitor's browser"),
    hint: tr("Keep a value so it is still there the next time the visitor comes back."),
    make: () => ({ id: st(), kind: "store-save", key: "", value: "" }),
  },
  {
    key: "store-load", cat: "store", icon: FolderOpen, place: "anywhere",
    title: tr("Load a saved value"),
    hint: tr("Bring back a value saved in the visitor's browser."),
    make: () => ({ id: st(), kind: "store-load", key: "", into: "" }),
  },
];

/** 置けない場所で選ぼうとしたときに表示する理由。 */
export const PLACE_REASON: Record<Exclude<ActionPlace, "anywhere">, string> = {
  "inside-loop": tr("Only works inside a repeat."),
};

const normalizeSearch = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

/** 動作の一覧を、現在の表示名・説明・キーワードで検索する。 */
export function findActions(query: string, lang: Lang = getLang()): ActionItem[] {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ACTIONS;
  return ACTIONS.filter((item) => {
    const text = normalizeSearch([
      item.key, item.title, item.hint, CAT_INFO[item.cat].label, searchTermsFor(lang)[item.key] ?? "",
    ].join(" "));
    return words.every((word) => text.includes(word));
  });
}
