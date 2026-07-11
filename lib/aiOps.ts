/**
 * AIによる編集の「操作」と、その適用。
 *
 * AIは編集データを直接書き換えず、下の AiOp の並びを返す。サーバーは送られてきた
 * ページの部分コピーに適用して誤り（存在しない要素など）をAIへ返し、直させる。
 * うまく適用できた操作（新しい要素のIDを確定させたもの）をブラウザへ返し、
 * ブラウザは同じ関数で今の編集データへ1回の「元に戻す」で戻せる変更として適用する。
 */

import type { DocNode, NodeStyles, Page, SiteDoc, StyleMap, StyleState } from "./types";
import { BODY_NODE_ID } from "./types";
import { renamePage, setPageTitle } from "./pageTitle";
import { normalizeBreakpoints } from "./style";
import { pageLangOf, siteLangOf } from "./site-lang";

/** AIが作る要素 */
export interface AiNodeSpec {
  /** 同じ返答の中のあとの操作から参照するための仮の名前 */
  ref?: string;
  /** 確定したID（サーバーが付ける。AIは指定しない） */
  id?: string;
  type: "box" | "text" | "heading" | "button" | "image" | "divider" | "code";
  name?: string;
  text?: string;
  /** 見出しの段（1〜6） */
  level?: number;
  /** ボックスの意味付け */
  tag?: string;
  /** すべての画面幅のスタイル */
  styles?: AiStyles;
  /** ブレークポイントのID → その幅以下のスタイル（配列なら { breakpoint, styles } の並び） */
  responsive?: Record<string, AiStyles> | { breakpoint: string; styles: AiStyles }[];
  /** ホバー時のスタイル */
  hover?: AiStyles;
  link?: AiLink | null;
  src?: string;
  alt?: string;
  html?: string;
  children?: AiNodeSpec[];
}

/**
 * スタイルの指定。camelCase の CSS プロパティ → 値のまとまりか、
 * "font-size: 18px; color: #111" のような CSS の宣言の文字列
 * （自由なキーのまとまりを引数にできない API でも使えるように）
 */
export type AiStyles = Record<string, unknown> | string;

export interface AiLink {
  url?: string;
  pageId?: string;
  newTab?: boolean;
}

interface Place {
  /** 親の要素ID、または "page"（ページ直下） */
  parent?: string;
  index?: number;
  after?: string;
  before?: string;
}

export type AiOp =
  | { op: "set_style"; id: string; styles: AiStyles; breakpoint?: string; state?: string }
  | { op: "set_text"; id: string; text: string; level?: number }
  | ({ op: "insert"; node: AiNodeSpec } & Place)
  | ({ op: "move"; id: string } & Place)
  | { op: "delete"; id: string }
  | { op: "duplicate"; id: string; newId?: string; ref?: string }
  | { op: "rename"; id: string; name: string }
  | { op: "set_link"; id: string; link: AiLink | null }
  | { op: "set_image"; id: string; src?: string; alt?: string }
  | { op: "set_hidden"; id: string; breakpoints: string[] }
  | { op: "update_page"; title?: string; description?: string; name?: string };

export interface ApplyResult {
  /** 適用できた操作（insert / duplicate は確定したIDつき） */
  applied: AiOp[];
  /** 適用できなかった操作の理由（AIへ返す） */
  errors: string[];
}

export interface ApplyTarget {
  pageId: string;
  /** コンポーネントの編集中ならそのルート要素（"page" をこの要素として扱う） */
  rootId?: string | null;
}

const STATES: StyleState[] = ["default", "hover", "active", "focus"];
const SEMANTICS = new Set(["section", "header", "footer", "nav", "main", "article", "div", "form", "span"]);
const UNITLESS = new Set([
  "lineHeight",
  "opacity",
  "zIndex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "order",
  "aspectRatio",
  "gridColumnStart",
  "gridColumnEnd",
  "gridRowStart",
  "gridRowEnd",
]);
const HEADING_SIZES: Record<number, string> = { 1: "44px", 2: "32px", 3: "24px", 4: "20px", 5: "17px", 6: "15px" };

function newId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `node_ai${rand}`;
}

/** "font-size: 18px; color: #111" を { "font-size": "18px", color: "#111" } にする */
function parseDeclarations(css: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const decl of css.split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    const k = decl.slice(0, at).trim();
    const v = decl.slice(at + 1).trim();
    if (k) out[k] = v === "" || v === "unset" || v === "null" ? null : v;
  }
  return out;
}

