/**
 * Webマニュアル（Q&A）の型と、検索・おすすめの仕組み。
 * 記事の中身は lib/manualTopics.ts に書く
 */

import type { useEditor } from "./store";
import type { FigureId } from "../components/HelpFigures";
import { TOPICS } from "./manualTopics";
import { tr } from "./i18n";

export type EditorState = ReturnType<typeof useEditor.getState>;
type LeftTab = EditorState["leftTab"];
type RightTab = EditorState["rightTab"];

/** 1 = 入門（Webを初めて触る）/ 2 = 基本 / 3 = 応用 / 4 = 上級 */
export type Level = 1 | 2 | 3 | 4;

export const LEVELS: Record<Level, { label: string; desc: string }> = {
  1: { label: tr("Beginner"), desc: tr("For first-time website builders") },
  2: { label: tr("Basic"), desc: tr("Build a complete page") },
  3: { label: tr("Intermediate"), desc: tr("Get the design just right") },
  4: { label: tr("Advanced"), desc: tr("Data, scripts and publishing") },
};

export type CategoryId =
  | "start"
  | "page"
  | "element"
  | "text"
  | "layout"
  | "look"
  | "image"
  | "responsive"
  | "action"
  | "data"
  | "reuse"
  | "publish"
  | "design";

export interface Category {
  id: CategoryId;
  label: string;
  desc: string;
}

export const CATEGORIES: Category[] = [
  { id: "start", label: tr("Getting started"), desc: tr("The screen, saving and undo") },
  { id: "page", label: tr("Pages"), desc: tr("Adding pages, URLs and search results") },
  { id: "element", label: tr("Adding and selecting"), desc: tr("Add, select and reorder") },
  { id: "text", label: tr("Text"), desc: tr("Editing, size and fonts") },
  { id: "layout", label: tr("Layout"), desc: tr("Rows, centering and spacing") },
  { id: "look", label: tr("Color and look"), desc: tr("Backgrounds, corners, shadows, hover and motion") },
  { id: "image", label: tr("Images and video"), desc: tr("Adding, cropping and embedding") },
  { id: "responsive", label: tr("Mobile"), desc: tr("Change the look by screen width") },
  { id: "action", label: tr("Links and interaction"), desc: tr("Navigation and menus") },
  { id: "data", label: tr("Data and list displays"), desc: tr("External data, lists and detail pages") },
  { id: "reuse", label: tr("Reusable parts"), desc: tr("Components") },
  { id: "publish", label: tr("Publishing and management"), desc: tr("Publishing, backups and accounts") },
  { id: "design", label: tr("Web design basics"), desc: tr("Conventions worth knowing") },
];

/**
 * 記事の本文の部品。文の中では **強調**・`コード`・[[記事ID|リンクの文字]] が使える
 */
export type Block =
  | { p: string }
  | { list: string[]; ordered?: boolean }
  /** Webデザインの慣例・コツ（「なぜそうするか」） */
  | { rule: string; title?: string }
  | { note: string }
  | { warn: string }
  | { table: { head: string[]; rows: string[][] } }
  | { code: string }
  /** 図解（components/HelpFigures.tsx の図の ID） */
  | { fig: FigureId; caption?: string }
  /** ボタン（チュートリアルを始める など） */
  | { action: "tutorial" };

/** 操作ガイドの手順に必要な選択 */
export type SelectionNeed = "any" | "text" | "image" | "container";

export interface GuideStep {
  /** 示す場所（data-tutorial の値）。{mobile} はいちばん小さいブレークポイントのID */
  target?: string;
  /** 何をするか */
  text: string;
  /** 補足（コツ・注意） */
  hint?: string;
  /** この手順の前に、要素を選んでいる必要がある（選んでいなければ先に選ぶよう案内する） */
  needs?: SelectionNeed;
  /** 手順を始めるときに整える画面 */
  prepare?: {
    left?: LeftTab;
    right?: RightTab;
    /** 開いておくセクション（data-tutorial の値） */
    section?: string;
    /** 選択を外す（ページ設定を出す） */
    deselect?: boolean;
    /** デザイン画面に戻す */
    design?: boolean;
    /** スクリプト画面を閉じる */
    closeScripts?: boolean;
  };
  /** 操作が済んだか（済んだら自動で次の手順へ） */
  done?: (s: EditorState) => boolean;
}

