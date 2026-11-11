"use client";

/**
 * サイトをまたいだ要素のコピー・貼り付け。
 * コピーした要素を、使っているアセット・コンポーネント・フォントと一緒に
 * OS のクリップボード（エディタ専用の形式）とブラウザ保存に書き出す。
 * 別のタブ・ウィンドウで開いた別のサイトでも、⌘V で同じものを貼り付けられる
 */

import type { Asset, BreakpointDef, Component, CustomFont, DocNode, Page, SiteDoc } from "./types";
import { assetSrc } from "./assets";
import { createCssAssetFinder } from "./css-asset-dependencies";
import { zipAssetClosure, zipStylesheet } from "./zip-css";
import { isZipJavascript } from "./generator/imported-assets";
import { genId } from "./presets";
import { cloneSteps, scriptUid } from "./script";
import { currentSiteId } from "./site";
import { storageKey } from "./storage-keys";
import { validAssetEntry, validDocNodeShape, validNodeForest } from "./doc-tree";
import { validSiteAdditionalFields } from "./document-value-shapes";
import { DEFAULT_BREAKPOINTS, MAX_BREAKPOINTS, normalizeBreakpoints } from "./style";

/** クリップボードに書くエディタ専用の形式 */
export const CLIP_MIME = "application/x-tsumu+json";
/** 右クリックメニューの「貼り付け」用の控え（全サイト共通） */
const CLIP_MIRROR_KEY = storageKey("clipboard-v1");

