"use client";

import { create } from "zustand";
import type {
  Asset,
  Breakpoint,
  DocNode,
  Page,
  ScriptStep,
  SiteDoc,
  StyleState,
} from "./types";
import { BODY_NODE_ID } from "./types";
import { newPageName, renamePage, setPageTitle } from "./pageTitle";
import { createInitialDoc, genId } from "./presets";
import { canContainElements } from "./tags";
import {
  applyBreakpoints,
  BP_INFO,
  BP_ORDER,
  breakpointForWidth,
  isHiddenAt,
  nextHiddenOn,
} from "./style";
import { retargetPageUrl } from "./vars";
import { mergeDocs, rebaseNodePatch } from "./merge";
import type { DocPatch } from "./doc-patch";
import { showAlert, showConfirm } from "./dialog";
import { refreshClonedIds } from "./cloneIds";
import { tr } from "./i18n";
import { readLocalStorage } from "./local-storage";
import { currentSiteId, siteKey, touchLocalSite } from "./site";
import { readBrowserDoc, writeBrowserDoc } from "./browser-doc-storage";
import { localSaveBlock, type LocalSaveResult } from "./local-save";
import {
  buildClipPayload,
  mergeClipDeps,
  prepareClipBreakpoints,
  remapAssetIds,
  writeClipPayload,
  type ClipPayload,
} from "./clip-transfer";
import { storageKey } from "./storage-keys";
import { withPageScripts, type PageScript } from "./script";
import { MAX_NODE_DEPTH, maxSubtreeDepth, validSiteDoc } from "./doc-tree";
import { sameDocContent, shareUnchangedDoc } from "./doc-share";

const PUBLISHED_KEY = siteKey(storageKey("published-v1"));
const PUBLISHED_HASH_KEY = siteKey(storageKey("published-hash-v1"));
const ACTIVE_PAGE_KEY = siteKey(storageKey("active-page-v1"));
/** 前回の編集の位置（選択・デバイス・倍率・タブなど）。次に開いたときに戻す */
const UI_KEY = siteKey(storageKey("ui-v1"));
const HISTORY_LIMIT = 100;

export type EditorMode = "design" | "preview";
export type LeftTab = "layers" | "add" | "pages" | "assets" | "site";
export type RightTab = "style" | "settings";

const LEFT_TABS: LeftTab[] = ["layers", "add", "pages", "assets", "site"];

/** 前回の編集の位置として保存する項目 */
interface SavedUi {
  selection: string | null;
  selectedIds: string[];
  breakpoint: Breakpoint;
  customWidth: number | null;
  zoom: number;
  leftTab: LeftTab;
  rightTab: RightTab;
  editingComponentId: string | null;
  scriptEditor: { focusNodeId: string | null; focusScriptId?: string } | null;
}

function pickUi(s: SavedUi): SavedUi {
  return {
    selection: s.selection,
    selectedIds: s.selectedIds,
    breakpoint: s.breakpoint,
    customWidth: s.customWidth,
    zoom: s.zoom,
    leftTab: s.leftTab,
    rightTab: s.rightTab,
    editingComponentId: s.editingComponentId,
    scriptEditor: s.scriptEditor,
  };
}

/** 保存した編集の位置のうち、今の文書で有効なものだけを読み戻す */
function loadUi(doc: SiteDoc): Partial<SavedUi> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    if (!raw) return {};
    const u = JSON.parse(raw) as Partial<SavedUi>;
    const out: Partial<SavedUi> = {};
    const editingComponentId =
      u.editingComponentId && doc.components?.[u.editingComponentId] ? u.editingComponentId : null;
    out.editingComponentId = editingComponentId;
    const selectedIds = validSelectedIds(doc, Array.isArray(u.selectedIds) ? u.selectedIds : []);
    const selection = validSelection(doc, u.selection ?? null);
    out.selection = selection ?? selectedIds[selectedIds.length - 1] ?? null;
    out.selectedIds = selection && !selectedIds.includes(selection) ? [selection] : selectedIds;
    if (u.breakpoint && BP_ORDER.includes(u.breakpoint)) out.breakpoint = u.breakpoint;
    if (typeof u.customWidth === "number") out.customWidth = u.customWidth;
    if (typeof u.zoom === "number" && u.zoom >= 0 && u.zoom <= 3) out.zoom = u.zoom;
    if (u.leftTab && LEFT_TABS.includes(u.leftTab)) out.leftTab = u.leftTab;
    if (u.rightTab === "style" || u.rightTab === "settings") out.rightTab = u.rightTab;
    if (u.scriptEditor && typeof u.scriptEditor === "object") {
      const f = u.scriptEditor.focusNodeId;
      out.scriptEditor = {
        focusNodeId: f && doc.nodes[f] ? f : null,
        ...(u.scriptEditor.focusScriptId ? { focusScriptId: u.scriptEditor.focusScriptId } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}
export type CloudState = "checking" | "synced" | "saving" | "local" | "error";

/** 公開済みかどうかを判定するため、文書の内容のハッシュ（FNV-1a）を返す */
export function docFingerprint(doc: SiteDoc): string {
  const text = JSON.stringify(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

export interface ParentRef {
  kind: "page" | "node";
  id: string;
}

export function findParentOf(doc: SiteDoc, nodeId: string): ParentRef | null {
  for (const page of Object.values(doc.pages)) {
    if (page.children.includes(nodeId)) return { kind: "page", id: page.id };
  }
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(nodeId)) return { kind: "node", id: node.id };
  }
  return null;
}

type ParentIndex = Map<string, { ref: ParentRef; position: number }>;

/** 操作ごとに1回作る。updateDoc の書き換え用の下書きどうしで、キャッシュした索引を決して共有しない。 */
export function indexParents(doc: SiteDoc): ParentIndex {
  const parents: ParentIndex = new Map();
  const add = (children: string[], ref: ParentRef) => children.forEach((id, position) => {
    // findParentOf と同じく、ページを先に、次にノードを追加した順に優先する。
    if (!parents.has(id)) parents.set(id, { ref, position });
  });
  for (const page of Object.values(doc.pages)) add(page.children, { kind: "page", id: page.id });
  for (const node of Object.values(doc.nodes)) add(node.children, { kind: "node", id: node.id });
  return parents;
}

function indexedAncestors(parents: ParentIndex, nodeId: string): string[] {
  const out: string[] = [];
  const seen = new Set([nodeId]);
  let parent = parents.get(nodeId)?.ref;
  while (parent?.kind === "node" && !seen.has(parent.id)) {
    seen.add(parent.id);
    out.push(parent.id);
    parent = parents.get(parent.id)?.ref;
  }
  return out.reverse();
}

/** 選んだ子孫は、最も近い選んだ祖先と一緒に移動・コピーする。 */
function selectedRoots(ids: readonly string[], parents: ParentIndex): string[] {
  const selected = new Set(ids);
  return [...selected].filter((id) =>
    !indexedAncestors(parents, id).some((ancestor) => selected.has(ancestor))
  );
}

/** nodeId が、どれかのコンポーネントのマスターに属しているか */
export function componentOf(doc: SiteDoc, nodeId: string): string | null {
  const components = Object.values(doc.components ?? {});
  if (!components.length) return null;

  const ancestors = new Set([nodeId, ...indexedAncestors(indexParents(doc), nodeId)]);
  // 入れ子のマスターのルートでは、これまでと同じコンポーネントの順の優先順位を保つ。
  for (const comp of components) {
    if (ancestors.has(comp.rootId)) return comp.id;
  }
  return null;
}

/** 選んだ部分木を文書の順にたどる。重なる選択も1回だけ扱う。 */
export function collectSubtreeIds(doc: SiteDoc, roots: readonly string[]): Set<string> {
  const ids = new Set<string>();
  const pending = [...roots].reverse();
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
  }
  return ids;
}

export function collectDescendants(doc: SiteDoc, nodeId: string): string[] {
  return [...collectSubtreeIds(doc, [nodeId])];
}

/**
 * compIds のコンポーネントと、その中で（入れ子も含めて）使っているコンポーネントの ID。
 * コンポーネントの中に自分自身を入れると無限に入れ子になるため、その判定に使う
 */
export function componentsReachable(doc: SiteDoc, compIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const pending = [...compIds];
  // コンポーネントのグラフは、通常のノードのツリーよりはるかに深くなりうる。文書の中の
  // コンポーネントがそれぞれ正しくても、再帰呼び出しは使わない。
  for (let cid = pending.pop(); cid !== undefined; cid = pending.pop()) {
    const comp = doc.components?.[cid];
    if (!comp || out.has(cid)) continue;
    out.add(cid);
    for (const id of collectDescendants(doc, comp.rootId)) {
      const n = doc.nodes[id];
      if (n?.type === "instance" && n.componentId) pending.push(n.componentId);
    }
  }
  return out;
}

/** インスタンスをマスターの中へ移動・挿入しても、そのマスターが自分自身を描画するようにはならないことを確かめる。 */
function canPlaceComponentNodes(
  doc: SiteDoc,
  parent: ParentRef,
  rootIds: readonly string[],
  inputNodes: Record<string, DocNode> = doc.nodes,
): boolean {
  const owner = parent.kind === "node" ? componentOf(doc, parent.id) : null;
  const referenced = new Set<string>();
  const pending = [...rootIds];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = inputNodes[id];
    if (!node) return false;
    if (node.type === "instance") {
      if (!node.componentId || !doc.components?.[node.componentId]) return false;
      referenced.add(node.componentId);
    }
    pending.push(...node.children);
  }
  return !owner || !componentsReachable(doc, referenced).has(owner);
}

