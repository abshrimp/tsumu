import type { DocNode, Semantic } from "./types";
import { tr } from "./i18n";

export const SEMANTIC_OPTIONS: {
  value: Semantic;
  label: string;
  desc: string;
}[] = [
  { value: "auto", label: tr("automatic"), desc: tr("Chosen automatically from the content") },
  {
    value: "form",
    label: tr("Search form"),
    desc: tr("Sends the values of its form fields in the URL"),
  },
  {
    value: "button",
    label: tr("Button"),
    desc: tr("A pressable button. Inside a search form it submits the form"),
  },
  { value: "section", label: tr("Section"), desc: tr("A distinct section of the page") },
  { value: "header", label: tr("Header"), desc: tr("The top of the page, with the logo and navigation") },
  { value: "nav", label: tr("Navigation", "navigation_variant_1"), desc: tr("A group of main links") },
  { value: "main", label: tr("Main"), desc: tr("The page's main content (one per page)") },
  { value: "article", label: tr("Article"), desc: tr("A self-contained article or post") },
  { value: "footer", label: tr("Footer"), desc: tr("Supplementary info at the bottom of the page", "supplementary_info_at_the_bott_variant_1") },
  { value: "div", label: tr("Generic box"), desc: tr("A plain box for layout, with no meaning") },
  {
    value: "span",
    label: tr("Inline text"),
    desc: tr("Part of a text (output as an inline span)"),
  },
  {
    value: "custom",
    label: tr("Custom"),
    desc: tr("Specify any tag name to output, such as pre or aside"),
  },
];

/**
 * カスタムに指定できないタグ。中身を持てない要素、ページの構造を壊す要素、
 * スクリプトを実行できる要素と、専用の要素（画像・入力欄など）で作るもの
 */
const BLOCKED_CUSTOM_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
  "html", "head", "body", "title", "script", "style", "noscript", "template", "slot",
  "iframe", "object", "frame", "frameset", "svg", "math", "canvas", "audio", "video", "picture",
  "textarea", "select", "option", "optgroup", "a", "form", "button",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup",
]);

/** カスタムのタグ名を正規化する。使えない名前なら空文字を返す */
export function normalizeCustomTag(raw: string | undefined): string {
  const tag = (raw ?? "").trim().replace(/^<\/?|\/?>$/g, "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(tag)) return "";
  return BLOCKED_CUSTOM_TAGS.has(tag) ? "" : tag;
}

const CONTAINER_TAGS = new Set([
  "form",
  "section",
  "header",
  "nav",
  "main",
  "article",
  "footer",
  "div",
  "a",
]);
const SEMANTIC_TAGS = new Set(SEMANTIC_OPTIONS.map((o) => o.value).filter((v) => v !== "custom" && v !== "auto"));

/** 空の編集履歴だけが残ったボックスをテキスト要素として扱わない。 */
function hasTextContent(node: DocNode): boolean {
  return !!node.text && (node.text.content.length > 0 || node.children.length > 0);
}

/** 要素を出力する HTML のタグ（意味付けが「自動」なら、リンク・テキスト・位置から決める） */
export function resolveTag(node: DocNode, isTopLevel: boolean): string {
  if (node.type === "instance") return "comp";
  if (node.type === "list") return "list";
  if (node.type === "image") return "img";
  if (node.type === "divider") return "hr";
  if (node.type === "code") return "div";
  if (node.type === "icon") return "svg";
  if (node.type === "media") return node.media?.kind === "audio" ? "audio" : "video";
  if (node.type === "embed") return "iframe";
  if (node.type === "field") {
    const kind = node.field?.kind;
    if (kind === "textarea") return "textarea";
    if (kind === "select") return "select";
    if (kind === "checkbox" || kind === "radio") return "label";
    if (kind === "submit") return "button";
    return "input";
  }
  if (node.link) return "a";
  if (node.semantic === "custom") return normalizeCustomTag(node.customTag) || "div";
  if (node.semantic !== "auto") return SEMANTIC_TAGS.has(node.semantic) ? node.semantic : "div";
  // 子を持つ場合も、テキストの情報があれば p / h#（テキストを span に分割した親）
  if (node.text && hasTextContent(node)) {
    return Number.isInteger(node.text.heading) && node.text.heading >= 1 && node.text.heading <= 6 ? `h${node.text.heading}` : "p";
  }
  if (isTopLevel) return "section";
  return "div";
}

/** 中にレイアウトの要素を追加できるボックスか。 */
export function canContainElements(node: DocNode): boolean {
  if (node.type !== "box" || hasTextContent(node)) return false;
  if (node.semantic === "custom" && !node.link) return true;
  return CONTAINER_TAGS.has(resolveTag(node, false));
}