export interface ClipPayload {
  v: 1;
  /** コピー元のサイト */
  site: string;
  /** コピー元サイトの画面幅設定。貼り付け先への参照変換に必須。 */
  breakpoints: BreakpointDef[];
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
export function buildClipPayload(doc: SiteDoc, clip: { nodes: DocNode[]; rootIds: string[]; pages?: Page[] }): ClipPayload {
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
  const text = JSON.stringify([clip.nodes, componentNodes, clip.pages ?? []]);
  const findCssAssets = createCssAssetFinder(doc.assets);
  const cssIds = new Set<string>();
  for (const node of [...clip.nodes, ...componentNodes]) {
    findCssAssets(node.styles, node.customCss).forEach((id) => cssIds.add(id));
  }
  for (const page of clip.pages ?? []) findCssAssets(page.bodyStyles).forEach((id) => cssIds.add(id));
  const assets: Record<string, Asset> = {};
  for (const a of Object.values(doc.assets)) {
    const src = assetSrc(a);
    if (cssIds.has(a.id) || text.includes(a.id) || (src && text.includes(src))) assets[a.id] = structuredClone(a);
  }
  for (const id of zipAssetClosure(doc.assets, Object.keys(assets))) assets[id] = structuredClone(doc.assets[id]);
  // JS の相対参照はアセットの内容にあり、ここでは読み取れない。
  // 未使用削除の判定と同じく、使用中のスクリプトの ZIP 一式をコピーする。
  const scriptGroups = new Set(Object.values(assets).filter(isZipJavascript).map(asset => asset.zip!.group));
  for (const asset of Object.values(doc.assets)) {
    if (asset.zip && scriptGroups.has(asset.zip.group)) assets[asset.id] = structuredClone(asset);
  }
  const customFonts = (doc.customFonts ?? []).filter((f) => text.includes(f.family));
  return {
    v: 1,
    site: currentSiteId(),
    breakpoints: structuredClone(doc.breakpoints ?? DEFAULT_BREAKPOINTS),
    nodes: clip.nodes,
    rootIds: clip.rootIds,
    assets,
    components,
    componentNodes,
    customFonts,
  };
}

/** コピー時と同じ画面幅の設定へ参照を移す。対応できなければ文書を変えずに断る。 */
export function prepareClipBreakpoints(doc: SiteDoc, payload: ClipPayload): ClipPayload | null {
  const nodes = [...payload.nodes, ...payload.componentNodes];
  if (nodes.some((node) => node.hiddenOn !== undefined &&
      (!Array.isArray(node.hiddenOn) || node.hiddenOn.some((id) => typeof id !== "string")))) return null;
  const checked = (input: BreakpointDef[]) => {
    if (!Array.isArray(input) || input.length > MAX_BREAKPOINTS) return null;
    const normalized = normalizeBreakpoints(input);
    if (normalized.length !== input.length || input.some((b) =>
      !b || !Number.isInteger(b.maxWidth) || b.maxWidth < 240 || b.maxWidth > 2999
    )) return null;
    return normalized;
  };
  const responsive = nodes.some((node) =>
    Object.keys(node.styles).some((id) => id !== "base") || node.hiddenOn?.some((id) => id !== "base"));
  const source = checked(payload.breakpoints);
  const target = checked(doc.breakpoints ?? DEFAULT_BREAKPOINTS);
  if (!source || !target) return null;
  // 全画面幅で共通の指定だけなら、画面幅の設定が異なっていても表示を保てる。
  if (!responsive) return { ...structuredClone(payload), breakpoints: structuredClone(target) };
  if (source.length !== target.length ||
      source.some((b, i) => b.maxWidth !== target[i].maxWidth)) return null;
  const ids = new Map([["base", "base"], ...source.map((b, i) => [b.id, target[i].id] as [string, string])]);
  const copy = structuredClone(payload);
  for (const node of [...copy.nodes, ...copy.componentNodes]) {
    if (Object.keys(node.styles).some((id) => !ids.has(id)) ||
        node.hiddenOn?.some((id) => !ids.has(id))) return null;
    node.styles = Object.fromEntries(Object.entries(node.styles).map(([id, styles]) => [ids.get(id)!, styles]));
    if (node.hiddenOn) node.hiddenOn = node.hiddenOn.map((id) => ids.get(id)!);
  }
  copy.breakpoints = structuredClone(target);
  return copy;
}

/** 要素の形（貼り付けたときに文書を壊さないよう、子の参照が中でそろっているかまで見る） */
function validNodes(nodes: unknown, roots?: unknown): nodes is DocNode[] {
  if (!Array.isArray(nodes)) return false;
  const ids = new Set<string>();
  for (const n of nodes as DocNode[]) {
    if (
      !n || typeof n !== "object" || typeof n.id !== "string" || !validDocNodeShape(n) || !Array.isArray(n.children) ||
      n.children.some((c) => typeof c !== "string") || ids.has(n.id)
    ) {
      return false;
    }
    ids.add(n.id);
  }
  if ((nodes as DocNode[]).some((n) => n.children.some((c) => !ids.has(c)))) return false;
  if (roots !== undefined && (!Array.isArray(roots) || roots.length === 0 ||
      roots.some((r) => typeof r !== "string" || !ids.has(r)))) return false;
  // 子の存在だけでは循環・二重所有・深すぎるツリーを防げない。保存時と同じ境界を適用する。
  const pages = roots === undefined ? {} : { clip: { id: "clip", slug: "", children: roots } };
  return validNodeForest(pages, Object.fromEntries(nodes.map((node: DocNode) => [node.id, node])));
}

function isPayload(v: unknown): v is ClipPayload {
  const p = v as ClipPayload | null;
  return (
    !!p && p.v === 1 && typeof p.site === "string" && Array.isArray(p.breakpoints) && Array.isArray(p.rootIds) &&
    validNodes(p.nodes, p.rootIds) &&
    !!p.assets && typeof p.assets === "object" && !Array.isArray(p.assets) &&
    Object.entries(p.assets).every(([id, asset]) => validAssetEntry(id, asset)) &&
    !!p.components && typeof p.components === "object" && !Array.isArray(p.components) &&
    validNodes(p.componentNodes, Object.keys(p.components).length
      ? Object.values(p.components).map(c => c.rootId) : undefined) &&
    validNodeForest({}, Object.fromEntries(p.componentNodes.map(n => [n.id, n])), p.components) &&
    Array.isArray(p.customFonts) && validSiteAdditionalFields({ customFonts: p.customFonts }) &&
    validClipDependencies(p)
  );
}

/** Reject missing or discarded dependencies before a paste can change the document. */
function validClipDependencies(p: ClipPayload): boolean {
  const assetRef = (value: { assetId?: string } | null | undefined): boolean =>
    value?.assetId === undefined || (Object.hasOwn(p.assets, value.assetId) && isSafeClipAsset(p.assets[value.assetId]));
  return [...p.nodes, ...p.componentNodes].every(node =>
    (node.type !== "instance" || (typeof node.componentId === "string" && Object.hasOwn(p.components, node.componentId))) &&
    assetRef(node.image) && assetRef(node.media) && (node.media?.sources ?? []).every(assetRef));
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

/** Extract plain text without leaving nested tag-shaped fragments behind. */
function clipboardText(html: string): string {
  let result = "";
  for (let index = 0; index < html.length;) {
    if (html[index] !== "<") { result += html[index++]; continue; }
    let end = index + 1;
    let quote = "";
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote) { if (ch === quote) quote = ""; }
      else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === ">") break;
    }
    if (end === html.length) { result += html[index++]; continue; }
    const tag = html.slice(index, end + 1);
    if (/^<br(?:\s[^<>]*)?\s*\/?>$/i.test(tag)) result += "\n";
    index = end + 1;
  }
  return result;
}