/**
 * 複製したページの URL。「[slug]」の区切りに文字を足すと使えない URL になるため、
 * その手前の区切りに -copy を付ける（products/[slug] → products-copy/[slug]）
 */
export function copySlug(slug: string, n: number): string {
  const suffix = n > 1 ? `copy-${n}` : "copy";
  const segs = slug.split("/");
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i] && segs[i] !== "[slug]") {
      segs[i] += `-${suffix}`;
      return segs.join("/");
    }
  }
  return slug ? `${suffix}/${slug}` : suffix;
}

/** 「ページ 3」「page-3」のように、他のページと重ならない名前と URL にする */
export function uniquePageNaming(
  doc: SiteDoc,
  name: (n: number) => string,
  slug: (n: number) => string,
  start: number
): { name: string; slug: string } {
  const names = new Set(Object.values(doc.pages).map((p) => p.name));
  const slugs = new Set(Object.values(doc.pages).map((p) => p.slug));
  let n = start;
  while (names.has(name(n)) || slugs.has(slug(n))) n++;
  return { name: name(n), slug: slug(n) };
}

/** 親から順に並べた祖先のノードの ID（ページの直下の要素なら空） */
export function ancestorsOf(doc: SiteDoc, nodeId: string): string[] {
  return indexedAncestors(indexParents(doc), nodeId);
}

/** ツリー上の位置（上から並べたときの順序の比較に使う） */
function treePosition(parents: ParentIndex, nodeId: string): number[] {
  const out: number[] = [];
  const seen = new Set([nodeId]);
  let cur = parents.get(nodeId);
  while (cur) {
    out.push(cur.position);
    if (cur.ref.kind === "page" || seen.has(cur.ref.id)) break;
    seen.add(cur.ref.id);
    cur = parents.get(cur.ref.id);
  }
  return out.reverse();
}

function sortInTreeOrder(ids: string[], parents: ParentIndex): string[] {
  const positions = new Map(ids.map((id) => [id, treePosition(parents, id)]));
  return ids.sort((a, b) => comparePosition(positions.get(a)!, positions.get(b)!));
}

function comparePosition(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function validSelection(doc: SiteDoc, id: string | null): string | null {
  return id && (id === BODY_NODE_ID || doc.nodes[id]) ? id : null;
}

function validSelectedIds(doc: SiteDoc, ids: string[]): string[] {
  return ids.filter((id) => id === BODY_NODE_ID || !!doc.nodes[id]);
}

/** パネルからの変更を適用する要素（複数選択中で nodeId を含むなら、選択中のすべての要素） */
function targetIdsFor(selectedIds: string[], nodeId: string): string[] {
  return selectedIds.length > 1 && selectedIds.includes(nodeId)
    ? selectedIds
    : [nodeId];
}

function childrenOf(doc: SiteDoc, ref: ParentRef): string[] {
  return ref.kind === "page" ? doc.pages[ref.id].children : doc.nodes[ref.id].children;
}

/** 要素を追加・貼り付けする位置の決め方: 選んだボックスの中（入れられなければ後ろ）/ 常に選んだ要素の後ろ */
export type InsertMode = "inside" | "after";
const INSERT_MODE_KEY = storageKey("insert-mode-v1");

function loadInsertMode(): InsertMode {
  try {
    return window.localStorage.getItem(INSERT_MODE_KEY) === "after" ? "after" : "inside";
  } catch {
    return "inside";
  }
}

/**
 * 選んでいる要素に対して、追加・貼り付けする位置。
 * inside: 中に要素を入れられるボックスならその末尾、それ以外は後ろ（兄弟）。
 * after: 常に選んだ要素のすぐ後ろ（兄弟）。何も選んでいなければ fallback の末尾
 */
export function insertPointFor(
  doc: SiteDoc,
  selection: string | null,
  fallback: ParentRef,
  mode: InsertMode
): { parent: ParentRef; index?: number } {
  const selected = selection && selection !== BODY_NODE_ID ? doc.nodes[selection] : null;
  if (!selected) return { parent: fallback };
  const parent = findParentOf(doc, selected.id);
  if (canContainElements(selected) && (mode === "inside" || !parent)) {
    return { parent: { kind: "node", id: selected.id } };
  }
  if (!parent) return { parent: fallback };
  return { parent, index: childrenOf(doc, parent).indexOf(selected.id) + 1 };
}

// タブごとの基準。古いタブが、別のタブの文書を上書きすることはできない。
let lastKnownBrowserRaw: string | null = null;
let browserSnapshotUnavailable = false;
let browserHydration: Promise<void> | null = null;
// 設定は、一時的な初期の文書ではなく、保存した文書を基準にする。
let browserPositionReady = false;

/** 前回開いていたページ。削除されていれば、先頭のページに戻す */
function loadActivePageId(doc: SiteDoc): string {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(ACTIVE_PAGE_KEY);
      if (saved && doc.pages[saved]) return saved;
    } catch {
      // localStorage を使えない場合は、先頭のページを使う
    }
  }
  return doc.pageOrder[0];
}

export interface EditorStore {
  doc: SiteDoc;
  /** 文書を読み替えるときに更新する、保存しない ID。非同期の処理を、別の文書へ持ち越さないために使う。 */
  documentSession: number;
  past: SiteDoc[];
  future: SiteDoc[];
  /** 元に戻す・やり直す操作と、文書の置き換えで進む。通常の編集や共同編集では変えない。 */
  historyRevision: number;
  activePageId: string;
  selection: string | null;
  /** 選択中のすべての要素。selection は、この配列の中の主選択（最後に選んだ要素） */
  selectedIds: string[];
  breakpoint: Breakpoint;
  /** キャンバスのカスタムの画面幅（null = ブレークポイントの表示幅） */
  customWidth: number | null;
  styleState: StyleState;
  mode: EditorMode;
  leftTab: LeftTab;
  editingText: string | null;
  /** 0 = 自動で合わせる */
  zoom: number;
  /** 動的なページのプレビューに使う項目のインデックス */
  previewIndex: number;
  setPreviewIndex: (i: number) => void;
  savedAt: number | null;
  publishedAt: number | null;
  /** 最後に公開した文書の docFingerprint */
  publishedFingerprint: string | null;
  cloudState: CloudState;
  cloudSavedAt: number | null;
  /** サーバーに保存できなかった理由（cloudState が error のときだけ。分からなければ null） */
  cloudError: string | null;

  select: (id: string | null) => void;
  /** Shift を押しながらのクリック用: 要素を今の選択に加え、選択済みなら選択を外す */
  toggleSelection: (id: string) => void;
  /** 選択中の要素の親を選ぶ（ページの直下なら body） */
  selectParent: () => void;
  /** 複数の要素をまとめて選ぶ（primary = 主選択） */
  selectMany: (ids: string[], primary: string) => void;
  /** 選択中の要素と同じ階層の要素をすべて選ぶ（何も選んでいなければ、ページの直下をすべて選ぶ） */
  selectAll: () => void;
  setBreakpoint: (bp: Breakpoint) => void;
  /** カスタムの幅を設定する（対応するブレークポイントへ自動で切り替える） */
  setCustomWidth: (w: number | null) => void;
  setStyleState: (s: StyleState) => void;
  setMode: (m: EditorMode) => void;
  setLeftTab: (t: LeftTab) => void;
  /** アセットのパネルで目立たせて表示するアセット（表示し終えたら null に戻す） */
  revealAssetId: string | null;
  /** アセットのパネルを開き、そのアセットまでスクロールして目立たせる */
  revealAsset: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  /** テキストの編集中に選んだ部分の範囲（スタイルを変えるときの span の分割に使う） */
  textSel: { nodeId: string; start: number; end: number; text: string } | null;
  setTextSel: (sel: EditorStore["textSel"]) => void;
  /**
   * テキストの一部を span として切り出す。親はテキストの情報（見出しのレベル）を
   * 保ったまま、before / 対象 / after の span の子要素に分かれる。
   * props を渡すと、切り出した span に、現在の (bp, state) でスタイルを適用する。
   * 成功したときは、新しい span の ID を返す（1回の「元に戻す」で戻せる）
   */
  splitTextSpan: (
    nodeId: string,
    start: number,
    end: number,
    text: string,
    props?: Record<string, string | null>
  ) => string | null;
  setZoom: (z: number) => void;
  markSaved: () => void;
  /** 公開した文書の内容のハッシュ（docFingerprint）と日時を記録する */
  markPublished: (fingerprint: string) => void;
  setCloud: (state: CloudState, savedAt?: number, error?: string) => void;
  /** サーバーから取得した文書で置き換える（履歴はリセットする） */
  replaceDoc: (doc: SiteDoc) => void;
  /** バックアップや公開済みの版の内容に戻す（「元に戻す」で戻せる。サーバーにも保存する） */
  restoreDoc: (doc: SiteDoc) => void;
  /**
   * 他の編集者の変更（WebSocket やポーリングで受け取ったもの）を取り込む。
   * 選択・表示中のページ・編集中のコンポーネントを、できる限り保つ
   */
  applyRemoteDoc: (doc: SiteDoc, patchHint?: { baseDoc: SiteDoc; patch: DocPatch }) => void;

  /** 追加・貼り付けする位置の決め方（ブラウザごとに覚える） */
  insertMode: InsertMode;
  setInsertMode: (m: InsertMode) => void;

  clipboard: ClipPayload | null;
  /** 要素をコピーする（複数選択中で nodeId を含むなら、選択中のすべての要素）。切り取りでは unlockedOnly で、削除する対象に合わせる。 */
  copyNode: (nodeId: string, opts?: { unlockedOnly?: boolean }) => void;
  /**
   * クリップボードの内容を、挿入先の設定（中へ / 後ろへ）に従って選択した位置に貼り付ける（何も選んでいなければページの末尾）。
   * external を渡すと、他のサイト（タブ）でコピーした要素を、使っているアセットやコンポーネントと一緒に貼り付ける
   */
  pasteClipboard: (external?: ClipPayload) => void;