/**
 * 記事が関係する場面。いま選んでいる要素や編集中の状態から、
 * ヘルプの「いまの作業に関係する質問」に出す
 */
export type TopicContext =
  | "none"
  | "text"
  | "image"
  | "box"
  | "list"
  | "instance"
  | "field"
  | "media"
  | "body"
  | "mobile"
  | "component"
  | "site";

export interface Topic {
  id: string;
  cat: CategoryId;
  level: Level;
  /** 質問（記事の見出し） */
  q: string;
  /** ひとことで答える */
  a: string;
  body: Block[];
  /** 画面の場所を示しながら案内する手順 */
  guide?: GuideStep[];
  /** 関連する記事 */
  see?: string[];
  /** 検索用の言い換え */
  keys?: string[];
  ctx?: TopicContext[];
}

export const TOPIC_BY_ID: Record<string, Topic> = Object.fromEntries(
  TOPICS.map((t) => [t.id, t])
);

/** 本文の書式記号を除いた文字（検索用） */
function plain(s: string): string {
  return s.replace(/\*\*|`/g, "").replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1");
}

function blockText(b: Block): string {
  if ("p" in b) return b.p;
  if ("list" in b) return b.list.join(" ");
  if ("rule" in b) return `${b.title ?? ""} ${b.rule}`;
  if ("note" in b) return b.note;
  if ("warn" in b) return b.warn;
  if ("table" in b) return [...b.table.head, ...b.table.rows.flat()].join(" ");
  if ("code" in b) return b.code;
  if ("fig" in b) return b.caption ?? "";
  return "";
}

/** 全角英数・カタカナの違いを吸収して比べる */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, " ");
}

const INDEX = TOPICS.map((t) => ({
  topic: t,
  head: norm(`${t.q} ${(t.keys ?? []).join(" ")}`),
  all: norm(
    `${t.q} ${t.a} ${(t.keys ?? []).join(" ")} ${t.body.map(blockText).map(plain).join(" ")}`
  ),
}));

/** 言葉で記事を探す（質問・言い換えに当たるものを先に） */
export function searchTopics(query: string): Topic[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  return INDEX.map((e) => {
    let score = 0;
    for (const w of words) {
      if (e.head.includes(w)) score += 3;
      else if (e.all.includes(w)) score += 1;
      else return { e, score: -1 };
    }
    return { e, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.e.topic.level - b.e.topic.level)
    .map((r) => r.e.topic);
}

/** いまの編集状態に関係する場面 */
export function currentContexts(s: EditorState): TopicContext[] {
  const out: TopicContext[] = [];
  const node = s.selection ? s.doc.nodes[s.selection] : undefined;
  if (s.selection === "__body__") out.push("body");
  else if (!node) out.push("none");
  else if (node.type === "image") out.push("image");
  else if (node.type === "list") out.push("list");
  else if (node.type === "instance") out.push("instance");
  else if (node.type === "field") out.push("field");
  else if (node.type === "media" || node.type === "embed") out.push("media");
  else if (node.type === "box") out.push(node.text && !node.children.length ? "text" : "box");
  if (s.breakpoint !== "base") out.push("mobile");
  if (s.editingComponentId) out.push("component");
  if (s.leftTab === "site") out.push("site");
  return out;
}

/** いまの作業に関係する記事（やさしいものから） */
export function topicsFor(contexts: TopicContext[], limit = 6): Topic[] {
  const rank = (t: Topic) => {
    const i = contexts.findIndex((c) => t.ctx?.includes(c));
    return i < 0 ? Infinity : i;
  };
  return TOPICS.filter((t) => rank(t) !== Infinity)
    .sort((a, b) => rank(a) - rank(b) || a.level - b.level)
    .slice(0, limit);
}