/** 要素の文字（ほかのアプリに貼り付けたときに出す） */
function plainText(nodes: DocNode[]): string {
  return nodes
    .map((n) => clipboardText(n.text?.content ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/** System clipboards accept standard HTML and text; custom web formats are optional. */
const CLIP_WEB_MIME = `web ${CLIP_MIME}`;
const MAX_CLIP_HTML = 48 * 1024 * 1024;

export function clipHtml(payload: ClipPayload): string {
  const escaped = plainText(payload.nodes).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<span data-tsumu-clipboard="${encodeURIComponent(JSON.stringify(payload))}">${escaped}</span>`;
}

/** Read the current Tsumu payload without interpreting arbitrary pasted HTML as code. */
export function clipboardPayload(data: Pick<DataTransfer, "getData">): ClipPayload | null {
  const direct = data.getData(CLIP_MIME) || data.getData(CLIP_WEB_MIME);
  if (direct) return parseClipPayload(direct);
  const html = data.getData("text/html");
  if (!html || html.length > MAX_CLIP_HTML) return null;
  const encoded = /\\bdata-tsumu-clipboard="([^"]+)"/i.exec(html)?.[1];
  if (!encoded) return null;
  try {
    return parseClipPayload(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

/** Write rich editor content with the modern asynchronous Clipboard API. */
export function writeClipPayload(payload: ClipPayload): void {
  const raw = JSON.stringify(payload);
  try {
    window.localStorage.setItem(CLIP_MIRROR_KEY, raw);
  } catch {
    // The browser-only clipboard mirror is optional.
  }
  try {
    const text = plainText(payload.nodes);
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      const formats: Record<string, Blob> = {
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([clipHtml(payload)], { type: "text/html" }),
      };
      if (typeof ClipboardItem.supports === "function" && ClipboardItem.supports(CLIP_WEB_MIME)) {
        formats[CLIP_WEB_MIME] = new Blob([raw], { type: CLIP_MIME });
      }
      void navigator.clipboard.write([new ClipboardItem(formats)]).catch(() => {});
    } else if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch {
    // Restricted clipboard permissions must not interrupt in-editor copy/paste.
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
 * 戻り値はアセットIDの対応と、新しく取り込んだマスターの要素。
 */
export function mergeClipDeps(
  d: SiteDoc, p: ClipPayload, { preserveSourceOnCollision = false }: { preserveSourceOnCollision?: boolean } = {},
): {
  assetIds: Map<string, string>;
  componentIds: Map<string, string>;
  componentNodes: DocNode[];
} {
  const remap = new Map<string, string>();
  const added: Asset[] = [];
  const scriptGroups = new Set(Object.values(p.assets).filter(a => a && isZipJavascript(a)).map(a => a.zip!.group));
  for (const a of Object.values(p.assets)) {
    if (!a || typeof a.id !== "string" || !a.id || !isSafeClipAsset(a)) continue;
    const existing = d.assets[a.id];
    // Identical stylesheet bytes may resolve differently in different archives.
    // JS 内の相対参照は ID の付け替えでは直せないため、同じ内容でも元の ZIP パスを残す。
    const sameLocation = (b: Asset) => !a.zip || !scriptGroups.has(a.zip.group) ||
      (b.zip?.group === a.zip.group && b.zip.path === a.zip.path);
    const sameFile = (b: Asset) => sameLocation(b) && Boolean((a.path && b.path === a.path) || (a.dataUrl && b.dataUrl === a.dataUrl));
    const sameSheet = (b: Asset) => JSON.stringify(a.zip) === JSON.stringify(b.zip);
    if (existing && sameFile(existing) && ((!zipStylesheet(a) && !zipStylesheet(existing)) || sameSheet(existing))) continue;
    const same = !zipStylesheet(a) && Object.values(d.assets).find((b) => !zipStylesheet(b) && sameFile(b));
    if (same) remap.set(a.id, same.id);
    else {
      const copy = structuredClone(a);
      if (existing) {
        do { copy.id = genId("asset"); } while (d.assets[copy.id] || p.assets[copy.id]);
        remap.set(a.id, copy.id);
      }
      d.assets[copy.id] = copy;
      added.push(copy);
    }
  }
  // Remap only dependency identities, never arbitrary CSS source text containing an ID.
  for (const asset of added) {
    for (const ref of zipStylesheet(asset)?.references ?? []) ref.assetId = remap.get(ref.assetId) ?? ref.assetId;
  }
  // A copied site can retain the same component IDs even after both sites
  // independently edit their masters. Never bind an external instance to the
  // unrelated destination master just because their IDs happen to match.
  const componentIds = new Map<string, string>();
  const components = Object.values(p.components).filter(
    (c) => preserveSourceOnCollision || !d.components?.[c.id]
  );
  const occupied = new Set([...Object.keys(d.components ?? {}), ...Object.keys(p.components)]);
  for (const c of components) {
    if (!d.components?.[c.id]) continue;
    let id: string;
    do { id = genId("comp"); } while (occupied.has(id));
    occupied.add(id);
    componentIds.set(c.id, id);
  }
  const sourceNodes = new Map(p.componentNodes.map((n) => [n.id, n]));
  const needed = new Set<string>();
  const pending = components.map((c) => c.rootId);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const node = sourceNodes.get(id);
    if (!node || needed.has(id)) continue;
    needed.add(id);
    pending.push(...node.children);
  }
  // 複製したサイトでは、同じIDの要素が別々に編集されていることがある。
  // 新しいマスターに既存の要素を流用すると、そのマスターの編集・削除で元の要素まで壊れる。
  const used = new Set([...Object.keys(d.nodes), ...needed]);
  const nodeIds = new Map<string, string>();
  for (const id of needed) {
    let target = id;
    if (d.nodes[id]) {
      do { target = genId("node"); } while (used.has(target));
    }
    used.add(target);
    nodeIds.set(id, target);
  }
  for (const c of components) {
    const copy = structuredClone(c);
    copy.id = componentIds.get(c.id) ?? c.id;
    copy.rootId = nodeIds.get(c.rootId) ?? c.rootId;
    d.components = { ...(d.components ?? {}), [copy.id]: copy };
  }
  const componentNodes: DocNode[] = [];
  for (const id of needed) {
    const node = remapAssetIds(structuredClone(sourceNodes.get(id)!), remap);
    node.id = nodeIds.get(id)!;
    node.children = node.children.map((child) => nodeIds.get(child) ?? child);
    if (node.type === "instance" && node.componentId) {
      node.componentId = componentIds.get(node.componentId) ?? node.componentId;
    }
    // スクリプト画面もIDで編集・削除するため、コピー元と別のIDにする。
    if (node.scripts) {
      node.scripts = node.scripts.map((s) => ({ ...s, id: scriptUid(), steps: cloneSteps(s.steps) }));
    }
    d.nodes[node.id] = node;
    componentNodes.push(node);
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
  return { assetIds: remap, componentIds, componentNodes };
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
    if (typeof a.dataUrl !== "string" || (!/^data:(?:image|video|audio|font)\//i.test(a.dataUrl) &&
        !(zipStylesheet(a) && /\.css$/i.test(a.name) && /^data:text\/css(?:;charset=utf-8)?(?:;base64)?,/i.test(a.dataUrl)))) {
      return false;
    }
  }
  return Boolean(a.path || a.dataUrl);
}

/** Remap asset references without rewriting structural IDs, ordinary text or stored file URLs. */
export function remapAssetIds<T>(value: T, remap: Map<string, string>): T {
  if (!remap.size) return value;
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (typeof item !== "string") return item;
    // Each original reference is mapped once, even when its destination ID
    // is another source ID. Property names and unrelated strings stay intact.
    if (key === "assetId") return remap.get(item) ?? item;
    return item.replace(/tsumu-zip-css:([A-Za-z0-9%._~-]+)/g, (token, encoded: string) => {
      try {
        const id = remap.get(decodeURIComponent(encoded));
        return id === undefined ? token : `tsumu-zip-css:${encodeURIComponent(id)}`;
      } catch { return token; }
    });
  });
  return JSON.parse(json) as T;
}