  /**
   * 開いているスクリプトの画面（null = 閉じている）。
   * focusNodeId = 要素の設定から開いたときの要素 / focusScriptId = 開いたときに選んで見せるスクリプト
   */
  scriptEditor: { focusNodeId: string | null; focusScriptId?: string } | null;
  openScriptEditor: (
    opts: { focusNodeId: string | null; focusScriptId?: string } | null
  ) => void;

  /** 右のパネルのタブ（要素を選んでいるとき） */
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;

  /** 編集中のコンポーネントの ID（null ならページを編集している） */
  editingComponentId: string | null;
  setEditingComponent: (id: string | null) => void;
  /** ノードをコンポーネントにし、元の位置をインスタンスに置き換える */
  createComponent: (nodeId: string) => void;
  /** ボックスをテンプレートにしたリストを作り、元の位置をリストに置き換える */
  createList: (nodeId: string) => void;
  /** インスタンスを、マスターの複製（通常のノード）に展開する */
  detachInstance: (nodeId: string) => void;
  insertInstance: (componentId: string) => void;
  deleteComponent: (componentId: string) => void;

  checkpoint: () => void;
  /**
   * ドラッグでの数値の変更など、続けて起きる変更を1つの「元に戻す」にまとめる。
   * beginGesture から endGesture までの間の updateDoc は履歴を積まない（最初の変更の前だけを積む）。
   * beginGesture の戻り値で、自分の操作だけを終える。endGesture は、すべての操作を終える。
   * 非同期の配置は、すべての連続した編集が終わってから、別の履歴として適用する。
   */
  gestureActive: boolean;
  beginGesture: () => () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  /** history: 省略すると true。一時的な操作では、先に checkpoint() を呼び、history: false で更新する */
  updateDoc: (fn: (doc: SiteDoc) => void, opts?: { history?: boolean }) => void;
  /** 関係の無い文書の枝をコピーせずに、スクリプトを確定する。 */
  updatePageScripts: (pageId: string, nodeIds: string[], views: PageScript[]) => void;
  /** 中断した読み込みのファイルだけを、元に戻す・やり直す操作を壊さずに、すべての履歴に残す。 */
  retainUploadedAssets: (assets: Asset[]) => void;

  setStyleProps: (
    nodeId: string,
    props: Record<string, string | null>,
    opts?: { transient?: boolean }
  ) => void;
  updateNode: (nodeId: string, patch: Partial<DocNode>) => void;
  /**
   * 複数選択中で nodeId がその中にあれば選択中のすべての要素に、そうでなければ nodeId だけに fn を適用する
   * （スタイルのパネルからの変更を、まとめて反映するため。1回の「元に戻す」で戻せる）
   */
  updateTargets: (nodeId: string, fn: (node: DocNode) => void) => void;
  /** いま表示中のデバイス（と、それより小さい画面）で、表示と非表示を切り替える */
  toggleHiddenHere: (nodeId: string) => void;
  /** 指定したデバイスだけで、表示と非表示を切り替える */
  setHiddenAt: (nodeId: string, bp: Breakpoint, hide: boolean) => void;
  insertNodes: (
    nodes: DocNode[],
    rootId: string,
    parent: ParentRef,
    index?: number
  ) => void;
  deleteNode: (nodeId: string) => void;
  /**
   * 複数の要素をまとめて削除する（1回の「元に戻す」で戻せる）。
   * ロック中の要素と body は除き、選んだ要素の中にある要素は、親と一緒に消える
   */
  deleteNodes: (nodeIds: string[]) => void;
  duplicateNode: (nodeId: string) => void;
  /**
   * 複数の要素を、それぞれの後ろにまとめて複製し、複製を選ぶ（1回の「元に戻す」で戻せる）。
   * 選んだ要素の中にある要素は、親と一緒に複製される
   */
  duplicateNodes: (nodeIds: string[]) => void;
  moveNode: (nodeId: string, parent: ParentRef, index: number) => void;
  /** 複数の要素を、並び順のまま parent の index の位置へまとめて移動する */
  moveNodes: (nodeIds: string[], parent: ParentRef, index: number) => void;

  setActivePage: (id: string) => void;
  /**
   * 開いているページの次に作る（同じフォルダに入る）。
   * folderId を渡すと、そのフォルダの中に作る
   */
  addPage: (folderId?: string) => void;
  /** ページの一覧のフォルダを作り、その ID を返す（URL には関係しない、エディタの上での整理） */
  addPageFolder: () => string;
  renamePageFolder: (folderId: string, name: string) => void;
  /** フォルダを消す（中のページは消さず、フォルダの外に出す） */
  deletePageFolder: (folderId: string) => void;
  /**
   * ページをフォルダに入れる・出す（folderId = null でフォルダの外）。
   * before / after のページの前後に並べ、指定が無ければ、そのフォルダの末尾に置く
   */
  placePage: (
    pageId: string,
    folderId: string | null,
    anchor?: { before?: string; after?: string }
  ) => void;
  /** フォルダを並べ替える（index は、移動する前の並びでの位置） */
  moveFolder: (folderId: string, index: number) => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  /** 複数のページをまとめて削除する（1回の「元に戻す」で戻せる。最後の1ページは残す） */
  deletePages: (ids: string[]) => void;
  /**
   * 複数のページを、並び順のままフォルダに入れる・出す（folderId = null でフォルダの外）。
   * anchor のページの前後に並べ、指定が無ければ、そのフォルダの末尾に置く
   */
  movePagesToFolder: (
    ids: string[],
    folderId: string | null,
    anchor?: { before?: string; after?: string }
  ) => void;
  updatePage: (id: string, patch: Partial<Page>) => void;

  resetDoc: () => void;
}

/** ページの URL の変更に合わせて、リンク・スクリプト・転送先に直接入力した URL を書き換える */
function retargetPageUrls(
  doc: SiteDoc,
  before: { id: string; slug: string; query?: string },
  page: Page
) {
  const others = Object.values(doc.pages);
  const fix = (url: string) => retargetPageUrl(url, before, page, others) ?? url;
  const fixSteps = (steps: ScriptStep[]) => {
    for (const st of steps) {
      if (st.kind === "open-url") st.url = fix(st.url);
      else if (st.kind === "if") {
        fixSteps(st.then);
        if (st.else) fixSteps(st.else);
      }
      else if (st.kind === "repeat" || st.kind === "for-each") fixSteps(st.then);
    }
  };
  for (const node of Object.values(doc.nodes)) {
    if (node.link?.kind === "url" && node.link.url) node.link.url = fix(node.link.url);
    for (const sc of node.scripts ?? []) fixSteps(sc.steps);
  }
  for (const p of others) {
    for (const sc of [...(p.scripts ?? []), ...(p.pageScripts ?? [])]) fixSteps(sc.steps);
    if (p.id === page.id) continue;
    if (p.redirectTo) p.redirectTo = fix(p.redirectTo);
    if (p.rewriteTo) p.rewriteTo = fix(p.rewriteTo);
  }
}

/** テキストの編集中なら確定（blur）させ、入力した内容を履歴に載せてから、元に戻す・やり直す */
function commitActiveTextEdit() {
  if (typeof document === "undefined") return;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable) el.blur();
}