/** "background-color" → "backgroundColor"、数値は px を付けた文字列に */
export function normalizeStyles(raw: AiStyles | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const map = typeof raw === "string" ? parseDeclarations(raw) : (raw ?? {});
  for (const [k0, v] of Object.entries(map)) {
    const k = k0.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!/^[a-zA-Z]+$/.test(k)) continue;
    if (v === null || v === undefined || v === "") out[k] = null;
    else if (typeof v === "number") out[k] = UNITLESS.has(k) || v === 0 ? String(v) : `${v}px`;
    else if (typeof v === "string") out[k] = v.trim().replace(/;$/, "");
  }
  return out;
}

function stylesFrom(spec: AiNodeSpec, defaults: StyleMap): NodeStyles {
  const base: StyleMap = { ...defaults };
  for (const [k, v] of Object.entries(normalizeStyles(spec.styles))) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  const styles: NodeStyles = { base: { default: base } };
  const hover = normalizeStyles(spec.hover);
  if (Object.keys(hover).length) {
    styles.base.hover = Object.fromEntries(Object.entries(hover).filter(([, v]) => v !== null)) as StyleMap;
  }
  const responsive = Array.isArray(spec.responsive)
    ? spec.responsive.map((r) => [r?.breakpoint, r?.styles] as const)
    : Object.entries(spec.responsive ?? {});
  for (const [bp, map] of responsive) {
    if (typeof bp !== "string" || !bp) continue;
    const m = Object.fromEntries(Object.entries(normalizeStyles(map)).filter(([, v]) => v !== null)) as StyleMap;
    if (Object.keys(m).length) styles[bp] = { default: m };
  }
  return styles;
}

function linkFrom(link: AiLink | null | undefined, doc: SiteDoc): DocNode["link"] {
  if (!link) return null;
  if (link.pageId && doc.pages[link.pageId]) {
    return { kind: "page", pageId: link.pageId, ...(link.newTab ? { newTab: true } : {}) };
  }
  if (link.url) return { kind: "url", url: link.url, ...(link.newTab ? { newTab: true } : {}) };
  return null;
}

