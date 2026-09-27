import {
  Code2, Component, Globe, Image as ImageIcon, List, Minus, MousePointerClick,
  PlayCircle, Sparkles, Square, TextCursorInput, Type, type LucideIcon,
} from "lucide-react";
import type { DocNode } from "../lib/types";
import { tr } from "../lib/i18n";

/** 要素の種類ごとのアイコンと呼び名。レイヤーの一覧と、スクリプトで要素を選ぶ一覧で共通に使う。 */
export type ElementKind =
  | "text" | "box" | "button" | "image" | "field" | "icon" | "list" | "media" | "embed" | "code" | "divider" | "component";

export const ELEMENT_KIND: Record<ElementKind, { label: string; icon: LucideIcon }> = {
  text: { label: tr("Text"), icon: Type },
  box: { label: tr("Box"), icon: Square },
  button: { label: tr("Button"), icon: MousePointerClick },
  image: { label: tr("Image"), icon: ImageIcon },
  field: { label: tr("Input field"), icon: TextCursorInput },
  icon: { label: tr("Icon"), icon: Sparkles },
  list: { label: tr("List", "list_variant_1"), icon: List },
  media: { label: tr("Video / audio"), icon: PlayCircle },
  embed: { label: tr("Embed"), icon: Globe },
  code: { label: tr("Code"), icon: Code2 },
  divider: { label: tr("Divider"), icon: Minus },
  component: { label: tr("Component"), icon: Component },
};

/** 作っている人が見て分かる言葉で、要素の種類を返す（タグ名は使わない）。 */
export function elementKindOf(node: DocNode, tag: string): ElementKind {
  switch (node.type) {
    case "image": return "image";
    case "icon": return "icon";
    case "list": return "list";
    case "media": return "media";
    case "embed": return "embed";
    case "code": return "code";
    case "divider": return "divider";
    case "instance": return "component";
    case "field": return node.field?.kind === "submit" ? "button" : "field";
    default: return tag === "button" ? "button" : node.text ? "text" : "box";
  }
}