export const useEditor = create<EditorStore>((set, get) => {
  const initialDoc = createInitialDoc();
  // 保存した編集の位置のブレークポイントを確かめるため、先にサイトの設定を反映する
  applyBreakpoints(initialDoc);
  const savedUi = loadUi(initialDoc);
  /**
   * checkpoint() で記録した、変更前の状態。実際に変更が入った時点で履歴に積む
   *（クリックだけでドラッグしなかった場合などに、空の履歴を作ったり、やり直しの履歴を消したりしない）
   */
  let pendingBase: SiteDoc | null = null;

  // 開いているページに置かれていないマスターも、複製先の ID の重複の確認に含める。
  const refreshEditorClones = (
    doc: SiteDoc, clones: DocNode[], replacing?: { rootId: string; attrId?: string }
  ) => {
    const { activePageId, editingComponentId } = get();
    const rootId = editingComponentId ? doc.components?.[editingComponentId]?.rootId : undefined;
    refreshClonedIds(doc, activePageId, clones, rootId ? [rootId] : [], replacing);
  };

  const gestureOwners = new Set<symbol>();
  const historyFor = (snapshot: SiteDoc) => {
    pendingBase = null;
    return {
      past: [...get().past.slice(-HISTORY_LIMIT + 1), snapshot],
      future: [],
    };
  };

  /** 編集と、その「元に戻す」の時点を、購読者への通知も含めて一緒に反映する。 */
  const commitDoc = (next: SiteDoc, opts?: { history?: boolean }) => {
    const current = get();
    if (next === current.doc) return;
    const snapshot = opts?.history === false || current.gestureActive
      ? pendingBase
      : current.doc;
    // 同期的な購読者に知らせる前に、保留中の時点を使い切る。
    // 購読者自身が文書を編集したり、別の操作を始めたりすることがあるため。
    set({ doc: next, ...(snapshot ? historyFor(snapshot) : {}) });
  };

  /**
   * ノードだけの編集は、エディタで最も頻繁に起きる操作。影響を受けるノードだけを複製し、
   * 文書の他の枝と、元に戻すためのスナップショットはすべてそのまま保つ。
   * ポインターが動くたびに structuredClone と文書全体の JSON の比較をしていたときは、
   * 大きなページで極端に遅くなっていた。
   */
  const updateNodes = (
    ids: readonly string[],
    change: (node: DocNode) => void,
    opts?: { history?: boolean }
  ) => {
    const current = get().doc;
    const changed = new Map<string, DocNode>();
    for (const id of new Set(ids)) {
      const original = current.nodes[id];
      if (!original) continue;
      const draft = structuredClone(original);
      change(draft);
      // 何も変わらない操作では、履歴を作らず、やり直しの履歴も消さず、描画もし直さない。
      if (JSON.stringify(draft) !== JSON.stringify(original)) changed.set(id, draft);
    }
    if (!changed.size) return;
    const next: SiteDoc = {
      ...current,
      nodes: { ...current.nodes, ...Object.fromEntries(changed) },
    };
    commitDoc(next, opts);
  };

  return {
    doc: initialDoc,
    documentSession: 0,
    past: [],
    future: [],
    historyRevision: 0,
    activePageId: loadActivePageId(initialDoc),
    selection: null,
    selectedIds: [],
    breakpoint: "base",
    customWidth: null,
    styleState: "default",
    mode: "design",
    leftTab: "layers",
    revealAssetId: null,
    editingText: null,
    zoom: 0,
    savedAt: null,
    publishedAt: Number(readLocalStorage(PUBLISHED_KEY)) || null,
    publishedFingerprint: readLocalStorage(PUBLISHED_HASH_KEY),
    cloudState: "checking",
    cloudSavedAt: null,
    cloudError: null,
    previewIndex: 0,
    setPreviewIndex: (i) => set({ previewIndex: i }),

    select: (id) =>
      set({
        selection: id,
        selectedIds: id ? [id] : [],
        editingText: null,
        styleState: "default",
        textSel: null,
      }),
    toggleSelection: (id) =>
      set((s) => {
        if (id === BODY_NODE_ID || !s.doc.nodes[id]) {
          return {
            selection: id,
            selectedIds: id ? [id] : [],
            editingText: null,
            styleState: "default" as StyleState,
            textSel: null,
          };
        }
        const exists = s.selectedIds.includes(id);
        const selectedIds = exists
          ? s.selectedIds.filter((selectedId) => selectedId !== id)
          : [...s.selectedIds, id];
        return {
          selectedIds,
          selection: exists
            ? selectedIds[selectedIds.length - 1] ?? null
            : id,
          editingText: null,
          styleState: "default" as StyleState,
          textSel: null,
        };
      }),
    selectParent: () => {
      const s = get();
      if (!s.selection || !s.doc.nodes[s.selection]) return;
      const parent = findParentOf(s.doc, s.selection);
      if (parent?.kind === "node") s.select(parent.id);
      else if (parent?.kind === "page" && !s.editingComponentId) s.select(BODY_NODE_ID);
    },
    selectMany: (ids, primary) =>
      set({
        selectedIds: ids,
        selection: primary,
        editingText: null,
        styleState: "default",
        textSel: null,
      }),
    selectAll: () => {
      const s = get();
      const editingComp = s.editingComponentId
        ? s.doc.components?.[s.editingComponentId]
        : null;
      const parent =
        s.selection && s.doc.nodes[s.selection]
          ? findParentOf(s.doc, s.selection)
          : null;
      const ids = parent
        ? parent.kind === "page"
          ? s.doc.pages[parent.id]?.children
          : s.doc.nodes[parent.id]?.children
        : editingComp
          ? s.doc.nodes[editingComp.rootId]?.children
          : s.doc.pages[s.activePageId]?.children;
      if (!ids?.length) return;
      set({
        selectedIds: [...ids],
        selection:
          s.selection && ids.includes(s.selection)
            ? s.selection
            : ids[ids.length - 1],
        editingText: null,
        styleState: "default",
        textSel: null,
      });
    },
    setBreakpoint: (bp) => set({ breakpoint: bp, customWidth: null }),
    setCustomWidth: (w) => {
      if (w === null) {
        set({ customWidth: null });
        return;
      }
      const width = Math.max(240, Math.min(3000, Math.round(w)));
      set({ customWidth: width, breakpoint: breakpointForWidth(width) });
    },
    setStyleState: (s) => set({ styleState: s }),
    setMode: (m) => set({ mode: m, editingText: null, textSel: null }),
    setLeftTab: (t) => set({ leftTab: t }),
    revealAsset: (id) => set(id ? { leftTab: "assets", revealAssetId: id } : { revealAssetId: null }),
    // 編集を始めるときは、古い部分の選択を捨てる（編集中に選び直せば更新される）
    setEditingText: (id) =>
      set((s) => ({
        editingText: id,
        textSel: id !== null ? null : s.textSel,
      })),

    textSel: null,
    setTextSel: (sel) => set({ textSel: sel }),

    splitTextSpan: (nodeId, start, end, text, props) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId];
      if (!node?.text || node.children.length) return null;
      const content = node.text.content;
      // 古い範囲を、同じ文字列が別に現れる位置へ移さない。
      if (
        !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > content.length ||
        content.slice(start, end) !== text
      ) return null;
      if (start <= 0 && end >= content.length) return null; // すべてを選んでいれば、分割は要らない
      if (start >= end) return null;
      if (ancestorsOf(doc, nodeId).length + 2 > MAX_NODE_DEPTH) return null;

      const { breakpoint, styleState } = get();
      const makeSpan = (part: string): DocNode => ({
        id: genId("node"),
        type: "box",
        name: part.trim().slice(0, 12) || tr("Text", "text_variant_1"),
        semantic: "span",
        text: { content: part, heading: 0 },
        link: null,
        children: [],
        styles: {},
      });
      const parts = [
        content.slice(0, start),
        content.slice(start, end),
        content.slice(end),
      ];
      const spans = parts.map((p) => (p ? makeSpan(p) : null));
      const target = spans[1]!;
      if (props) {
        const bpStyles = (target.styles[breakpoint] ??= {});
        const map = (bpStyles[styleState] ??= {});
        for (const [k, v] of Object.entries(props)) {
          if (v !== null) map[k] = v;
        }
      }
      get().updateDoc((d) => {
        const n = d.nodes[nodeId];
        if (!n?.text) return;
        const kids = spans.filter((s): s is DocNode => !!s);
        for (const s of kids) d.nodes[s.id] = s;
        n.text = { content: "", heading: n.text.heading };
        n.children = kids.map((s) => s.id);
      });
      set({
        selection: target.id,
        selectedIds: [target.id],
        textSel: null,
        editingText: null,
      });
      return target.id;
    },
    setZoom: (z) => set({ zoom: z }),
    markSaved: () => set({ savedAt: Date.now() }),
    markPublished: (fingerprint) => {
      const now = Date.now();
      try {
        window.localStorage.setItem(PUBLISHED_KEY, String(now));
        window.localStorage.setItem(PUBLISHED_HASH_KEY, fingerprint);
      } catch {
        // 記録の保存に失敗しても、公開そのものは成功しているため無視する
      }
      set({ publishedAt: now, publishedFingerprint: fingerprint });
    },

    setCloud: (state, savedAt, error) =>
      set((s) => ({
        cloudState: state,
        cloudSavedAt: savedAt ?? s.cloudSavedAt,
        cloudError: state === "error" ? error ?? null : null,
      })),

    replaceDoc: (doc) => {
      pendingBase = null;
      // 文書をまたぐ連続した編集は終え、次の編集では新しい履歴を作る。
      get().endGesture();
      const currentPageId = get().activePageId;
      set({
        doc,
        documentSession: get().documentSession + 1,
        past: [],
        future: [],
        historyRevision: get().historyRevision + 1,
        activePageId: doc.pages[currentPageId]
          ? currentPageId
          : loadActivePageId(doc),
        // 前回の編集の位置を戻した後にサーバーの内容に置き換えても、残っている要素の選択は保つ
        selection: validSelection(doc, get().selection),
        selectedIds: validSelectedIds(doc, get().selectedIds),
        editingComponentId:
          get().editingComponentId && doc.components?.[get().editingComponentId!]
            ? get().editingComponentId
            : null,
        editingText: null,
        textSel: null,
      });
    },

    restoreDoc: (doc) => {
      const current = get().doc;
      if (sameDocContent(current, doc)) return;
      get().endGesture();
      const selectedIds = validSelectedIds(doc, get().selectedIds);
      set({
        ...historyFor(current),
        doc,
        // 履歴は残すが、復元する前の非同期の処理や一時的な入力は引き継がない。
        documentSession: get().documentSession + 1,
        historyRevision: get().historyRevision + 1,
        activePageId: doc.pages[get().activePageId] ? get().activePageId : doc.pageOrder[0],
        selection: validSelection(doc, get().selection) ?? selectedIds[selectedIds.length - 1] ?? null,
        selectedIds,
        editingComponentId:
          get().editingComponentId && doc.components?.[get().editingComponentId!]
            ? get().editingComponentId
            : null,
        editingText: null,
        textSel: null,
        scriptEditor: null,
      });
    },

    applyRemoteDoc: (doc, patchHint) => {
      set((s) => {
        const selectedIds = validSelectedIds(doc, s.selectedIds);
        const selection = validSelection(doc, s.selection);
        // 同時編集で届いた、ノードだけの差分なら、文書のツリー全体を作り直さずに履歴の時点を
        // 付け替えられる。操作中の時点や履歴の項目が構造の競合を含む場合は、これまでどおり
        // 完全な3方向マージを使う。
        const rebase = patchHint?.baseDoc === s.doc
          ? (snap: SiteDoc) => rebaseNodePatch(s.doc, doc, snap, patchHint.patch) ?? mergeDocs(s.doc, doc, snap)
          : (snap: SiteDoc) => mergeDocs(s.doc, doc, snap);
        let past: SiteDoc[] = [];
        let future: SiteDoc[] = [];
        try {
          past = s.past.map(rebase);
          future = s.future.map(rebase);
          // 操作中の保留した時点も同じように付け替え、その最初の実際の編集を元に戻せるようにする。
          // 共同編集者の変更を巻き戻すことは無い。
          if (pendingBase) pendingBase = rebase(pendingBase);
        } catch {
          // マージできない場合は、安全な側に倒して履歴を捨てる
          pendingBase = null;
        }
        return {
          doc,
          past,
          future,
          activePageId: doc.pages[s.activePageId]
            ? s.activePageId
            : doc.pageOrder[0],
          selection: selection ?? selectedIds[selectedIds.length - 1] ?? null,
          selectedIds,
          editingComponentId:
            s.editingComponentId && doc.components?.[s.editingComponentId]
              ? s.editingComponentId
              : null,
          editingText: null,
          textSel: null,
        };
      });
    },

    insertMode: typeof window !== "undefined" ? loadInsertMode() : "inside",
    setInsertMode: (m) => {
      try {
        window.localStorage.setItem(INSERT_MODE_KEY, m);
      } catch {
        // 保存できなくても、開いている間は切り替わる
      }
      set({ insertMode: m });
    },

    clipboard: null,

    copyNode: (nodeId, opts) => {
      const doc = get().doc;
      if (!doc.nodes[nodeId]) return;
      const targets = targetIdsFor(get().selectedIds, nodeId).filter(
        (id) => id !== BODY_NODE_ID && doc.nodes[id] && (!opts?.unlockedOnly || !doc.nodes[id].locked)
      );
      if (!targets.length) return;
      // 祖先も選ばれている要素は、祖先のコピーに含まれる
      const parents = indexParents(doc);
      const rootIds = sortInTreeOrder(selectedRoots(targets, parents), parents);
      // 取り消しや削除でコピー元が消えても、同じタブから貼り付けられるよう、依存するものも控えておく。
      const clipboard = buildClipPayload(doc, {
        nodes: rootIds.flatMap((root) =>
          collectDescendants(doc, root).map((id) => structuredClone(doc.nodes[id]))
        ),
        rootIds,
      });
      set({ clipboard });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tsumu-internal-copy"));
        // 他のサイトでも貼り付けられるよう、OS のクリップボードにも書く
        writeClipPayload(clipboard);
      }
    },

    scriptEditor: null,
    openScriptEditor: (opts) => set({ scriptEditor: opts }),
    rightTab: "style",
    setRightTab: (t) => set({ rightTab: t }),

    editingComponentId: null,

    setEditingComponent: (id) =>
      set({
        editingComponentId: id,
        selection: null,
        selectedIds: [],
        editingText: null,
      }),

    createComponent: (nodeId) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId];
      if (!node || node.type === "instance") return;
      const parent = findParentOf(doc, nodeId);
      if (!parent) return;
      const compId = genId("comp");
      const instanceId = genId("node");
      get().updateDoc((d) => {
        d.components ??= {};
        d.components[compId] = {
          id: compId,
          name: node.name,
          rootId: nodeId,
        };
        // 元の位置をインスタンスに差し替える（マスターは nodes に残る）
        const list =
          parent.kind === "page"
            ? d.pages[parent.id].children
            : d.nodes[parent.id].children;
        list[list.indexOf(nodeId)] = instanceId;
        d.nodes[instanceId] = {
          id: instanceId,
          type: "instance",
          name: node.name,
          semantic: "auto",
          text: null,
          link: null,
          componentId: compId,
          children: [],
          styles: {},
        };
      });
      set({ selection: instanceId, selectedIds: [instanceId] });
    },

    createList: (nodeId) => {
      const doc = get().doc;
      const node = doc.nodes[nodeId];
      const parent = findParentOf(doc, nodeId);
      if (!node || node.type !== "box" || !parent || componentOf(doc, nodeId)) {
        return;
      }
      if (ancestorsOf(doc, nodeId).length + maxSubtreeDepth(doc.nodes, [nodeId]) + 1 > MAX_NODE_DEPTH) return;
      const listId = genId("node");
      get().updateDoc((d) => {
        const siblings =
          parent.kind === "page"
            ? d.pages[parent.id].children
            : d.nodes[parent.id].children;
        siblings[siblings.indexOf(nodeId)] = listId;
        d.nodes[listId] = {
          id: listId,
          type: "list",
          name: tr("{name} list", { name: node.name }),
          semantic: "auto",
          text: null,
          link: null,
          list: {},
          children: [nodeId],
          styles: {
            base: {
              default: {
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                padding: "0px",
              },
            },
          },
        };
      });
      set({ selection: listId, selectedIds: [listId] });
    },

    detachInstance: (nodeId) => {
      const doc = get().doc;
      const inst = doc.nodes[nodeId];
      const comp = inst?.componentId
        ? doc.components?.[inst.componentId]
        : null;
      const parent = findParentOf(doc, nodeId);
      if (!inst || !comp || !parent || !doc.nodes[comp.rootId]) return;
      const parentDepth = parent.kind === "page" ? 0 : ancestorsOf(doc, parent.id).length + 1;
      if (parentDepth + maxSubtreeDepth(doc.nodes, [comp.rootId]) > MAX_NODE_DEPTH) return;
      // マスターを複製して、通常のノードにする
      const idMap = new Map<string, string>();
      const clones: DocNode[] = [];
      const cloneTree = (id: string): string => {
        const src = doc.nodes[id];
        const copy = structuredClone(src);
        copy.id = genId("node");
        idMap.set(id, copy.id);
        copy.children = src.children.map(cloneTree);
        clones.push(copy);
        return copy.id;
      };
      const newRootId = cloneTree(comp.rootId);
      // マスターの見た目と、使用箇所で設定した名前・ロック・非表示を残す。
      const root = clones.find((n) => n.id === newRootId)!;
      root.name = inst.name;
      root.locked = inst.locked;
      const hiddenOn = [...new Set([...(root.hiddenOn ?? []), ...(inst.hiddenOn ?? [])])];
      root.hiddenOn = hiddenOn.length ? hiddenOn : undefined;
      // 使用箇所の ID はそのまま引き継ぎ、複製したマスターの中の参照もそれに合わせる。
      refreshEditorClones(doc, clones, {
        rootId: newRootId, attrId: inst.attrId,
      });
      get().updateDoc((d) => {
        for (const c of clones) d.nodes[c.id] = c;
        const list =
          parent.kind === "page"
            ? d.pages[parent.id].children
            : d.nodes[parent.id].children;
        list[list.indexOf(nodeId)] = newRootId;
        delete d.nodes[nodeId];
      });
      set({ selection: newRootId, selectedIds: [newRootId] });
    },

    insertInstance: (componentId) => {
      const { doc, selection, editingComponentId, activePageId } = get();
      const comp = doc.components?.[componentId];
      if (!comp) return;
      const instanceId = genId("node");
      // ページの要素を選んでいれば、他の要素の追加と同じく、その中（入れられなければ後ろ）に置く。
      // コンポーネントの編集中は、ページの末尾に置いて、ページの編集に戻る
      let parent: ParentRef = { kind: "page", id: activePageId };
      let index: number | undefined;
      const sel = !editingComponentId && selection ? doc.nodes[selection] : null;
      if (sel && findParentOf(doc, sel.id) && !componentOf(doc, sel.id)) {
        ({ parent, index } = insertPointFor(doc, sel.id, parent, get().insertMode));
      }
      get().updateDoc((d) => {
        d.nodes[instanceId] = {
          id: instanceId,
          type: "instance",
          name: comp.name,
          semantic: "auto",
          text: null,
          link: null,
          componentId,
          children: [],
          styles: {},
        };
        const list = childrenOf(d, parent);
        list.splice(index ?? list.length, 0, instanceId);
      });
      set({
        selection: instanceId,
        selectedIds: [instanceId],
        editingComponentId: null,
      });
    },

    deleteComponent: (componentId) => {
      const doc = get().doc;
      const comp = doc.components?.[componentId];
      if (!comp) return;
      get().updateDoc((d) => {
        // すべてのインスタンスを削除する
        for (const [id, n] of Object.entries(d.nodes)) {
          if (n.type === "instance" && n.componentId === componentId) {
            const p = findParentOf(d, id);
            if (p) {
              const list =
                p.kind === "page"
                  ? d.pages[p.id].children
                  : d.nodes[p.id].children;
              const i = list.indexOf(id);
              if (i >= 0) list.splice(i, 1);
            }
            delete d.nodes[id];
          }
        }
        // マスターのノードを削除する
        for (const id of collectDescendants(d, comp.rootId)) {
          delete d.nodes[id];
        }
        delete d.components![componentId];
      });
      if (get().editingComponentId === componentId) {
        set({ editingComponentId: null });
      }
      set({ selection: null, selectedIds: [] });
    },

    pasteClipboard: (external) => {
      const payload = external ?? get().clipboard;
      if (!payload) return;
      const clip = prepareClipBreakpoints(get().doc, payload);
      if (!clip) {
        void showAlert(tr("The source and destination screen-width settings differ or contain unknown references. Nothing was copied, to keep the appearance intact. Match the screen-width settings and try again."));
        return;
      }
      const idMap = new Map(clip.nodes.map((n) => [n.id, genId("node")]));
      const clones = clip.nodes.map((n) => {
        const c = structuredClone(n);
        c.id = idMap.get(n.id)!;
        c.children = n.children.map((cid) => idMap.get(cid)!);
        return c;
      });
      const newRootIds = clip.rootIds.map((id) => idMap.get(id)!);

      const { selection, doc, activePageId, editingComponentId } = get();
      // 貼り付け先のページで ID 属性が重ならないように付け替える（中のスクリプトの参照も合わせる）
      refreshEditorClones(doc, clones);
      const editingComp = editingComponentId
        ? doc.components?.[editingComponentId]
        : null;
      const { parent, index } = insertPointFor(
        doc,
        selection,
        editingComp ? { kind: "node", id: editingComp.rootId } : { kind: "page", id: activePageId },
        get().insertMode
      );
      // コピーしたもの単体では保存できても、置き先の深さを足すと、保存の上限を超える場合がある。
      const parentDepth = parent.kind === "page" ? 0 : ancestorsOf(doc, parent.id).length + 1;
      if (parentDepth + maxSubtreeDepth(Object.fromEntries(clones.map(n => [n.id, n])), newRootIds) > MAX_NODE_DEPTH) {
        void showAlert(tr("Can't paste here"));
        return;
      }
      // 追加する予定の依存するものを、切り離した map に解決する。既存のマスターを使い回す場合まで含めて検査し、
      // 貼り付けを拒否したときは、アセットや履歴を含む文書全体を変更しない。
      const prepared = {
        ...doc, nodes: { ...doc.nodes }, assets: { ...doc.assets },
        ...(doc.components ? { components: { ...doc.components } } : {}),
      };
      const deps = mergeClipDeps(prepared, clip, {
        preserveSourceOnCollision: !!clip.site && clip.site !== currentSiteId(),
      });
      for (const node of clones) {
        if (node.type === "instance" && node.componentId) {
          node.componentId = deps.componentIds.get(node.componentId) ?? node.componentId;
        }
      }
      // コンポーネントの中には、そのコンポーネント自身（を含むインスタンス）を入れない（無限に入れ子になる）
      const host = parent.kind === "node" ? componentOf(doc, parent.id) : null;
      if (host) {
        const pasted = clones.flatMap((n) =>
          n.type === "instance" && n.componentId ? [n.componentId] : []
        );
        if (componentsReachable(prepared, pasted).has(host)) {
          void showAlert(
            tr("You can't put component \"{p1}\" inside itself (it would nest forever).", { p1: doc.components?.[host]?.name ?? "" }),
            { title: tr("Can't paste here") }
          );
          return;
        }
      }
      get().updateDoc((d) => {
        // 同じタブでも、コピーした後の取り消しや削除で失われた依存するものを戻す。残っているマスターを優先する。
        d.assets = prepared.assets;
        if (prepared.components) d.components = prepared.components;
        if (prepared.customFonts) d.customFonts = prepared.customFonts;
        for (const n of deps.componentNodes) d.nodes[n.id] = n;
        for (const n of clones) d.nodes[n.id] = remapAssetIds(n, deps.assetIds);
        const list = childrenOf(d, parent);
        list.splice(index === undefined ? list.length : index, 0, ...newRootIds);
      });
      set({
        selection: newRootIds[newRootIds.length - 1] ?? null,
        selectedIds: newRootIds,
      });
    },

    gestureActive: false,
    beginGesture: () => {
      const owner = Symbol();
      // 同時に操作している別の欄の開始で、最初の変更の前の状態を上書きしない。
      if (!gestureOwners.size) get().checkpoint();
      gestureOwners.add(owner);
      if (!get().gestureActive) set({ gestureActive: true });
      return () => {
        if (!gestureOwners.delete(owner)) return;
        if (!gestureOwners.size) set({ gestureActive: false });
      };
    },
    endGesture: () => {
      gestureOwners.clear();
      if (get().gestureActive) set({ gestureActive: false });
    },
    checkpoint: () => {
      // エディタの更新は既存のスナップショットを決して書き換えないため、参照を持つだけで足りる。
      // ドラッグを始めるときに文書全体を複製すると、動作が一瞬止まる。
      pendingBase = get().doc;
    },

    undo: () => {
      commitActiveTextEdit();
      pendingBase = null;
      // 履歴を移動した後の pointermove を、古い操作の履歴なしの更新として扱わない。
      // 所有者も捨て、遅れて届いた pointerup が新しい操作を終えないようにする。
      get().endGesture();
      const { doc } = get();
      const past = [...get().past];
      // 現在と同じ内容の履歴は、押しても何も起きないため読み飛ばす
      let prev: SiteDoc | undefined;
      while (past.length) {
        const cand = past.pop()!;
        if (!sameDocContent(cand, doc)) {
          prev = cand;
          break;
        }
      }
      if (!prev) {
        set({ past });
        return;
      }
      const selectedIds = validSelectedIds(prev, get().selectedIds);
      set({
        doc: prev,
        past,
        future: [doc, ...get().future],
        historyRevision: get().historyRevision + 1,
        editingText: null,
        selection:
          validSelection(prev, get().selection) ??
          selectedIds[selectedIds.length - 1] ??
          null,
        selectedIds,
        activePageId: prev.pages[get().activePageId]
          ? get().activePageId
          : prev.pageOrder[0],
        editingComponentId:
          get().editingComponentId && prev.components?.[get().editingComponentId!]
            ? get().editingComponentId
            : null,
        textSel: null,
      });
    },

    redo: () => {
      commitActiveTextEdit();
      pendingBase = null;
      // 履歴を移動した後の pointermove を、古い操作の履歴なしの更新として扱わない。
      // 所有者も捨て、遅れて届いた pointerup が新しい操作を終えないようにする。
      get().endGesture();
      const { doc } = get();
      const future = [...get().future];
      let next: SiteDoc | undefined;
      while (future.length) {
        const cand = future.shift()!;
        if (!sameDocContent(cand, doc)) {
          next = cand;
          break;
        }
      }
      if (!next) {
        set({ future });
        return;
      }
      const selectedIds = validSelectedIds(next, get().selectedIds);
      set({
        doc: next,
        past: [...get().past.slice(-HISTORY_LIMIT + 1), doc],
        future,
        historyRevision: get().historyRevision + 1,
        editingText: null,
        selection:
          validSelection(next, get().selection) ??
          selectedIds[selectedIds.length - 1] ??
          null,
        selectedIds,
        activePageId: next.pages[get().activePageId]
          ? get().activePageId
          : next.pageOrder[0],
        editingComponentId:
          get().editingComponentId && next.components?.[get().editingComponentId!]
            ? get().editingComponentId
            : null,
        textSel: null,
      });
    },

    updatePageScripts: (pageId, nodeIds, views) => {
      const current = get().doc;
      const next = withPageScripts(current, pageId, nodeIds, views);
      commitDoc(next);
    },

    updateDoc: (fn, opts) => {
      const current = get().doc;
      const draft = structuredClone(current);
      fn(draft);
      // 変わっていないページと要素は、編集前の参照のまま残す（履歴・差分の保存・マージが、変わった分だけを扱えるようにする）。
      // 内容が同じなら current そのものが返るため、ドラッグ中の参照と履歴の起点もそのまま残る
      const next = shareUnchangedDoc(current, draft);
      if (next === current) return;
      commitDoc(next, opts);
    },

    retainUploadedAssets: (assets) => {
      const current = get().doc;
      const fresh = new Map<string, Asset>();
      for (const asset of assets) {
        if (!Object.hasOwn(current.assets, asset.id) && !fresh.has(asset.id)) {
          fresh.set(asset.id, structuredClone(asset));
        }
      }
      if (!fresh.size) return;
      const retain = (doc: SiteDoc): SiteDoc => {
        const missing = [...fresh].filter(([id]) => !Object.hasOwn(doc.assets, id));
        return missing.length
          ? { ...doc, assets: { ...doc.assets, ...Object.fromEntries(missing) } }
          : doc;
      };
      // checkpoint を使い切らない。その後の操作を元に戻しても、ファイルは残す。
      if (pendingBase) pendingBase = retain(pendingBase);
      set((s) => ({
        doc: retain(s.doc),
        past: s.past.map(retain),
        future: s.future.map(retain),
      }));
    },

    setStyleProps: (nodeId, props, opts) => {
      const { breakpoint, styleState } = get();
      const targetIds = targetIdsFor(get().selectedIds, nodeId);
      updateNodes(targetIds, (node) => {
        const bpStyles = (node.styles[breakpoint] ??= {});
        const map = (bpStyles[styleState] ??= {});
        for (const [k, v] of Object.entries(props)) {
          // 空文字は「未設定」として消す（空の値で、設定済みを示す色だけが付いて残らないようにする）
          if (v === null || v === "") delete map[k];
          else map[k] = v;
        }
      }, { history: !opts?.transient });
    },

    updateNode: (nodeId, patch) => {
      updateNodes([nodeId], (node) => Object.assign(node, patch));
    },

    updateTargets: (nodeId, fn) => {
      const targetIds = targetIdsFor(get().selectedIds, nodeId);
      updateNodes(targetIds, fn);
    },

    toggleHiddenHere: (nodeId) => {
      const { doc, breakpoint } = get();
      const node = doc.nodes[nodeId];
      if (!node) return;
      const hide = !isHiddenAt(node, breakpoint);
      get().updateNode(nodeId, { hiddenOn: nextHiddenOn(node, breakpoint, hide, true) });
    },

    setHiddenAt: (nodeId, bp, hide) => {
      get().updateTargets(nodeId, (node) => {
        node.hiddenOn = nextHiddenOn(node, bp, hide);
      });
    },

    insertNodes: (nodes, rootId, parent, index) => {
      const doc = get().doc;
      if (parent.kind === "page" ? !doc.pages[parent.id] : !doc.nodes[parent.id]) return;
      const parentDepth = parent.kind === "page" ? 0 : ancestorsOf(doc, parent.id).length + 1;
      const inserted = Object.fromEntries(nodes.map(node => [node.id, node])) as Record<string, DocNode>;
      if (parentDepth + maxSubtreeDepth(inserted, [rootId]) > MAX_NODE_DEPTH ||
          !canPlaceComponentNodes(doc, parent, [rootId], inserted)) return;
      get().updateDoc((doc) => {
        refreshEditorClones(doc, nodes);
        for (const n of nodes) doc.nodes[n.id] = n;
        const list = childrenOf(doc, parent);
        const i = index === undefined ? list.length : index;
        list.splice(i, 0, rootId);
      });
      set({ selection: rootId, selectedIds: [rootId] });
    },

    deleteNode: (nodeId) => {
      // コンポーネントのマスターのルートは、deleteComponent を通して消す
      const comp = Object.values(get().doc.components ?? {}).find(
        (c) => c.rootId === nodeId
      );
      if (comp) {
        const confirmedDoc = get().doc;
        const confirmedRevision = get().historyRevision;
        void showConfirm(tr("Every instance of this component placed on pages will also be deleted."), {
          title: tr("Delete component \"{name}\"?", { name: comp.name }),
          okLabel: tr("Delete"),
          danger: true,
        }).then((ok) => {
          if (ok && get().doc === confirmedDoc && get().historyRevision === confirmedRevision) {
            get().deleteComponent(comp.id);
          }
        });
        return;
      }
      const parent = findParentOf(get().doc, nodeId);
      if (!parent) return;
      get().updateDoc((doc) => {
        const ids = collectDescendants(doc, nodeId);
        for (const id of ids) delete doc.nodes[id];
        const list = childrenOf(doc, parent);
        const i = list.indexOf(nodeId);
        if (i >= 0) list.splice(i, 1);
      });
      set((s) => {
        const selectedIds = validSelectedIds(get().doc, s.selectedIds);
        return {
          selectedIds,
          selection:
            validSelection(get().doc, s.selection) ??
            selectedIds[selectedIds.length - 1] ??
            null,
        };
      });
    },

    deleteNodes: (nodeIds) => {
      const doc = get().doc;
      const ids = nodeIds.filter(
        (id) => id !== BODY_NODE_ID && doc.nodes[id] && !doc.nodes[id].locked
      );
      if (ids.length <= 1) {
        if (ids[0]) get().deleteNode(ids[0]);
        return;
      }
      // コンポーネントのマスターのルートは個別の確認が要るため、通常の削除からは外す
      const compRoots = new Set(Object.values(doc.components ?? {}).map((c) => c.rootId));
      const targets = ids.filter((id) => !compRoots.has(id));
      // 祖先も選ばれている要素は、祖先の削除で一緒に消える
      const parents = indexParents(doc);
      const roots = selectedRoots(targets, parents);
      get().updateDoc((d) => {
        for (const id of roots) {
          const parent = parents.get(id)?.ref;
          if (!parent) continue;
          for (const x of collectDescendants(d, id)) delete d.nodes[x];
          const list = childrenOf(d, parent);
          const i = list.indexOf(id);
          if (i >= 0) list.splice(i, 1);
        }
      });
      set({ selection: null, selectedIds: [], editingText: null });
      for (const id of ids.filter((x) => compRoots.has(x))) get().deleteNode(id);
    },

    duplicateNode: (nodeId) => get().duplicateNodes([nodeId]),

    duplicateNodes: (nodeIds) => {
      const doc = get().doc;
      const parents = indexParents(doc);
      const ids = nodeIds.filter((id) => doc.nodes[id] && parents.has(id));
      // 祖先も選ばれている要素は、祖先の複製に含まれる
      const roots = sortInTreeOrder(selectedRoots(ids, parents), parents);
      if (!roots.length) return;
      const clones: DocNode[] = [];
      const cloneTree = (id: string): string => {
        const src = doc.nodes[id];
        const copy = structuredClone(src);
        copy.id = genId("node");
        copy.children = src.children.map(cloneTree);
        clones.push(copy);
        return copy.id;
      };
      const pairs = roots.map((id) => ({ from: id, copy: cloneTree(id) }));
      // 複製の ID 属性が元と重ならないように付け替える（中のスクリプトの参照も合わせる）
      refreshEditorClones(doc, clones);
      get().updateDoc((d) => {
        for (const c of clones) d.nodes[c.id] = c;
        for (const { from, copy } of pairs) {
          const parent = parents.get(from)?.ref;
          if (!parent) continue;
          const list = childrenOf(d, parent);
          list.splice(list.indexOf(from) + 1, 0, copy);
        }
      });
      const copies = pairs.map((p) => p.copy);
      set({ selection: copies[copies.length - 1], selectedIds: copies });
    },

    moveNode: (nodeId, parent, index) => get().moveNodes([nodeId], parent, index),

    moveNodes: (nodeIds, parent, index) => {
      const doc = get().doc;
      // ドラッグ中の削除や同時編集で移動先が無くなったら、元の構造を保つ。
      if (parent.kind === "page" ? !doc.pages[parent.id] : !doc.nodes[parent.id]) return;
      // ロック中の要素と、マスターのルート（親を持たない）は移動できない。重なる選択も1回だけ扱う。
      const parents = indexParents(doc);
      const movable = [...new Set(nodeIds)].filter((id) => doc.nodes[id] && !doc.nodes[id].locked && parents.has(id));
      // 選んだ要素の子孫は親と一緒に動くため、個別には動かさない
      const ids = selectedRoots(movable, parents);
      if (!ids.length) return;
      const selected = new Set(ids);
      const ancestors = parent.kind === "node" ? indexedAncestors(parents, parent.id) : [];
      // 自分自身や子孫への移動は許さない
      if (parent.kind === "node" &&
          (selected.has(parent.id) || ancestors.some((id) => selected.has(id)))) return;
      const parentDepth = parent.kind === "page" ? 0 : ancestors.length + 1;
      if (parentDepth + maxSubtreeDepth(doc.nodes, ids) > MAX_NODE_DEPTH ||
          !canPlaceComponentNodes(doc, parent, ids)) return;
      sortInTreeOrder(ids, parents);
      get().updateDoc((d) => {
        const toList = childrenOf(d, parent);
        // 挿入する位置より前から抜ける要素の数だけ、位置を詰める
        const i = index - toList.slice(0, index).filter((id) => selected.has(id)).length;
        for (const id of ids) {
          const from = parents.get(id)?.ref;
          if (!from) continue;
          const list = childrenOf(d, from);
          list.splice(list.indexOf(id), 1);
        }
        toList.splice(Math.max(0, Math.min(i, toList.length)), 0, ...ids);
      });
    },

    // ページを開いたら、コンポーネントの編集を終えて、そのページを表示する
    setActivePage: (id) =>
      set({
        activePageId: id,
        selection: null,
        selectedIds: [],
        previewIndex: 0,
        editingComponentId: null,
        editingText: null,
        textSel: null,
      }),

    addPage: (folderId) => {
      const id = genId("page");
      // ページを消した後でも、既存のページと名前や URL が重ならない番号にする
      const { name, slug } = uniquePageNaming(
        get().doc,
        newPageName,
        (n) => `page-${n}`,
        get().doc.pageOrder.length + 1
      );
      const activeId = get().activePageId;
      get().updateDoc((doc) => {
        const active = doc.pages[activeId];
        // フォルダの指定が無ければ、開いているページと同じフォルダに入れる
        const folder =
          folderId === undefined
            ? active?.folderId
            : doc.pageFolders?.some((f) => f.id === folderId)
              ? folderId
              : undefined;
        doc.pages[id] = {
          id,
          name,
          slug,
          title: name,
          titlePending: true,
          description: "",
          ...(folder ? { folderId: folder } : {}),
          children: [],
        };
        // 開いているページの次に入れる（別のフォルダに追加するときは、そのフォルダの最後）
        let at = -1;
        if (active && (active.folderId ?? null) === (folder ?? null)) {
          at = doc.pageOrder.indexOf(active.id) + 1;
        } else {
          for (let i = doc.pageOrder.length - 1; i >= 0; i--) {
            if ((doc.pages[doc.pageOrder[i]]?.folderId ?? null) === (folder ?? null)) {
              at = i + 1;
              break;
            }
          }
        }
        doc.pageOrder.splice(at <= 0 ? doc.pageOrder.length : at, 0, id);
      });
      get().setActivePage(id);
    },

    addPageFolder: () => {
      const id = genId("folder");
      const names = new Set((get().doc.pageFolders ?? []).map((f) => f.name));
      let n = 1;
      while (names.has(n > 1 ? tr("Folder {n}", { n }) : tr("Folder"))) n++;
      get().updateDoc((d) => {
        d.pageFolders = [...(d.pageFolders ?? []), { id, name: n > 1 ? tr("Folder {n}", { n }) : tr("Folder") }];
      });
      return id;
    },

    renamePageFolder: (folderId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      get().updateDoc((d) => {
        const f = d.pageFolders?.find((x) => x.id === folderId);
        if (f) f.name = trimmed;
      });
    },

    deletePageFolder: (folderId) => {
      get().updateDoc((d) => {
        d.pageFolders = (d.pageFolders ?? []).filter((f) => f.id !== folderId);
        if (!d.pageFolders.length) delete d.pageFolders;
        for (const p of Object.values(d.pages)) {
          if (p.folderId === folderId) delete p.folderId;
        }
      });
    },

    placePage: (pageId, folderId, anchor) => {
      get().updateDoc((d) => {
        const page = d.pages[pageId];
        if (!page) return;
        if (folderId && d.pageFolders?.some((f) => f.id === folderId)) page.folderId = folderId;
        else delete page.folderId;
        const order = d.pageOrder.filter((id) => id !== pageId);
        let at = -1;
        if (anchor?.before) at = order.indexOf(anchor.before);
        else if (anchor?.after) {
          at = order.indexOf(anchor.after);
          if (at >= 0) at += 1;
        } else {
          // 同じフォルダ（フォルダの外なら、フォルダの外）の最後のページの後ろ
          for (let i = order.length - 1; i >= 0; i--) {
            if ((d.pages[order[i]]?.folderId ?? null) === (page.folderId ?? null)) {
              at = i + 1;
              break;
            }
          }
        }
        order.splice(at < 0 ? order.length : at, 0, pageId);
        d.pageOrder = order;
      });
    },

    moveFolder: (folderId, index) => {
      const list = get().doc.pageFolders ?? [];
      const from = list.findIndex((f) => f.id === folderId);
      if (from < 0) return;
      const to = index > from ? index - 1 : index;
      if (to === from) return;
      get().updateDoc((d) => {
        const folders = [...(d.pageFolders ?? [])];
        const [f] = folders.splice(from, 1);
        folders.splice(to, 0, f);
        d.pageFolders = folders;
      });
    },

    duplicatePage: (pageId) => {
      const doc = get().doc;
      const src = doc.pages[pageId];
      if (!src) return;
      const clones: DocNode[] = [];
      const cloneTree = (id: string): string => {
        const n = doc.nodes[id];
        const copy = structuredClone(n);
        copy.id = genId("node");
        copy.children = n.children.map(cloneTree);
        clones.push(copy);
        return copy.id;
      };
      const newChildren = src.children.map(cloneTree);
      const id = genId("page");
      // 2回目以降の複製でも URL が重ならないよう、「-copy-2」のように番号を付ける
      const { name, slug } = uniquePageNaming(
        doc,
        (n) => (n > 1 ? tr("{name} copy {n}", { name: src.name, n }) : tr("{name} copy", { name: src.name })),
        (n) => copySlug(src.slug, n),
        1
      );
      get().updateDoc((d) => {
        for (const c of clones) d.nodes[c.id] = c;
        d.pages[id] = {
          ...structuredClone(src),
          id,
          name,
          slug,
          children: newChildren,
        };
        // タイトルは複製元のまま持たせ、初めてページ名を確定したときに、その名前にする
        d.pages[id].titlePending = true;
        d.pageOrder.splice(d.pageOrder.indexOf(pageId) + 1, 0, id);
      });
      get().setActivePage(id);
    },

    deletePage: (pageId) => get().deletePages([pageId]),

    deletePages: (pageIds) => {
      const { doc } = get();
      const ids = new Set(pageIds.filter((id) => doc.pageOrder.includes(id)));
      // ページが1つも無くならないよう、すべてを選んでいても、先頭の1ページは残す
      if (ids.size >= doc.pageOrder.length) ids.delete(doc.pageOrder.find((id) => !ids.has(id)) ?? doc.pageOrder[0]);
      if (!ids.size) return;
      get().updateDoc((d) => {
        for (const pageId of ids) {
          const page = d.pages[pageId];
          if (!page) continue;
          for (const c of page.children) {
            for (const id of collectDescendants(d, c)) delete d.nodes[id];
          }
          delete d.pages[pageId];
        }
        d.pageOrder = d.pageOrder.filter((p) => !ids.has(p));
        // 削除したページを指すリンクを取り除く
        for (const n of Object.values(d.nodes)) {
          if (n.link?.kind === "page" && n.link.pageId && ids.has(n.link.pageId)) {
            n.link = null;
          }
        }
      });
      if (ids.has(get().activePageId)) {
        set({
          activePageId: get().doc.pageOrder[0],
          selection: null,
          selectedIds: [],
          editingComponentId: null,
          editingText: null,
          textSel: null,
        });
      }
    },

    movePagesToFolder: (pageIds, folderId, anchor) => {
      get().updateDoc((d) => {
        const target = folderId && d.pageFolders?.some((f) => f.id === folderId) ? folderId : null;
        const ids = d.pageOrder.filter((id) => pageIds.includes(id));
        if (!ids.length) return;
        const rest = d.pageOrder.filter((id) => !ids.includes(id));
        for (const id of ids) {
          if (target) d.pages[id].folderId = target;
          else delete d.pages[id].folderId;
        }
        // anchor の前後に、無ければ移動先（フォルダ / フォルダの外）の最後のページの後ろに、並び順のまま入れる
        let at = anchor?.before
          ? rest.indexOf(anchor.before)
          : anchor?.after && rest.includes(anchor.after)
            ? rest.indexOf(anchor.after) + 1
            : -1;
        for (let i = rest.length - 1; i >= 0 && at < 0; i--) {
          if ((d.pages[rest[i]]?.folderId ?? null) === target) at = i + 1;
        }
        if (at < 0) at = rest.length;
        rest.splice(at, 0, ...ids);
        d.pageOrder = rest;
      });
    },

    updatePage: (id, patch) => {
      get().updateDoc((doc) => {
        const page = doc.pages[id];
        if (!page) return;
        const before = { id, slug: page.slug, query: page.query };
        // タイトルを一緒に指定していなければ、まだ決まっていないタイトルをページ名に合わせる（初回だけ）
        const { name, title, ...rest } = patch;
        if (title !== undefined) setPageTitle(page, title);
        if (name !== undefined) {
          if (title !== undefined) page.name = name;
          else renamePage(page, name);
        }
        Object.assign(page, rest);
        if (page.slug !== before.slug || page.query !== before.query) {
          retargetPageUrls(doc, before, page);
        }
      });
    },

    resetDoc: () => {
      get().endGesture();
      const doc = createInitialDoc();
      set({
        ...historyFor(get().doc),
        doc,
        documentSession: get().documentSession + 1,
        historyRevision: get().historyRevision + 1,
        activePageId: doc.pageOrder[0],
        selection: null,
        selectedIds: [],
        // 消えたコンポーネントの編集とスクリプトの画面は閉じる
        editingComponentId: null,
        editingText: null,
        textSel: null,
        scriptEditor: null,
      });
    },
    // 前回の編集の位置（初期値より後に置いて上書きする）
    ...savedUi,
  };
});