/** 要素の設計図から DocNode を作る（子孫も含めて nodes に足し、ルートのIDを返す） */
function buildNode(
  spec: AiNodeSpec,
  doc: SiteDoc,
  refs: Map<string, string>,
  out: DocNode[],
  depth = 0
): AiNodeSpec {
  if (depth > 40 || out.length >= 2000) throw new Error("inserted tree is too large or too deep");
  if (!spec || !["box", "text", "heading", "button", "image", "divider", "code"].includes(spec.type)) throw new Error("invalid node type");
  for (const key of ["id", "ref", "name", "text", "tag", "src", "alt", "html"] as const) {
    if (spec[key] !== undefined && typeof spec[key] !== "string") throw new Error(`${key} must be a string`);
  }
  if (spec.link !== undefined) validateLink(spec.link);
  if (spec.id && (Object.hasOwn(doc.nodes, spec.id) || !validNodeId(spec.id))) throw new Error("node id already exists or is invalid");
  if (spec.children !== undefined && (!Array.isArray(spec.children) || (spec.type !== "box" && spec.children.length))) throw new Error("only boxes can contain child elements");
  if (spec.level !== undefined && (!Number.isInteger(spec.level) || spec.level < 1 || spec.level > 6)) throw new Error("heading level must be between 1 and 6");
  const breakpoints = new Set(normalizeBreakpoints(doc.breakpoints).map((b) => b.id));
  const responsive = Array.isArray(spec.responsive) ? spec.responsive.map((r) => r?.breakpoint) : Object.keys(spec.responsive ?? {});
  if (responsive.some((bp) => !breakpoints.has(bp))) throw new Error("unknown responsive breakpoint");
  if (spec.ref && refs.has(spec.ref)) throw new Error(`ref "${spec.ref}" already exists; use the existing element`);
  const id = spec.id || newId();
  if (spec.ref) refs.set(spec.ref, id);
  const common = {
    id,
    semantic: "auto" as DocNode["semantic"],
    text: null,
    link: linkFrom(spec.link, doc),
    children: [] as string[],
  };
  const children: AiNodeSpec[] = [];
  let node: DocNode;
  switch (spec.type) {
    case "text":
    case "heading": {
      const level = spec.type === "heading" ? Math.min(6, Math.max(1, Math.round(spec.level ?? 2))) : 0;
      node = {
        ...common,
        type: "box",
        name: spec.name || (level ? "Heading" : "Text"),
        text: { content: String(spec.text ?? ""), heading: level },
        styles: stylesFrom(
          spec,
          level
            ? { fontSize: HEADING_SIZES[level], fontWeight: "700", lineHeight: "1.3" }
            : { fontSize: "16px", lineHeight: "1.7" }
        ),
      };
      break;
    }
    case "button":
      node = {
        ...common,
        type: "box",
        name: spec.name || "Button",
        text: { content: String(spec.text ?? "Button"), heading: 0 },
        styles: stylesFrom(spec, {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px 24px",
          borderRadius: "8px",
          backgroundColor: "#18181b",
          color: "#ffffff",
          fontSize: "15px",
          fontWeight: "600",
          textDecoration: "none",
        }),
      };
      break;
    case "image":
      node = {
        ...common,
        type: "image",
        name: spec.name || "Image",
        image: {
          src: spec.src || "https://picsum.photos/seed/editor/800/500",
          alt: String(spec.alt ?? ""),
          // 実寸はキャンバスで読み込んだときに更新される
          width: 800,
          height: 500,
        },
        styles: stylesFrom(spec, { width: "100%" }),
      };
      break;
    case "divider":
      node = {
        ...common,
        type: "divider",
        name: spec.name || "Divider",
        styles: stylesFrom(spec, {
          width: "100%",
          height: "1px",
          backgroundColor: "#e4e4e7",
          border: "none",
          margin: "8px 0",
        }),
      };
      break;
    case "code":
      node = {
        ...common,
        type: "code",
        name: spec.name || "Custom code",
        code: { html: String(spec.html ?? "") },
        styles: stylesFrom(spec, {}),
      };
      break;
    default:
      node = {
        ...common,
        type: "box",
        name: spec.name || "Box",
        styles: stylesFrom(spec, { display: "flex", flexDirection: "column", padding: "0px", gap: "0px" }),
      };
  }
  if (spec.tag && SEMANTICS.has(spec.tag) && node.type === "box" && !node.text) {
    node.semantic = spec.tag as DocNode["semantic"];
  }
  out.push(node);
  doc.nodes[id] = node;
  if (node.type === "box" && !node.text) {
    for (const child of spec.children ?? []) {
      const built = buildNode(child, doc, refs, out, depth + 1);
      node.children.push(built.id!);
      children.push(built);
    }
  }
  // 確定したIDで返す（ブラウザで同じIDのまま作り直せるように）
  const { ref: _ref, ...rest } = spec;
  return { ...rest, id, ...(children.length ? { children } : { children: undefined }) };
}

function findParent(doc: SiteDoc, id: string): { list: string[] } | null {
  for (const page of Object.values(doc.pages)) {
    if (page.children.includes(id)) return { list: page.children };
  }
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(id)) return { list: node.children };
  }
  return null;
}

function descendants(doc: SiteDoc, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) throw new Error("element tree contains a cycle or duplicate child");
  seen.add(id);
  const out = [id];
  for (const c of doc.nodes[id]?.children ?? []) out.push(...descendants(doc, c, seen));
  return out;
}

/**
 * 操作を順に適用する（doc を直接書き換える）。
 * 1つの操作が失敗しても、ほかの操作は続ける
 */
