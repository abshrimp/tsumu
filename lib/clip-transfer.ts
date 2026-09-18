"use client";

/**
 * サイトをまたいだ要素のコピーと貼り付け。
 * コピーした要素を、使っているアセット・コンポーネント・フォントと一緒に、
 * OS のクリップボード（エディタ専用の形式）とブラウザ内の保存に書き出す。
 * 別のタブやウィンドウで開いた別のサイトでも、⌘V で同じものを貼り付けられる
 */

import type { Asset, BreakpointDef, Component, CustomFont, DocNode, Page, SiteDoc } from "./types";
import { assetSrc } from "./assets";
import { createCssAssetFinder } from "./css-asset-dependencies";
import { zipAssetClosure, zipStylesheet } from "./zip-css";
import { zipMime } from "./zip-mime";
import { tr } from "./i18n";
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
/** 右クリックメニューの「貼り付け」に使う控え（全サイト共通） */
const CLIP_MIRROR_KEY = storageKey("clipboard-v1");

export interface ClipPayload {
  v: 1;
  /** コピー元のサイト */
  site: string;
  /** コピー元のサイトの画面幅の設定。貼り付け先で参照を変換するために必要。 */
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

  // ID や URL が書かれているアセット（画像の要素・背景・スクリプトなど、使い方は問わない）
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
  // JS の相対参照はアセットの内容の中にあり、ここでは読み取れない。
  // 未使用の削除の判定と同じく、使用中のスクリプトを含む ZIP の一式をコピーする。
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

/** 参照を、コピーしたときと同じ画面幅の設定に移す。対応できなければ、文書を変えずに断る。 */
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
  // すべての画面幅で共通の指定だけなら、画面幅の設定が異なっていても表示を保てる。
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

/** 要素の形（貼り付けたときに文書を壊さないよう、子の参照が中でそろっているかまで確かめる） */
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
  // 子が存在することを確かめるだけでは、循環・二重の所有・深すぎるツリーを防げない。保存時と同じ範囲の制限を適用する。
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

/** 貼り付けで文書を変える前に、欠けた依存関係や捨てられた依存関係を拒否する。 */
function validClipDependencies(p: ClipPayload): boolean {
  const assetRef = (value: { assetId?: string } | null | undefined): boolean =>
    value?.assetId === undefined || (Object.hasOwn(p.assets, value.assetId) && isSafeClipAsset(p.assets[value.assetId]));
  return [...p.nodes, ...p.componentNodes].every(node =>
    (node.type !== "instance" || (typeof node.componentId === "string" && Object.hasOwn(p.components, node.componentId))) &&
    assetRef(node.image) && assetRef(node.media) && (node.media?.sources ?? []).every(assetRef));
}

/**
 * クリップボードの中身が、このブラウザのエディタでコピーしたものか。
 * クリップボードのエディタ専用の形式は、どのウェブサイトでも copy のときに書き込めるため、
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

/** 貼り付けると、エディタの中で HTML として動く要素（カスタムコード・アイコン）の名前 */
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

/** OS のクリップボードは標準の HTML とテキストを受け付ける。独自のウェブ形式は無くてもよい。 */
const CLIP_WEB_MIME = `web ${CLIP_MIME}`;
const MAX_CLIP_HTML = 48 * 1024 * 1024;

export function clipHtml(raw: string, text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<span data-tsumu-clipboard="${encodeURIComponent(raw)}" style="white-space: pre-wrap">${escaped}</span>`;
}

/** 現在の Tsumu のデータを読む。任意の貼り付けられた HTML を、コードとして解釈しない。 */
export function clipboardPayload(data: Pick<DataTransfer, "getData">): { payload: ClipPayload; raw: string } | null {
  let raw = data.getData(CLIP_MIME) || data.getData(CLIP_WEB_MIME);
  if (!raw) {
    const html = data.getData("text/html");
    if (!html || html.length > MAX_CLIP_HTML) return null;
    const encoded = /\bdata-tsumu-clipboard="([^"]+)"/i.exec(html)?.[1];
    if (!encoded) return null;
    try {
      raw = decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  const payload = parseClipPayload(raw);
  return payload ? { payload, raw } : null;
}

/** 新しい非同期の Clipboard API で、エディタの内容を形式付きで書き込む。 */
export function writeClipPayload(payload: ClipPayload): void {
  const raw = JSON.stringify(payload);
  try {
    window.localStorage.setItem(CLIP_MIRROR_KEY, raw);
  } catch {
    // ブラウザ内だけのクリップボードの控えは、無くてもよい。
  }
  try {
    const text = payload.nodes.map(node => node.text?.content).filter(Boolean).join("\n");
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      const formats: Record<string, Blob> = {
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([clipHtml(raw, text)], { type: "text/html" }),
      };
      if (typeof ClipboardItem.supports === "function" && ClipboardItem.supports(CLIP_WEB_MIME)) {
        formats[CLIP_WEB_MIME] = new Blob([raw], { type: CLIP_MIME });
      }
      void navigator.clipboard.write([new ClipboardItem(formats)]).catch(() => {});
    } else if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch {
    // クリップボードの権限が制限されていても、エディタ内のコピーと貼り付けは止めない。
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
 * 貼り付け先の文書に、コピー元のアセット・コンポーネント・フォントを追加する（updateDoc の中で呼ぶ）。
 * 同じファイルのアセットがすでにあればそれを使い、要素の参照をそちらに付け替える。
 * 戻り値は、アセットの ID の対応と、新しく取り込んだマスターの要素。
 */
export function mergeClipDeps(
  d: SiteDoc, p: ClipPayload,
  { preserveSourceOnCollision = false, htmlZipAssetIds }: {
    preserveSourceOnCollision?: boolean;
    htmlZipAssetIds?: ReadonlySet<string>;
  } = {},
): {
  assetIds: Map<string, string>;
  componentIds: Map<string, string>;
  componentNodes: DocNode[];
} {
  const remap = new Map<string, string>();
  // 貼り付け先を書き換える前に、明示されたページとの対応をすべて確かめる。
  // 貼り付け先にある無関係なアセットが、欠けているアセットと同じ ID を持っていることがある。
  const pageAssets = new Set<Asset>();
  for (const id of htmlZipAssetIds ?? []) {
    const asset = p.assets[id];
    const path = asset?.zip?.path;
    if (!Object.hasOwn(p.assets, id) || !validAssetEntry(id, asset) || !path ||
        /[\\\u0000-\u001f\u007f]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..") ||
        disallowedClipFilename.test(path.trim()) || !isSafeClipAsset(asset, zipMime(path))) {
      throw new Error(tr("Asset references are invalid."));
    }
    pageAssets.add(asset);
  }
  const added: Asset[] = [];
  const scriptGroups = new Set(Object.values(p.assets).filter(a => a && isZipJavascript(a)).map(a => a.zip!.group));
  for (const a of Object.values(p.assets)) {
    if (!a || typeof a.id !== "string" || !a.id || (!pageAssets.has(a) && !isSafeClipAsset(a))) continue;
    const existing = d.assets[a.id];
    // 内容が同じスタイルシートでも、アーカイブが違えば解決される参照先が異なることがある。
    // JS 内の相対参照は ID の付け替えでは直せないため、同じ内容でも元の ZIP のパスを残す。
    // ZIP をそのまま使うページも、各アセットの情報を通して相対パスを解決する。
    const needsZipPath = a.zip && (scriptGroups.has(a.zip.group) || htmlZipAssetIds?.has(a.id));
    const sameLocation = (b: Asset) => !needsZipPath ||
      (b.zip?.group === a.zip!.group && b.zip?.path === a.zip!.path);
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
  // 付け替えるのは依存関係の ID だけで、ID を含む任意の CSS の本文は書き換えない。
  for (const asset of added) {
    for (const ref of zipStylesheet(asset)?.references ?? []) ref.assetId = remap.get(ref.assetId) ?? ref.assetId;
  }
  // 複製したサイトでは、両方のサイトでマスターを別々に編集した後も、同じコンポーネントの ID が
  // 残っていることがある。ID がたまたま一致するというだけで、外から来たインスタンスを
  // 貼り付け先の無関係なマスターに結び付けてはいけない。
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
  // 複製したサイトでは、同じ ID の要素が別々に編集されていることがある。
  // 新しいマスターに既存の要素を流用すると、そのマスターの編集や削除で元の要素まで壊れる。
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
    // スクリプトの画面も ID で編集・削除するため、コピー元とは別の ID にする。
    if (node.scripts) {
      node.scripts = node.scripts.map((s) => ({ ...s, id: scriptUid(), steps: cloneSteps(s.steps) }));
    }
    d.nodes[node.id] = node;
    componentNodes.push(node);
  }
  for (const f of p.customFonts) {
    // 名前は公開するサイトのコードに入るため、Google Fonts の名前の形をしたものだけを受け取る
    const valid =
      typeof f?.family === "string" && /^[A-Za-z][A-Za-z0-9 ]{0,63}$/.test(f.family) &&
      (f.weights === "variable" || (Array.isArray(f.weights) && f.weights.every((w) => /^\d{3}$/.test(String(w)))));
    if (valid && !(d.customFonts ?? []).some((x) => x.family === f.family)) {
      d.customFonts = [...(d.customFonts ?? []), structuredClone(f)];
    }
  }
  return { assetIds: remap, componentIds, componentNodes };
}

const disallowedClipFilename = /\.(?:x?html?|mhtml|shtml|xml)$/i;

/** クリップボードのアセットが安全か（HTML や、不正なパス・スキームは受け取らない） */
function isSafeClipAsset(a: Asset, pageZipMime?: string): boolean {
  if (typeof a.name !== "string" || disallowedClipFilename.test(a.name.trim())) return false;
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
    if (typeof a.dataUrl !== "string") return false;
    const media = /^data:(?:image|video|audio|font)\//i.test(a.dataUrl);
    const style = zipStylesheet(a) && /\.css$/i.test(a.name) &&
      /^data:text\/css(?:;charset=utf-8)?(?:;base64)?,/i.test(a.dataUrl);
    // ローカルのスクリプト・JSON・その他の ZIP のバイトを運べるのは、ページのコピーだけ。
    // ZIP の取り込みで記録した MIME と、data URL の MIME が一致していることを求める。
    const binaryMedia = pageZipMime && /^(?:image|audio|video|font)\//.test(pageZipMime) &&
      a.mimeType === "application/octet-stream";
    const embedded = pageZipMime && pageZipMime !== "text/css" && (pageZipMime === a.mimeType || binaryMedia) &&
      /^data:([^;,]+)(?:;charset=utf-8)?(?:;base64)?,/i.exec(a.dataUrl)?.[1].toLowerCase() === a.mimeType;
    if (!media && !style && !embedded) return false;
  }
  return Boolean(a.path || a.dataUrl);
}

/** 構造の ID・通常のテキスト・保存したファイルの URL は書き換えずに、アセットの参照だけを付け替える。 */
export function remapAssetIds<T>(value: T, remap: Map<string, string>): T {
  if (!remap.size) return value;
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (typeof item !== "string") return item;
    // 元の参照は、付け替え先の ID が別のコピー元の ID であっても、それぞれ1回だけ付け替える。
    // プロパティ名と無関係な文字列はそのまま残す。
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