// ページの切り替えだけでなく、追加・複製・削除・リセットによる表示中のページの変更も記憶する。
if (typeof window !== "undefined") {
  let rememberedPageId = useEditor.getState().activePageId;
  useEditor.subscribe((state) => {
    if (!browserPositionReady) return;
    if (state.activePageId === rememberedPageId) return;
    rememberedPageId = state.activePageId;
    try {
      window.localStorage.setItem(ACTIVE_PAGE_KEY, rememberedPageId);
    } catch {
      // 保存できなくても、編集の操作は続けられる
    }
  });
}

// ブレークポイントの幅は、文書の設定に合わせる（画面を描画するより先に反映する）
{
  let applied = useEditor.getState().doc;
  applyBreakpoints(applied);
  useEditor.subscribe((state) => {
    const d = state.doc;
    if (d.breakpoints === applied.breakpoints && d.baseWidth === applied.baseWidth) return;
    applied = d;
    applyBreakpoints(d);
    // 表示中のブレークポイントが消えたら、パソコン表示に戻す
    if (!BP_INFO[state.breakpoint]) state.setBreakpoint("base");
  });
}

// 編集の位置（選択・デバイス・倍率・タブ・開いている画面）を記憶し、次に開いたときに戻す
if (typeof window !== "undefined") {
  let last = JSON.stringify(pickUi(useEditor.getState()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  useEditor.subscribe((state) => {
    if (!browserPositionReady) return;
    const next = JSON.stringify(pickUi(state));
    if (next === last) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        window.localStorage.setItem(UI_KEY, last);
      } catch {
        // 保存できなくても、編集の操作は続けられる
      }
    }, 200);
  });
}

