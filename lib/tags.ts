import type { DocNode, Semantic } from "./types";
import { tr } from "./i18n";

export const SEMANTIC_OPTIONS: {
  value: Semantic;
  label: string;
  desc: string;
}[] = [
  { value: "auto", label: tr("自動"), desc: tr("中身から自動で判定します") },
  {
    value: "form",
    label: tr("検索フォーム"),
    desc: tr("中のフォーム部品の値をURLに付けて送信します"),
  },
  {
    value: "button",
    label: tr("ボタン"),
    desc: tr("押せるボタンです。検索フォームの中では送信ボタンになります"),
  },
  { value: "section", label: tr("セクション"), desc: tr("ページの中のひとまとまりの区画です") },
  { value: "header", label: tr("ヘッダー"), desc: tr("ページ上部の、ロゴやナビゲーションを置く部分です") },
  { value: "nav", label: tr("ナビゲーション"), desc: tr("主要なリンクのまとまりです") },
  { value: "main", label: tr("メイン"), desc: tr("ページの主な内容です（1ページに1つ）") },
  { value: "article", label: tr("記事"), desc: tr("それだけで完結する記事や投稿です") },
  { value: "footer", label: tr("フッター"), desc: tr("ページ下部の補足情報です") },
  { value: "div", label: tr("汎用ボックス"), desc: tr("意味を持たない、レイアウト用の箱です") },
  {
    value: "span",
    label: tr("インラインテキスト"),
    desc: tr("テキストの一部です（行内の span として出力）"),
  },
  {
    value: "custom",
    label: tr("カスタム"),
    desc: tr("pre・aside など、出力するタグ名を自由に指定します"),
  },
];

/**
 * カスタムに指定できないタグ。中身を持てない要素・ページ構造を壊す要素・
 * スクリプトを実行できる要素と、専用の要素（画像・入力欄など）で作るもの
 */
const BLOCKED_CUSTOM_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
  "html", "head", "body", "title", "script", "style", "noscript", "template", "slot",
  "iframe", "object", "frame", "frameset", "svg", "math", "canvas", "audio", "video", "picture",
  "textarea", "select", "option", "optgroup", "a", "form", "button",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup",
]);

/** カスタムタグ名を正規化する。使えない名前なら空文字 */
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

/** 要素を出力するHTMLタグ（意味付けが「自動」なら、リンク・テキスト・位置から決める） */
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
  // 子を持つ場合もテキスト情報があれば p / h#（テキストをspan分割した親）
  if (node.text && hasTextContent(node)) {
    return Number.isInteger(node.text.heading) && node.text.heading >= 1 && node.text.heading <= 6 ? `h${node.text.heading}` : "p";
  }
  if (isTopLevel) return "section";
  return "div";
}

/** レイアウト要素を中に追加できるボックスか。 */
export function canContainElements(node: DocNode): boolean {
  if (node.type !== "box" || hasTextContent(node)) return false;
  if (node.semantic === "custom" && !node.link) return true;
  return CONTAINER_TAGS.has(resolveTag(node, false));
}
