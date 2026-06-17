"use client";

/**
 * サイトをまたいだ要素のコピー・貼り付け。
 * コピーした要素を、使っているアセット・コンポーネント・フォントと一緒に
 * OS のクリップボード（エディタ専用の形式）とブラウザ保存に書き出す。
 * 別のタブ・ウィンドウで開いた別のサイトでも、⌘V で同じものを貼り付けられる
 */

import type { Asset, Component, CustomFont, DocNode, SiteDoc } from "./types";
import { assetSrc } from "./assets";
import { currentSiteId } from "./site";
import { storageKey } from "./storage-keys";

/** クリップボードに書くエディタ専用の形式 */
export const CLIP_MIME = "application/x-tsumu+json";
/** 右クリックメニューの「貼り付け」用の控え（全サイト共通） */
const CLIP_MIRROR_KEY = storageKey("clipboard-v1");

export interface ClipPayload {
  v: 1;
  /** コピー元のサイト */
  site: string;
  nodes: DocNode[];
  rootIds: string[];
  /** 要素が使っているアセット */
  assets: Record<string, Asset>;
  /** 要素が（入れ子も含めて）使っているコンポーネントと、その中身のノード */
  components: Record<string, Component>;
  componentNodes: DocNode[];
  /** 要素が使っている追加フォント */
  customFonts: CustomFont[];
}

function descendants(doc: SiteDoc, id: string, out: DocNode[] = []): DocNode[] {
  const n = doc.nodes[id];
  if (!n) return out;
  out.push(structuredClone(n));
  for (const c of n.children) descendants(doc, c, out);
  return out;
}

/** コピーした要素に、貼り付け先で必要になるもの（アセット・コンポーネント・フォント）を添える */
export function buildClipPayload(doc: SiteDoc, clip: { nodes: DocNode[]; rootIds: string[] }): ClipPayload {
  // 中で使っているコンポーネントを、入れ子の分までたどる
  const components: Record<string, Component> = {};
  const componentNodes: DocNode[] = [];
  const visit = (nodes: DocNode[]) => {
    for (const n of nodes) {
      const cid = n.type === "instance" ? n.componentId : undefined;
      const comp = cid ? doc.components?.[cid] : undefined;
      if (!comp || components[comp.id]) continue;
      components[comp.id] = structuredClone(comp);
      const inner = descendants(doc, comp.rootId);
      componentNodes.push(...inner);
      visit(inner);
    }
  };
  visit(clip.nodes);

  // ID・URL が書かれているアセット（画像要素・背景・スクリプトなど、使い方を問わない）
  const text = JSON.stringify([clip.nodes, componentNodes]);
  const assets: Record<string, Asset> = {};
  for (const a of Object.values(doc.assets)) {
    const src = a.path ? assetSrc(a) : "";
    if (text.includes(a.id) || (src && text.includes(src))) assets[a.id] = structuredClone(a);
  }
  const customFonts = (doc.customFonts ?? []).filter((f) => text.includes(f.family));
  return {
    v: 1,
    site: currentSiteId(),
    nodes: clip.nodes,
    rootIds: clip.rootIds,
    assets,
    components,
    componentNodes,
    customFonts,
  };
}

/** 要素の形（貼り付けたときに文書を壊さないよう、子の参照が中でそろっているかまで見る） */
function validNodes(nodes: unknown, roots?: unknown): nodes is DocNode[] {
  if (!Array.isArray(nodes)) return false;
  const ids = new Set<string>();
  for (const n of nodes as DocNode[]) {
    if (
      !n || typeof n !== "object" || typeof n.id !== "string" || typeof n.type !== "string" ||
      !n.styles || typeof n.styles !== "object" || !Array.isArray(n.children) ||
      n.children.some((c) => typeof c !== "string") || ids.has(n.id)
    ) {
      return false;
    }
    ids.add(n.id);
  }
  if ((nodes as DocNode[]).some((n) => n.children.some((c) => !ids.has(c)))) return false;
  return roots === undefined || (Array.isArray(roots) && roots.length > 0 && roots.every((r) => ids.has(r)));
}

function isPayload(v: unknown): v is ClipPayload {
  const p = v as ClipPayload | null;
  return (
    !!p && p.v === 1 && validNodes(p.nodes, p.rootIds) &&
    !!p.assets && typeof p.assets === "object" &&
    !!p.components && typeof p.components === "object" && !Array.isArray(p.components) &&
    validNodes(p.componentNodes) && Array.isArray(p.customFonts)
  );
}

/**
 * クリップボードの中身が、このブラウザのエディタでコピーしたものか。
 * クリップボードのエディタ専用の形式は、どのWebサイトでも copy のときに書き込めるため、
 * エディタだけが書ける保存（コピーした控え）と同じものだけを信用する
 */
export function isOwnClip(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    return window.localStorage.getItem(CLIP_MIRROR_KEY) === raw;
  } catch {
    return false;
  }
}

/** 貼り付けるとエディタの中で HTML として動く要素（カスタムコード・アイコン）の名前 */
export function activeContentNames(p: ClipPayload): string[] {
  return [...p.nodes, ...(p.componentNodes ?? [])]
    .filter((n) => (n.type === "code" && n.code?.html?.trim()) || (n.type === "icon" && n.icon?.svg?.trim()))
    .map((n) => String(n.name?.trim() || n.type));
}