/** サーバーとの突き合わせや最初の自動保存より前に、ブラウザの文書を読み込む。 */
export function hydrateBrowserDoc(): Promise<void> {
  browserHydration ??= (async () => {
    try {
      const raw = await readBrowserDoc(currentSiteId());
      lastKnownBrowserRaw = raw;
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (!validSiteDoc(parsed)) {
        browserSnapshotUnavailable = true;
        return;
      }
      const doc = parsed as SiteDoc;
      applyBreakpoints(doc);
      const position = { ...loadUi(doc), activePageId: loadActivePageId(doc) };
      useEditor.getState().replaceDoc(doc);
      browserPositionReady = true;
      useEditor.setState(position);
    } catch (error) {
      // 読み込めなかった文書は、決して上書きしない。
      browserSnapshotUnavailable = true;
      console.error("[Tsumu] Failed to load browser document", error);
    } finally {
      // キャッシュの読み込みに失敗しても、後でサーバーから読み込めば、エディタは使える。
      browserPositionReady = true;
    }
  })();
  return browserHydration;
}

/** ブラウザのタブをまたいで、版を不可分に確かめながら自動保存する。 */
export async function persistDoc(doc: SiteDoc): Promise<LocalSaveResult> {
  try {
    const blocked = localSaveBlock();
    if (blocked) return blocked;
    if (browserSnapshotUnavailable) return "error";
    const json = JSON.stringify(doc);
    const result = await writeBrowserDoc(currentSiteId(), json, lastKnownBrowserRaw);
    if (result === "conflict") return "error";
    // 続く削除の記録の読み取りに失敗しても、IndexedDB への書き込みは確定している。
    // 基準を保ち、後の編集や「元に戻す」で安全に再試行できるようにする。
    const changed = lastKnownBrowserRaw !== json;
    lastKnownBrowserRaw = json;
    const deleted = localSaveBlock();
    if (deleted) return deleted;
    if (changed) touchLocalSite();
    return "saved";
  } catch (error) {
    console.error("[Tsumu] Failed to save browser document", error);
    return "error";
  }
}
