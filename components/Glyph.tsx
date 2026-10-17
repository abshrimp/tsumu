import { Fragment, type ReactNode } from "react";
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Command,
  Option,
  type LucideIcon,
} from "lucide-react";
import { tr } from "../lib/i18n";

/** Mac（iPad も含む）か。キーの表記を ⌘ ⇧ の記号にするか、Ctrl・Shift の文字にするかを決める */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent
  );

/** 記号の文字はフォントによって形がまちまちなので、アイコンで描く */
const GLYPHS: Record<string, { Icon: LucideIcon; label: string }> = {
  "⇧": { Icon: ArrowBigUp, label: "Shift" },
  "⌘": { Icon: Command, label: "Command" },
  "⌥": { Icon: Option, label: "Option" },
  "↑": { Icon: ArrowUp, label: tr("上") },
  "↓": { Icon: ArrowDown, label: tr("下") },
  "←": { Icon: ArrowLeft, label: tr("左") },
  "→": { Icon: ArrowRight, label: tr("右") },
};

const RE = /([⇧⌘⌥↑↓←→])/;

/** Windows などでの修飾キーの呼び名と、並べる順番（Ctrl+Alt+Shift+キー） */
const PC_NAME: Record<string, string> = { "⌘": "Ctrl", "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
const PC_ORDER = ["Ctrl", "Alt", "Shift"];

/**
 * Mac の記号で書いたショートカット（⇧⌘Z・⌘ + スクロール など）を、Mac 以外では
 * 「Ctrl+Shift+Z」「Ctrl + スクロール」の形に書き換える。Mac ではそのまま返す
 */
export function keyText(text: string): string {
  if (IS_MAC) return text;
  return text.replace(/[⌃⌥⇧⌘]+/g, (mods: string, offset: number) => {
    const names = [...new Set([...mods].map((m) => PC_NAME[m]))].sort(
      (a, b) => PC_ORDER.indexOf(a) - PC_ORDER.indexOf(b)
    );
    const next = text.charAt(offset + mods.length);
    const after = text.charAt(offset + mods.length + 1);
    // 続く文字がキーなら「+」でつなぐ（「⌘+」の + はキーそのもの、「⌘+スクロール」の + はつなぎ）
    const key = /[A-Za-z0-9[\]/=.,;`'\\-]/.test(next) || (next === "+" && !/\S/.test(after));
    return names.join("+") + (key ? "+" : "");
  });
}

/** 文字列中のキー記号・矢印を SVG アイコンに置き換えて返す（Mac 以外では修飾キーを文字で書く） */
export function glyphs(text: string): ReactNode {
  const t = keyText(text);
  if (!RE.test(t)) return t;
  return t.split(RE).map((part, i) => {
    const g = GLYPHS[part];
    if (!g) return part ? <Fragment key={i}>{part}</Fragment> : null;
    return (
      <g.Icon
        key={i}
        className="glyph"
        size="1.05em"
        strokeWidth={2.2}
        aria-label={g.label}
        role="img"
      />
    );
  });
}