export function parseClipPayload(raw: string | null | undefined): ClipPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return isPayload(v) ? v : null;
  } catch {
    return null;
  }
}

/** 要素の文字（ほかのアプリに貼り付けたときに出す） */
function plainText(nodes: DocNode[]): string {
  return nodes
    .map((n) => (n.text?.content ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

let pending: ClipPayload | null = null;

if (typeof document !== "undefined") {
  // execCommand("copy") で起きる copy イベントに、エディタの形式を書き込む
  document.addEventListener(
    "copy",
    (e) => {
      if (!pending || !e.clipboardData) return;
      e.clipboardData.setData(CLIP_MIME, JSON.stringify(pending));
      const text = plainText(pending.nodes);
      if (text) e.clipboardData.setData("text/plain", text);
      e.preventDefault();
      // エディタ側の「テキストをコピーした」扱い（内部クリップボードを手放す）にしない
      e.stopPropagation();
    },
    true
  );
}

/** コピーした要素を OS のクリップボードとブラウザ保存に書き出す（キー操作・クリックの中で呼ぶ） */
export function writeClipPayload(payload: ClipPayload): void {
  try {
    window.localStorage.setItem(CLIP_MIRROR_KEY, JSON.stringify(payload));
  } catch {
    // 大きすぎて保存できなくても、OS のクリップボードには書ける
  }
  pending = payload;
  try {
    document.execCommand("copy");
  } catch {
    // 使えないブラウザでは、同じタブの中だけで貼り付けられる
  } finally {
    pending = null;
  }
}

/** 右クリックメニューの「貼り付け」に使う、最後にコピーした要素（どのサイトでも共通） */
export function readClipMirror(): ClipPayload | null {
  try {
    return parseClipPayload(window.localStorage.getItem(CLIP_MIRROR_KEY));
  } catch {
    return null;
  }
}

/**
 * 貼り付け先のドキュメントに、コピー元のアセット・コンポーネント・フォントを足す（updateDoc の中で呼ぶ）。
 * 同じファイルのアセットが既にあればそれを使い、要素の参照をそちらへ付け替える。
 * 戻り値は、付け替えたアセットIDの対応（古いID → 貼り付け先のID）
 */
export function mergeClipDeps(d: SiteDoc, p: ClipPayload): Map<string, string> {
  const remap = new Map<string, string>();
  for (const a of Object.values(p.assets)) {
    if (!a || typeof a.id !== "string" || !a.id || !isSafeClipAsset(a)) continue;
    if (d.assets[a.id]) continue;
    const same = Object.values(d.assets).find(
      (b) => (a.path && b.path === a.path) || (a.dataUrl && b.dataUrl === a.dataUrl)
    );
    if (same) remap.set(a.id, same.id);
    else d.assets[a.id] = structuredClone(a);
  }
  for (const c of Object.values(p.components)) {
    if (d.components?.[c.id]) continue;
    d.components = { ...(d.components ?? {}), [c.id]: structuredClone(c) };
  }
  for (const n of p.componentNodes) {
    if (!d.nodes[n.id]) d.nodes[n.id] = remapAssetIds(structuredClone(n), remap);
  }
  for (const f of p.customFonts) {
    // 名前は公開するサイトのコードに入るので、Google Fonts の名前の形だけ受け取る
    const valid =
      typeof f?.family === "string" && /^[A-Za-z][A-Za-z0-9 ]{0,63}$/.test(f.family) &&
      (f.weights === "variable" || (Array.isArray(f.weights) && f.weights.every((w) => /^\d{3}$/.test(String(w)))));
    if (valid && !(d.customFonts ?? []).some((x) => x.family === f.family)) {
      d.customFonts = [...(d.customFonts ?? []), structuredClone(f)];
    }
  }
  return remap;
}

/** クリップボードのアセットが安全か（HTML や不正なパス・スキームは受け取らない） */
function isSafeClipAsset(a: Asset): boolean {
  if (typeof a.name !== "string" || /\.(?:x?html?|mhtml|shtml|xml)$/i.test(a.name.trim())) return false;
  if (a.mimeType && /^(?:text\/html|application\/xhtml\+xml|(?:text|application)\/xml)\b/i.test(a.mimeType.trim())) {
    return false;
  }
  if (a.path !== undefined) {
    if (
      typeof a.path !== "string" ||
      !a.path.trim() ||
      /[\u0000-\u001f\\]/.test(a.path) ||
      a.path.split("/").includes("..")
    ) {
      return false;
    }
  }
  if (a.dataUrl !== undefined) {
    if (typeof a.dataUrl !== "string" || !/^data:(?:image|video|audio|font)\//i.test(a.dataUrl)) {
      return false;
    }
  }
  return Boolean(a.path || a.dataUrl);
}

/** 要素の中のアセットIDを付け替える（IDは一意な文字列なので、文字列として置き換える） */
export function remapAssetIds<T>(value: T, remap: Map<string, string>): T {
  if (!remap.size) return value;
  let json = JSON.stringify(value);
  for (const [from, to] of remap) json = json.split(from).join(to);
  return JSON.parse(json) as T;
}