function applyBatch(doc: SiteDoc, ops: AiOp[], target: ApplyTarget, refs: Map<string, string>): ApplyResult {
  const applied: AiOp[] = [];
  const errors: string[] = [];
  const page: Page | undefined = doc.pages[target.pageId];
  const scope = new Set((target.rootId ? [target.rootId] : page?.children ?? []).flatMap((id) => descendants(doc, id)));
  const bps = new Set(["base", ...normalizeBreakpoints(doc.breakpoints).map((b) => b.id)]);
  const resolve = (id: string | undefined) => (id ? (refs.get(id) ?? id) : id);
  const nodeOf = (id: string | undefined) => {
    const r = resolve(id);
    return r && scope.has(r) ? doc.nodes[r] : undefined;
  };

  /** 置き場所の親の children と、入れる位置 */
  const placeOf = (p: Place): { list: string[]; index: number } | string => {
    const anchorId = resolve(p.after ?? p.before);
    if (anchorId) {
      if (!nodeOf(anchorId) || anchorId === target.rootId) return "anchor is outside the editable area";
      const parent = findParent(doc, anchorId);
      if (!parent) return `element "${p.after ?? p.before}" was not found`;
      const i = parent.list.indexOf(anchorId);
      return { list: parent.list, index: p.after ? i + 1 : i };
    }
    let list: string[] | undefined;
    if (!p.parent || p.parent === "page") {
      const root = target.rootId ? nodeOf(target.rootId) : null;
      if (target.rootId && (!root || root.type !== "box" || root.text)) return "the component root cannot contain elements";
      list = root ? root.children : page?.children;
    } else {
      const parent = nodeOf(p.parent);
      if (!parent) return `parent "${p.parent}" was not found`;
      if (parent.type !== "box" || parent.text) {
        return `"${p.parent}" cannot contain elements (only boxes without text can)`;
      }
      list = parent.children;
    }
    if (!list) return "the page was not found";
    const index =
      typeof p.index === "number" && Number.isFinite(p.index)
        ? Math.max(0, Math.min(list.length, Math.round(p.index)))
        : list.length;
    return { list, index };
  };

  for (const raw of ops) {
    const op = raw as AiOp;
    try {
      switch (op?.op) {
        case "set_style": {
          if (op.state && !STATES.includes(op.state as StyleState)) throw new Error(`unknown style state "${op.state}"`);
          const bp = op.breakpoint && bps.has(op.breakpoint) ? op.breakpoint : "base";
          if (op.breakpoint && !bps.has(op.breakpoint)) {
            errors.push(`set_style: unknown breakpoint "${op.breakpoint}" (use one of ${[...bps].join(", ")})`);
            break;
          }
          const state = STATES.includes(op.state as StyleState) ? (op.state as StyleState) : "default";
          const props = normalizeStyles(op.styles);
          let styles: NodeStyles | undefined;
          if (op.id === BODY_NODE_ID || op.id === "body") {
            if (target.rootId) throw new Error("page body is outside the component");
            if (!page) throw new Error("the page was not found");
            styles = page.bodyStyles ??= {};
          } else {
            const node = nodeOf(op.id);
            if (!node) {
              errors.push(`set_style: element "${op.id}" was not found`);
              break;
            }
            styles = node.styles;
          }
          const map = ((styles[bp] ??= {})[state] ??= {});
          for (const [k, v] of Object.entries(props)) {
            if (v === null) delete map[k];
            else map[k] = v;
          }
          applied.push({ ...op, id: resolve(op.id)!, breakpoint: bp, state });
          break;
        }
        case "set_text": {
          const node = nodeOf(op.id);
          if (!node || node.type !== "box") {
            errors.push(`set_text: text element "${op.id}" was not found`);
            break;
          }
          if (node.children.length && !node.text) {
            errors.push(`set_text: "${op.id}" is a container; change the text of its child elements instead`);
            break;
          }
          if (node.children.length) {
            // 一部をspanに分けたテキストは、まとめて1つの文に戻す
            for (const c of node.children) for (const d of descendants(doc, c)) delete doc.nodes[d];
            node.children = [];
          }
          const level =
            typeof op.level === "number" ? Math.min(6, Math.max(0, Math.round(op.level))) : (node.text?.heading ?? 0);
          node.text = { content: String(op.text ?? ""), heading: level };
          applied.push({ ...op, id: node.id });
          break;
        }
        case "insert": {
          const place = placeOf(op);
          if (typeof place === "string") {
            errors.push(`insert: ${place}`);
            break;
          }
          if (!op.node || typeof op.node !== "object") {
            errors.push("insert: node is missing");
            break;
          }
          const built = buildNode(op.node, doc, refs, []);
          place.list.splice(place.index, 0, built.id!);
          applied.push({ op: "insert", node: built, parent: resolve(op.parent), index: op.index, after: resolve(op.after), before: resolve(op.before) });
          break;
        }
        case "move": {
          const node = nodeOf(op.id);
          if (!node) {
            errors.push(`move: element "${op.id}" was not found`);
            break;
          }
          if (node.id === target.rootId) throw new Error("the component root cannot be moved");
          const parentNode = op.parent && op.parent !== "page" ? nodeOf(op.parent) : null;
          const anchor = resolve(op.after ?? op.before);
          if ((parentNode && descendants(doc, node.id).includes(parentNode.id)) || (anchor && descendants(doc, node.id).includes(anchor))) {
            errors.push(`move: cannot move "${op.id}" into itself`);
            break;
          }
          const from = findParent(doc, node.id);
          if (!from) {
            errors.push(`move: element "${op.id}" is not placed on the page`);
            break;
          }
          const at = from.list.indexOf(node.id);
          from.list.splice(at, 1);
          const place = placeOf(op);
          if (typeof place === "string") {
            from.list.splice(at, 0, node.id);
            errors.push(`move: ${place}`);
            break;
          }
          place.list.splice(place.index, 0, node.id);
          applied.push({ ...op, id: node.id, parent: resolve(op.parent), after: resolve(op.after), before: resolve(op.before) });
          break;
        }
        case "delete": {
          const node = nodeOf(op.id);
          const parent = node ? findParent(doc, node.id) : null;
          if (!node || !parent) {
            errors.push(`delete: element "${op.id}" was not found`);
            break;
          }
          if (node.locked) {
            errors.push(`delete: "${op.id}" is locked`);
            break;
          }
          if (node.id === target.rootId) {
            errors.push("delete: the component root cannot be deleted");
            break;
          }
          parent.list.splice(parent.list.indexOf(node.id), 1);
          for (const d of descendants(doc, node.id)) delete doc.nodes[d];
          applied.push({ ...op, id: node.id });
          break;
        }
        case "duplicate": {
          const node = nodeOf(op.id);
          const parent = node ? findParent(doc, node.id) : null;
          if (!node || !parent) {
            errors.push(`duplicate: element "${op.id}" was not found`);
            break;
          }
          if (node.id === target.rootId) throw new Error("the component root cannot be duplicated");
          if (op.ref && refs.has(op.ref)) throw new Error(`ref "${op.ref}" already exists`);
          const copyId = op.newId || newId();
          if (!validNodeId(copyId)) throw new Error("invalid node id");
          let n = 0;
          const clone = (id: string, as?: string): string => {
            const src = doc.nodes[id];
            const c = structuredClone(src);
            c.id = as ?? `${copyId}_${(n += 1)}`;
            if (Object.hasOwn(doc.nodes, c.id)) throw new Error("duplicate node id already exists");
            // ID属性は重ならないように外す
            delete c.attrId;
            c.children = src.children.map((k) => clone(k));
            doc.nodes[c.id] = c;
            return c.id;
          };
          const made = clone(node.id, copyId);
          parent.list.splice(parent.list.indexOf(node.id) + 1, 0, made);
          if (op.ref) refs.set(op.ref, made);
          applied.push({ op: "duplicate", id: node.id, newId: made });
          break;
        }
        case "rename": {
          const node = nodeOf(op.id);
          if (!node) {
            errors.push(`rename: element "${op.id}" was not found`);
            break;
          }
          node.name = String(op.name ?? "").trim() || node.name;
          applied.push({ ...op, id: node.id });
          break;
        }
        case "set_link": {
          const node = nodeOf(op.id);
          if (!node) {
            errors.push(`set_link: element "${op.id}" was not found`);
            break;
          }
          if (op.link?.pageId && !doc.pages[op.link.pageId]) {
            errors.push(`set_link: page "${op.link.pageId}" was not found`);
            break;
          }
          node.link = linkFrom(op.link, doc);
          applied.push({ ...op, id: node.id });
          break;
        }
        case "set_image": {
          const node = nodeOf(op.id);
          if (!node?.image) {
            errors.push(`set_image: image "${op.id}" was not found`);
            break;
          }
          if (op.src) node.image = { ...node.image, src: op.src, assetId: undefined, width: 0, height: 0 };
          if (op.alt !== undefined) node.image.alt = String(op.alt);
          applied.push({ ...op, id: node.id });
          break;
        }
        case "set_hidden": {
          const node = nodeOf(op.id);
          if (!node) {
            errors.push(`set_hidden: element "${op.id}" was not found`);
            break;
          }
          if (op.breakpoints.some((b) => !bps.has(b))) throw new Error("unknown breakpoint");
          const list = op.breakpoints;
          node.hiddenOn = list.length ? list : undefined;
          applied.push({ ...op, id: node.id, breakpoints: list });
          break;
        }
        case "update_page": {
          if (target.rootId) throw new Error("page settings are outside the component");
          if (!page) {
            errors.push("update_page: the page was not found");
            break;
          }
          // タイトルを指定せずに名前だけ変えたときは、まだ決まっていないタイトルも合わせる
          if (typeof op.name === "string" && op.name.trim()) {
            if (typeof op.title === "string") page.name = op.name.trim();
            else renamePage(page, op.name.trim());
          }
          if (typeof op.title === "string") setPageTitle(page, op.title);
          if (typeof op.description === "string") page.description = op.description;
          applied.push(op);
          break;
        }
        default:
          errors.push(`unknown operation: ${JSON.stringify((raw as { op?: unknown })?.op ?? raw).slice(0, 60)}`);
      }
    } catch (e) {
      errors.push(`${op?.op ?? "operation"}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { applied, errors };
}

/** 操作は1つずつ確かめてから確定する。refs（仮の名前 → ID）は、同じリクエストのツール呼び出しをまたいで引き継ぐ */
export function applyAiOps(doc: SiteDoc, ops: AiOp[], target: ApplyTarget, refs = new Map<string, string>()): ApplyResult {
  const result: ApplyResult = { applied: [], errors: [] };
  if (!Array.isArray(ops) || ops.length > 200) return { applied: [], errors: ["Use at most 200 operations per call"] };
  for (const op of ops) {
    const draft = structuredClone(doc);
    const nextRefs = new Map(refs);
    try {
      validateOperation(op);
      const next = applyBatch(draft, [op], target, nextRefs);
      if (next.errors.length) result.errors.push(...next.errors);
      else if (next.applied.length) {
        Object.assign(doc, draft);
        refs.clear();
        nextRefs.forEach((value, key) => refs.set(key, value));
        result.applied.push(...next.applied);
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Invalid operation");
    }
  }
  return result;
}

function validNodeId(id: string): boolean {
  return /^[\w-]{1,64}$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id);
}

function validateLink(link: AiLink | null) {
  if (link === null) return;
  if (!link || typeof link !== "object" || Array.isArray(link)) throw new Error("link must be an object or null");
  if ((link.url !== undefined && typeof link.url !== "string") || (link.pageId !== undefined && typeof link.pageId !== "string") ||
    (link.newTab !== undefined && typeof link.newTab !== "boolean")) throw new Error("invalid link fields");
}

function validateOperation(op: AiOp) {
  if (!op || typeof op !== "object") throw new Error("operation must be an object");
  if (!["insert", "update_page"].includes(op.op) && (!("id" in op) || typeof op.id !== "string" || !op.id)) throw new Error("element id is required");
  if (op.op === "set_text" && typeof op.text !== "string") throw new Error("text must be a string");
  if (op.op === "set_text" && op.level !== undefined && (!Number.isInteger(op.level) || op.level < 0 || op.level > 6)) throw new Error("heading level must be between 0 and 6");
  if (op.op === "rename" && (typeof op.name !== "string" || !op.name.trim())) throw new Error("name is required");
  if (op.op === "set_style" && (!op.styles || !["object", "string"].includes(typeof op.styles) || Array.isArray(op.styles))) throw new Error("styles must be CSS declarations or an object");
  if (op.op === "set_link") validateLink(op.link);
  if (op.op === "set_image" && ((op.src !== undefined && typeof op.src !== "string") || (op.alt !== undefined && typeof op.alt !== "string"))) throw new Error("image source and alt must be strings");
  if (op.op === "set_hidden" && !Array.isArray(op.breakpoints)) throw new Error("breakpoints must be an array");
}

/* ---------- AIに見せる編集中の状態 ---------- */

const MAX_TEXT = 400;

/** AIへ送る、いま開いているページ（またはコンポーネント）の部分コピーと説明 */
export interface AiContext {
  /** サーバーで操作を試すための、編集データの部分コピー */
  doc: SiteDoc;
  target: ApplyTarget;
  /** AIに見せる要約（JSON） */
  summary: string;
  selection?: string | null;
  breakpoint?: string;
}

/** 要素を、AIが読みやすい短い形にする */
function outline(doc: SiteDoc, id: string, depth: number): unknown {
  const n = doc.nodes[id];
  if (!n) return null;
  const o: Record<string, unknown> = { id: n.id, type: n.type, name: n.name };
  if (n.semantic === "custom") o.tag = n.customTag || "div";
  else if (n.semantic !== "auto") o.tag = n.semantic;
  if (n.text) {
    o.text = n.text.content.length > MAX_TEXT ? `${n.text.content.slice(0, MAX_TEXT)}…` : n.text.content;
    if (n.text.heading) o.heading = n.text.heading;
  }
  if (n.link) o.link = n.link.kind === "page" ? { pageId: n.link.pageId } : { url: n.link.url };
  if (n.image) o.image = { src: n.image.src.slice(0, 200), alt: n.image.alt };
  if (n.type === "instance") o.component = doc.components?.[n.componentId ?? ""]?.name;
  if (n.type === "code") o.html = (n.code?.html ?? "").slice(0, 200);
  if (n.type === "list") o.list = n.list;
  if (Object.keys(n.styles).length) o.styles = n.styles;
  if (n.customCss) o.customCss = n.customCss;
  if (n.hiddenOn?.length) o.hiddenOn = n.hiddenOn;
  if (n.locked) o.locked = true;
  if (n.scripts?.length) o.hasScripts = true;
  if (n.attrId) o.attrId = n.attrId;
  if (n.children.length) o.children = depth > 40 ? "…" : n.children.map((c) => outline(doc, c, depth + 1));
  return o;
}

/**
 * いま編集している範囲だけを切り出す（全体を送るとリクエストが大きくなるため）。
 * ほかのページは名前とURLだけ残す
 */
export function buildAiContext(
  doc: SiteDoc,
  opts: { pageId: string; componentId?: string | null; selection?: string | null; breakpoint?: string }
): AiContext {
  const comp = opts.componentId ? doc.components?.[opts.componentId] : null;
  const page = doc.pages[opts.pageId];
  const rootIds = comp ? [comp.rootId] : (page?.children ?? []);
  const nodes: SiteDoc["nodes"] = {};
  for (const id of rootIds) for (const d of descendants(doc, id)) if (doc.nodes[d]) nodes[d] = doc.nodes[d];
  const pages: SiteDoc["pages"] = {};
  for (const [id, p] of Object.entries(doc.pages)) {
    pages[id] = id === opts.pageId ? p : { ...p, children: [], scripts: undefined, pageScripts: undefined, rawHtml: undefined };
  }
  const part: SiteDoc = {
    siteName: doc.siteName,
    pages,
    pageOrder: doc.pageOrder,
    nodes,
    assets: {},
    breakpoints: doc.breakpoints,
    baseWidth: doc.baseWidth,
    colorPalette: doc.colorPalette,
    customFonts: doc.customFonts,
    components: comp ? { [comp.id]: comp } : undefined,
  };
  const bps = normalizeBreakpoints(doc.breakpoints);
  const summary = {
    site: doc.siteName,
    // 新しく書く文章の言語（編集中のページの言語。コンポーネントはサイトの言語）
    language: comp ? siteLangOf(doc) : pageLangOf(doc, page),
    breakpoints: [
      { id: "base", appliesTo: "all widths (desktop design)" },
      ...bps.map((b) => ({ id: b.id, label: b.label, appliesTo: `max-width ${b.maxWidth}px` })),
    ],
    colorPalette: doc.colorPalette,
    fonts: doc.customFonts?.map((f) => f.family),
    pages: doc.pageOrder.map((id) => ({ id, name: doc.pages[id]?.name, url: `/${doc.pages[id]?.slug ?? ""}` })),
    editing: comp
      ? { component: comp.name, rootId: comp.rootId }
      : {
          page: { id: page?.id, name: page?.name, url: `/${page?.slug ?? ""}`, title: page?.title, description: page?.description },
          bodyStyles: page?.bodyStyles,
        },
    viewingBreakpoint: opts.breakpoint ?? "base",
    selectedElementId: opts.selection && (nodes[opts.selection] || opts.selection === BODY_NODE_ID) ? opts.selection : null,
    elements: rootIds.map((id) => outline(doc, id, 0)),
  };
  return {
    doc: part,
    target: { pageId: opts.pageId, rootId: comp?.rootId ?? null },
    summary: JSON.stringify(summary),
    selection: opts.selection ?? null,
    breakpoint: opts.breakpoint ?? "base",
  };
}
