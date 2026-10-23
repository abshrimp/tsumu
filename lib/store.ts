"use client";

import { create } from "zustand";
import type {
  Breakpoint,
  DocNode,
  Page,
  ScriptStep,
  SiteDoc,
  StyleState,
} from "./types";
import { BODY_NODE_ID } from "./types";
import { NEW_PAGE_NAME, renamePage, setPageTitle } from "./pageTitle";
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
import { mergeDocs } from "./merge";
import { showAlert, showConfirm } from "./dialog";
import { refreshClonedIds } from "./cloneIds";
import { tr } from "./i18n";
import { readLocalStorage } from "./local-storage";
import { DOC_STORAGE_KEY, siteKey, touchLocalSite } from "./site";
import {
  buildClipPayload,
  mergeClipDeps,
  remapAssetIds,
  writeClipPayload,
  type ClipPayload,
} from "./clip-transfer";
import { storageKey } from "./storage-keys";

// ブラウザ保存はサイトごとに分ける（開いているサイトは URL で決まり、開いている間は変わらない）
const STORAGE_KEY = siteKey(DOC_STORAGE_KEY);
const PUBLISHED_KEY = siteKey(storageKey("published-v1"));
const PUBLISHED_HASH_KEY = siteKey(storageKey("published-hash-v1"));
const ACTIVE_PAGE_KEY = siteKey(storageKey("active-page-v1"));
/** 前回の編集位置（選択・デバイス・倍率・タブなど）。次に開いたときに戻す */
const UI_KEY = siteKey(storageKey("ui-v1"));
const HISTORY_LIMIT = 100;

export type EditorMode = "design" | "preview";
export type LeftTab = "layers" | "add" | "pages" | "assets" | "site";
export type RightTab = "style" | "settings";

const LEFT_TABS: LeftTab[] = ["layers", "add", "pages", "assets", "site"];

/** 前回の編集位置として保存する項目 */
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

/** 保存した編集位置を、今のドキュメントで有効なものだけ読み戻す */
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

/** 公開済みかどうかの判定用に、ドキュメント内容のハッシュ（FNV-1a）を返す */
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

/** nodeId がいずれかのコンポーネントのマスターに属しているか */
export function componentOf(doc: SiteDoc, nodeId: string): string | null {
  for (const comp of Object.values(doc.components ?? {})) {
    if (comp.rootId === nodeId) return comp.id;
    let cur = findParentOf(doc, nodeId);
    while (cur?.kind === "node") {
      if (cur.id === comp.rootId) return comp.id;
      cur = findParentOf(doc, cur.id);
    }
  }
  return null;
}

export function collectDescendants(doc: SiteDoc, nodeId: string): string[] {
  const out: string[] = [nodeId];
  const node = doc.nodes[nodeId];
  if (node) for (const c of node.children) out.push(...collectDescendants(doc, c));
  return out;
}

/**
 * compIds のコンポーネントと、その中で（入れ子も含めて）使っているコンポーネントのID。
 * コンポーネントの中に自分自身を入れると無限に入れ子になるため、その判定に使う
 */
export function componentsReachable(doc: SiteDoc, compIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const visit = (cid: string) => {
    const comp = doc.components?.[cid];
    if (!comp || out.has(cid)) return;
    out.add(cid);
    for (const id of collectDescendants(doc, comp.rootId)) {
      const n = doc.nodes[id];
      if (n?.type === "instance" && n.componentId) visit(n.componentId);
    }
  };
  for (const cid of compIds) visit(cid);
  return out;
}

/**
 * 複製したページのURL。「[slug]」の区切りに文字を足すと使えないURLになるため、
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

/** 「ページ 3」「page-3」のように、ほかのページと重ならない名前とURLにする */
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

/** 親から順の祖先ノードID（ページ直下の要素なら空） */
export function ancestorsOf(doc: SiteDoc, nodeId: string): string[] {
  const out: string[] = [];
  let cur = findParentOf(doc, nodeId);
  while (cur?.kind === "node") {
    out.unshift(cur.id);
    cur = findParentOf(doc, cur.id);
  }
  return out;
}

/** ツリー上の位置（上から並べたときの順序の比較に使う） */
function treePosition(doc: SiteDoc, nodeId: string): number[] {
  const out: number[] = [];
  let id = nodeId;
  let cur = findParentOf(doc, id);
  while (cur) {
    out.unshift(childrenOf(doc, cur).indexOf(id));
    if (cur.kind === "page") break;
    id = cur.id;
    cur = findParentOf(doc, id);
  }
  return out;
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

/** パネルからの変更を適用する要素（複数選択中で nodeId を含むなら選択中の全要素） */
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

function loadDoc(): SiteDoc {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const doc = JSON.parse(raw) as SiteDoc;
        if (doc.pages && doc.nodes && doc.pageOrder?.length) {
          return doc;
        }
      }
    } catch {
      // 壊れたデータは無視して新規作成
    }
  }
  return createInitialDoc();
}

/** 前回開いていたページ。削除済みなら先頭ページへ安全に戻す */
function loadActivePageId(doc: SiteDoc): string {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(ACTIVE_PAGE_KEY);
      if (saved && doc.pages[saved]) return saved;
    } catch {
      // localStorageが利用できない場合は先頭ページを使う
    }
  }
  return doc.pageOrder[0];
}

export interface EditorStore {
  doc: SiteDoc;
  past: SiteDoc[];
  future: SiteDoc[];
  activePageId: string;
  selection: string | null;
  /** 選択中の全要素。selection はこの配列内の主選択（最後に選んだ要素） */
  selectedIds: string[];
  breakpoint: Breakpoint;
  /** キャンバスのカスタム画面幅（null = ブレークポイントの表示幅） */
  customWidth: number | null;
  styleState: StyleState;
  mode: EditorMode;
  leftTab: LeftTab;
  editingText: string | null;
  /** 0 = 自動フィット */
  zoom: number;
  /** 動的ページのプレビューに使うアイテムのインデックス */
  previewIndex: number;
  setPreviewIndex: (i: number) => void;
  savedAt: number | null;
  publishedAt: number | null;
  /** 最後に公開したドキュメントの docFingerprint */
  publishedFingerprint: string | null;
  cloudState: CloudState;
  cloudSavedAt: number | null;

  select: (id: string | null) => void;
  /** Shiftクリック用: 要素を現在の選択へ追加、選択済みなら解除 */
  toggleSelection: (id: string) => void;
  /** 選択中の要素の親を選択する（ページ直下なら body） */
  selectParent: () => void;
  /** 複数の要素をまとめて選択する（primary = 主選択） */
  selectMany: (ids: string[], primary: string) => void;
  /** 選択中の要素と同じ階層の要素をすべて選択（未選択ならページ直下をすべて） */
  selectAll: () => void;
  setBreakpoint: (bp: Breakpoint) => void;
  /** カスタム幅を設定（対応するブレークポイントへ自動で切替える） */
  setCustomWidth: (w: number | null) => void;
  setStyleState: (s: StyleState) => void;
  setMode: (m: EditorMode) => void;
  setLeftTab: (t: LeftTab) => void;
  /** アセットパネルで目立たせて表示するアセット（表示し終えたら null に戻す） */
  revealAssetId: string | null;
  /** アセットパネルを開いて、そのアセットまでスクロールして目立たせる */
  revealAsset: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  /** テキスト編集中に選択された部分範囲（スタイル変更時のspan分割に使う） */
  textSel: { nodeId: string; start: number; end: number; text: string } | null;
  setTextSel: (sel: EditorStore["textSel"]) => void;
  /**
   * テキストの一部をspanとして切り出す。親はテキスト情報（見出しレベル）を
   * 保持したまま before / 対象 / after のspan子要素に分割される。
   * props を渡すと、切り出したspanへ現在の (bp, state) でスタイルを適用する。
   * 成功時は新しいspanのIDを返す（1回のundoで戻せる）
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
  /** 公開したドキュメントの内容ハッシュ（docFingerprint）と日時を記録する */
  markPublished: (fingerprint: string) => void;
  setCloud: (state: CloudState, savedAt?: number) => void;
  /** サーバーから取得したドキュメントで置き換える（履歴はリセット） */
  replaceDoc: (doc: SiteDoc) => void;
  /** バックアップ・公開済みの版の内容に戻す（「元に戻す」で戻せる。サーバーにも保存される） */
  restoreDoc: (doc: SiteDoc) => void;
  /**
   * 他の編集者の変更（WebSocket・ポーリングで受け取ったもの）を取り込む。
   * 選択・表示ページ・編集中コンポーネントを可能な限り維持する
   */
  applyRemoteDoc: (doc: SiteDoc) => void;

  /** 追加・貼り付けする位置の決め方（ブラウザごとに覚える） */
  insertMode: InsertMode;
  setInsertMode: (m: InsertMode) => void;

  clipboard: { nodes: DocNode[]; rootIds: string[] } | null;
  /** 要素をコピーする（複数選択中で nodeId を含むなら選択中の全要素） */
  copyNode: (nodeId: string) => void;
  /**
   * クリップボードの内容を、挿入先の設定（中へ / 後ろへ）に従って選択位置に貼り付け（未選択ならページ末尾）。
   * external を渡すと、ほかのサイト（タブ）でコピーした要素を、使っているアセット・コンポーネントごと貼り付ける
   */
  pasteClipboard: (external?: ClipPayload) => void;

  /**
   * 開いているスクリプト画面（null = 閉じている）。
   * focusNodeId = 要素の設定から開いた要素 / focusScriptId = 開いたときに選んで見せるスクリプト
   */
  scriptEditor: { focusNodeId: string | null; focusScriptId?: string } | null;
  openScriptEditor: (
    opts: { focusNodeId: string | null; focusScriptId?: string } | null
  ) => void;

  /** 右パネルのタブ（要素を選んでいるとき） */
  rightTab: RightTab;
  setRightTab: (t: RightTab) => void;

  /** 編集中のコンポーネントID（nullならページ編集） */
  editingComponentId: string | null;
  setEditingComponent: (id: string | null) => void;
  /** ノードをコンポーネント化し、元の位置をインスタンスに置き換える */
  createComponent: (nodeId: string) => void;
  /** ボックスをテンプレートにしたリストを作り、元の位置をリストに置き換える */
  createList: (nodeId: string) => void;
  /** インスタンスをマスターの複製（通常のノード）に展開する */
  detachInstance: (nodeId: string) => void;
  insertInstance: (componentId: string) => void;
  deleteComponent: (componentId: string) => void;

  checkpoint: () => void;
  /**
   * ドラッグでの数値変更など、続けて起きる変更を1つの「元に戻す」にまとめる。
   * beginGesture 〜 endGesture の間の updateDoc は履歴を積まない（最初の変更前だけを積む）
   */
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  /** history: 省略時 true。transient操作は checkpoint() を先に呼び history:false で更新する */
  updateDoc: (fn: (doc: SiteDoc) => void, opts?: { history?: boolean }) => void;

  setStyleProps: (
    nodeId: string,
    props: Record<string, string | null>,
    opts?: { transient?: boolean }
  ) => void;
  updateNode: (nodeId: string, patch: Partial<DocNode>) => void;
  /**
   * 複数選択中で nodeId がその中にあれば選択中の全要素、そうでなければ nodeId だけに fn を適用する
   * （スタイルパネルからの変更を一括で反映するため。1回のundoで戻せる）
   */
  updateTargets: (nodeId: string, fn: (node: DocNode) => void) => void;
  /** いま表示中のデバイス（と、それより小さい画面）で表示／非表示を切り替える */
  toggleHiddenHere: (nodeId: string) => void;
  /** 指定したデバイスだけ表示／非表示を切り替える */
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
   * ロック中・body は除き、選んだ要素の中にある要素は親ごと消える
   */
  deleteNodes: (nodeIds: string[]) => void;
  duplicateNode: (nodeId: string) => void;
  /**
   * 複数の要素をそれぞれの後ろへまとめて複製し、複製を選ぶ（1回の「元に戻す」で戻せる）。
   * 選んだ要素の中にある要素は親ごと複製される
   */
  duplicateNodes: (nodeIds: string[]) => void;
  moveNode: (nodeId: string, parent: ParentRef, index: number) => void;
  /** 複数の要素を並び順のまま parent の index の位置へまとめて移動する */
  moveNodes: (nodeIds: string[], parent: ParentRef, index: number) => void;

  setActivePage: (id: string) => void;
  /**
   * 開いているページの次に作る（同じフォルダに入る）。
   * folderId を渡すと、そのフォルダの中に作る
   */
  addPage: (folderId?: string) => void;
  /** ページ一覧のフォルダを作り、そのIDを返す（URLには関係しない、エディタ上の整理） */
  addPageFolder: () => string;
  renamePageFolder: (folderId: string, name: string) => void;
  /** フォルダを消す（中のページは消さず、フォルダの外へ出す） */
  deletePageFolder: (folderId: string) => void;
  /**
   * ページをフォルダへ入れる・出す（folderId = null でフォルダの外）。
   * before / after のページの前後へ並べ、指定が無ければそのフォルダの末尾へ
   */
  placePage: (
    pageId: string,
    folderId: string | null,
    anchor?: { before?: string; after?: string }
  ) => void;
  /** フォルダを並べ替える（index は移動前の並びでの位置） */
  moveFolder: (folderId: string, index: number) => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  /** 複数のページをまとめて削除する（1回の「元に戻す」で戻せる。最後の1ページは残す） */
  deletePages: (ids: string[]) => void;
  /**
   * 複数のページを並び順のままフォルダへ入れる・出す（folderId = null でフォルダの外）。
   * anchor のページの前後へ並べ、指定が無ければそのフォルダの末尾へ
   */
  movePagesToFolder: (
    ids: string[],
    folderId: string | null,
    anchor?: { before?: string; after?: string }
  ) => void;
  updatePage: (id: string, patch: Partial<Page>) => void;

  resetDoc: () => void;
}

/** ページのURL変更に合わせて、リンク・スクリプト・転送先に直接入力されたURLを書き換える */
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

function sameDoc(a: SiteDoc, b: SiteDoc): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** テキスト編集中なら確定（blur）させ、入力内容を履歴に載せてから undo / redo する */
function commitActiveTextEdit() {
  if (typeof document === "undefined") return;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable) el.blur();
}

export const useEditor = create<EditorStore>((set, get) => {
  const initialDoc = loadDoc();
  // 保存した編集位置のブレークポイントを確かめるため、先にサイトの設定を反映する
  applyBreakpoints(initialDoc);
  const savedUi = loadUi(initialDoc);
  /**
   * checkpoint() で記録した変更前の状態。実際に変更が入った時点で履歴へ積む
   *（クリックだけでドラッグしなかった場合などに、空の履歴や redo の消失を作らない）
   */
  let pendingBase: SiteDoc | null = null;

  /** beginGesture 〜 endGesture の間か */
  let gesture = false;
  const pushHistory = (snapshot: SiteDoc) => {
    pendingBase = null;
    set((s) => ({
      past: [...s.past.slice(-HISTORY_LIMIT + 1), snapshot],
      future: [],
    }));
  };

  /** リモートの変更（current → next）を履歴の各スナップショットにも反映する */
  const rebaseHistory = (list: SiteDoc[], current: SiteDoc, next: SiteDoc) =>
    list.map((snap) => mergeDocs(current, snap, next));

  return {
    doc: initialDoc,
    past: [],
    future: [],
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
    // 編集を始めるときは古い部分選択を破棄する（編集中に選択し直せば更新される）
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
      if (!node?.text) return null;
      const content = node.text.content;
      // 編集確定時の整形などでズレていたら、選択文字列で探し直す
      if (content.slice(start, end) !== text) {
        const at = text ? content.indexOf(text) : -1;
        if (at < 0) return null;
        start = at;
        end = at + text.length;
      }
      if (start <= 0 && end >= content.length) return null; // 全選択は分割不要
      if (start >= end) return null;

      const { breakpoint, styleState } = get();
      const makeSpan = (part: string): DocNode => ({
        id: genId("node"),
        type: "box",
        name: part.trim().slice(0, 12) || tr("テキスト"),
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
        // 保存失敗しても公開自体は成功しているので無視
      }
      set({ publishedAt: now, publishedFingerprint: fingerprint });
    },

    setCloud: (state, savedAt) =>
      set((s) => ({
        cloudState: state,
        cloudSavedAt: savedAt ?? s.cloudSavedAt,
      })),

    replaceDoc: (doc) => {
      pendingBase = null;
      const currentPageId = get().activePageId;
      set({
        doc,
        past: [],
        future: [],
        activePageId: doc.pages[currentPageId]
          ? currentPageId
          : loadActivePageId(doc),
        // 前回の編集位置を戻したあとにサーバーの内容へ置き換えても、残っている要素の選択は保つ
        selection: validSelection(doc, get().selection),
        selectedIds: validSelectedIds(doc, get().selectedIds),
        editingComponentId:
          get().editingComponentId && doc.components?.[get().editingComponentId!]
            ? get().editingComponentId
            : null,
        editingText: null,
      });
    },

    restoreDoc: (doc) => {
      const current = get().doc;
      if (sameDoc(current, doc)) return;
      pushHistory(current);
      const selectedIds = validSelectedIds(doc, get().selectedIds);
      set({
        doc,
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

    applyRemoteDoc: (doc) => {
      pendingBase = null;
      set((s) => {
        const selectedIds = validSelectedIds(doc, s.selectedIds);
        const selection = validSelection(doc, s.selection);
        // 履歴をそのまま使うとundoでリモートの変更まで巻き戻るため、
        // 各スナップショットへリモートの変更を三方向マージで取り込んでおく
        let past: SiteDoc[] = [];
        let future: SiteDoc[] = [];
        try {
          past = rebaseHistory(s.past, s.doc, doc);
          future = rebaseHistory(s.future, s.doc, doc);
        } catch {
          // マージできない場合は安全側に倒して履歴を破棄
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

    copyNode: (nodeId) => {
      const doc = get().doc;
      if (!doc.nodes[nodeId]) return;
      const targets = targetIdsFor(get().selectedIds, nodeId).filter(
        (id) => id !== BODY_NODE_ID && doc.nodes[id]
      );
      // 祖先も選ばれている要素は、祖先のコピーに含まれる
      const inside = new Set<string>();
      for (const id of targets) {
        for (const d of collectDescendants(doc, id)) if (d !== id) inside.add(d);
      }
      const rootIds = targets
        .filter((id) => !inside.has(id))
        .sort((a, b) => comparePosition(treePosition(doc, a), treePosition(doc, b)));
      const clipboard = {
        nodes: rootIds.flatMap((root) =>
          collectDescendants(doc, root).map((id) => structuredClone(doc.nodes[id]))
        ),
        rootIds,
      };
      set({ clipboard });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("tsumu-internal-copy"));
        // ほかのサイトでも貼り付けられるよう、OS のクリップボードにも書く
        writeClipPayload(buildClipPayload(doc, clipboard));
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
        // 元の位置をインスタンスに差し替え（マスターはnodesに残る）
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
          name: tr("{name}リスト", { name: node.name }),
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
      // マスターを複製して通常ノード化
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
      // 同じページの他のインスタンスとID属性が重ならないようにする
      refreshClonedIds(doc, get().activePageId, clones);
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
      // ページの要素を選んでいれば、ほかの要素の追加と同じくその中（入れられなければ後ろ）へ。
      // コンポーネントの編集中は、ページの末尾へ置いてページ編集に戻る
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
        // 全インスタンスを削除
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
        // マスターのノードを削除
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
      const clip = external ?? get().clipboard;
      if (!clip) return;
      const idMap = new Map(clip.nodes.map((n) => [n.id, genId("node")]));
      const clones = clip.nodes.map((n) => {
        const c = structuredClone(n);
        c.id = idMap.get(n.id)!;
        c.children = n.children.map((cid) => idMap.get(cid)!);
        return c;
      });
      const newRootIds = clip.rootIds.map((id) => idMap.get(id)!);

      const { selection, doc, activePageId, editingComponentId } = get();
      // 貼り付け先のページで ID属性が重ならないように付け替える（中のスクリプトの参照も合わせる）
      refreshClonedIds(doc, activePageId, clones);
      const editingComp = editingComponentId
        ? doc.components?.[editingComponentId]
        : null;
      const { parent, index } = insertPointFor(
        doc,
        selection,
        editingComp ? { kind: "node", id: editingComp.rootId } : { kind: "page", id: activePageId },
        get().insertMode
      );
      // コンポーネントの中へ、そのコンポーネント自身（を含むインスタンス）は入れない（無限に入れ子になる）
      const host = parent.kind === "node" ? componentOf(doc, parent.id) : null;
      if (host) {
        const pasted = clones.flatMap((n) =>
          n.type === "instance" && n.componentId ? [n.componentId] : []
        );
        if (componentsReachable(doc, pasted).has(host)) {
          void showAlert(
            tr("コンポーネント「{p1}」の中に、そのコンポーネント自身は入れられません（無限に入れ子になるため）。", { p1: doc.components?.[host]?.name ?? "" }),
            { title: tr("ここには貼り付けられません") }
          );
          return;
        }
      }
      get().updateDoc((d) => {
        // ほかのサイトの要素なら、使っているアセット・コンポーネント・フォントを先に足す
        const remap = external ? mergeClipDeps(d, external) : new Map<string, string>();
        for (const n of clones) d.nodes[n.id] = remapAssetIds(n, remap);
        const list = childrenOf(d, parent);
        list.splice(index === undefined ? list.length : index, 0, ...newRootIds);
      });
      set({
        selection: newRootIds[newRootIds.length - 1] ?? null,
        selectedIds: newRootIds,
      });
    },

    beginGesture: () => {
      get().checkpoint();
      gesture = true;
    },
    endGesture: () => {
      gesture = false;
    },
    checkpoint: () => {
      pendingBase = structuredClone(get().doc);
    },

    undo: () => {
      commitActiveTextEdit();
      pendingBase = null;
      const { doc } = get();
      const past = [...get().past];
      // 現在と同じ内容の履歴は、押しても何も起きないため読み飛ばす
      let prev: SiteDoc | undefined;
      while (past.length) {
        const cand = past.pop()!;
        if (!sameDoc(cand, doc)) {
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
      const { doc } = get();
      const future = [...get().future];
      let next: SiteDoc | undefined;
      while (future.length) {
        const cand = future.shift()!;
        if (!sameDoc(cand, doc)) {
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

    updateDoc: (fn, opts) => {
      const current = get().doc;
      const next = structuredClone(current);
      fn(next);
      if (opts?.history === false || gesture) {
        // checkpoint() 後の最初の実際の変更で、変更前の状態を履歴へ積む
        if (pendingBase && !sameDoc(next, current)) pushHistory(pendingBase);
        set({ doc: next });
        return;
      }
      // blurなどで値が変わらなかった場合は、見た目の変わらない履歴を作らない
      if (sameDoc(next, current)) return;
      pushHistory(current);
      set({ doc: next });
    },

    setStyleProps: (nodeId, props, opts) => {
      const { breakpoint, styleState } = get();
      const targetIds = targetIdsFor(get().selectedIds, nodeId);
      get().updateDoc(
        (doc) => {
          for (const id of targetIds) {
            const node = doc.nodes[id];
            if (!node) continue;
            const bpStyles = (node.styles[breakpoint] ??= {});
            const map = (bpStyles[styleState] ??= {});
            for (const [k, v] of Object.entries(props)) {
              // 空文字は「未設定」として消す（空の値が設定済みの色だけ付けて残らないように）
              if (v === null || v === "") delete map[k];
              else map[k] = v;
            }
          }
        },
        { history: !opts?.transient }
      );
    },

    updateNode: (nodeId, patch) => {
      get().updateDoc((doc) => {
        const node = doc.nodes[nodeId];
        if (node) Object.assign(node, patch);
      });
    },

    updateTargets: (nodeId, fn) => {
      const targetIds = targetIdsFor(get().selectedIds, nodeId);
      get().updateDoc((doc) => {
        for (const id of targetIds) {
          const node = doc.nodes[id];
          if (node) fn(node);
        }
      });
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
      get().updateDoc((doc) => {
        refreshClonedIds(doc, get().activePageId, nodes);
        for (const n of nodes) doc.nodes[n.id] = n;
        const list = childrenOf(doc, parent);
        const i = index === undefined ? list.length : index;
        list.splice(i, 0, rootId);
      });
      set({ selection: rootId, selectedIds: [rootId] });
    },

    deleteNode: (nodeId) => {
      // コンポーネントのマスタールートは deleteComponent 経由で消す
      const comp = Object.values(get().doc.components ?? {}).find(
        (c) => c.rootId === nodeId
      );
      if (comp) {
        void showConfirm(tr("ページに置いた、このコンポーネントの使用箇所（インスタンス）もすべて削除されます。"), {
          title: tr("コンポーネント「{name}」を削除しますか？", { name: comp.name }),
          okLabel: tr("削除"),
          danger: true,
        }).then((ok) => {
          if (ok) get().deleteComponent(comp.id);
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
      // コンポーネントのマスタールートは個別の確認が要るため、通常の削除からは外す
      const compRoots = new Set(Object.values(doc.components ?? {}).map((c) => c.rootId));
      const targets = ids.filter((id) => !compRoots.has(id));
      // 祖先も選ばれている要素は、祖先の削除で一緒に消える
      const inside = new Set<string>();
      for (const id of targets) {
        for (const d of collectDescendants(doc, id)) if (d !== id) inside.add(d);
      }
      const roots = targets.filter((id) => !inside.has(id));
      get().updateDoc((d) => {
        for (const id of roots) {
          const parent = findParentOf(d, id);
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
      const ids = nodeIds.filter((id) => doc.nodes[id] && findParentOf(doc, id));
      // 祖先も選ばれている要素は、祖先の複製に含まれる
      const inside = new Set<string>();
      for (const id of ids) {
        for (const d of collectDescendants(doc, id)) if (d !== id) inside.add(d);
      }
      const roots = ids
        .filter((id) => !inside.has(id))
        .sort((a, b) => comparePosition(treePosition(doc, a), treePosition(doc, b)));
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
      // 複製のID属性が元と重ならないように付け替える（中のスクリプトの参照も合わせる）
      refreshClonedIds(doc, get().activePageId, clones);
      get().updateDoc((d) => {
        for (const c of clones) d.nodes[c.id] = c;
        for (const { from, copy } of pairs) {
          const parent = findParentOf(d, from);
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
      // ドラッグ中の削除・同時編集で移動先が無くなったら、元の構造を保つ。
      if (parent.kind === "page" ? !doc.pages[parent.id] : !doc.nodes[parent.id]) return;
      // マスターのルート（親を持たない）は移動できない。重複選択も1回だけ扱う。
      const movable = [...new Set(nodeIds)].filter((id) => doc.nodes[id] && findParentOf(doc, id));
      // 選択した要素の子孫は親ごと動くので個別には動かさない
      const ids = movable.filter(
        (id) =>
          !movable.some((o) => o !== id && collectDescendants(doc, o).includes(id))
      );
      if (!ids.length) return;
      // 自分自身・子孫への移動を禁止
      if (
        parent.kind === "node" &&
        ids.some((id) => collectDescendants(doc, id).includes(parent.id))
      ) {
        return;
      }
      ids.sort((a, b) =>
        comparePosition(treePosition(doc, a), treePosition(doc, b))
      );
      get().updateDoc((d) => {
        const toList = childrenOf(d, parent);
        // 挿入位置より前から抜ける要素の分だけ位置を詰める
        const i = index - toList.slice(0, index).filter((id) => ids.includes(id)).length;
        for (const id of ids) {
          const from = findParentOf(d, id);
          if (!from) continue;
          const list = childrenOf(d, from);
          list.splice(list.indexOf(id), 1);
        }
        toList.splice(Math.max(0, Math.min(i, toList.length)), 0, ...ids);
      });
    },

    // ページを開いたら、コンポーネントの編集を終えてそのページを表示する
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
      // ページを消したあとでも、既存のページと名前・URLが重ならない番号にする
      const { name, slug } = uniquePageNaming(
        get().doc,
        (n) => tr(NEW_PAGE_NAME, { n }),
        (n) => `page-${n}`,
        get().doc.pageOrder.length + 1
      );
      const activeId = get().activePageId;
      get().updateDoc((doc) => {
        const active = doc.pages[activeId];
        // フォルダの指定がなければ、開いているページと同じフォルダに入れる
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
      while (names.has(n > 1 ? tr("フォルダ {n}", { n }) : tr("フォルダ"))) n++;
      get().updateDoc((d) => {
        d.pageFolders = [...(d.pageFolders ?? []), { id, name: n > 1 ? tr("フォルダ {n}", { n }) : tr("フォルダ") }];
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
          // 同じフォルダ（フォルダの外ならフォルダの外）の最後のページの後ろ
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
      // 2回目以降の複製でもURLが重ならないよう「-copy-2」のように番号を付ける
      const { name, slug } = uniquePageNaming(
        doc,
        (n) => (n > 1 ? tr("{name} のコピー {n}", { name: src.name, n }) : tr("{name} のコピー", { name: src.name })),
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
        // タイトルは複製元のまま持たせ、初めてページ名を確定したときにその名前にする
        d.pages[id].titlePending = true;
        d.pageOrder.splice(d.pageOrder.indexOf(pageId) + 1, 0, id);
      });
      get().setActivePage(id);
    },

    deletePage: (pageId) => get().deletePages([pageId]),

    deletePages: (pageIds) => {
      const { doc } = get();
      const ids = new Set(pageIds.filter((id) => doc.pageOrder.includes(id)));
      // ページが1つも無くならないよう、全部選んでいても先頭の1ページは残す
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
        // 削除ページを指すリンクを掃除
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
        // anchor の前後、無ければ移動先（フォルダ / フォルダの外）の最後のページの後ろへ、並び順のまま入れる
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
      pushHistory(get().doc);
      const doc = createInitialDoc();
      set({
        doc,
        activePageId: doc.pageOrder[0],
        selection: null,
        selectedIds: [],
        // 消えたコンポーネントの編集・スクリプト画面は閉じる
        editingComponentId: null,
        editingText: null,
        textSel: null,
        scriptEditor: null,
      });
    },
    // 前回の編集位置（初期値より後に置いて上書きする）
    ...savedUi,
  };
});

// ページ切替だけでなく、追加・複製・削除・リセットによる表示ページの変更も記憶する。
if (typeof window !== "undefined") {
  let rememberedPageId = useEditor.getState().activePageId;
  try {
    window.localStorage.setItem(ACTIVE_PAGE_KEY, rememberedPageId);
  } catch {
    // 保存できなくても編集操作は続けられる
  }
  useEditor.subscribe((state) => {
    if (state.activePageId === rememberedPageId) return;
    rememberedPageId = state.activePageId;
    try {
      window.localStorage.setItem(ACTIVE_PAGE_KEY, rememberedPageId);
    } catch {
      // 保存できなくても編集操作は続けられる
    }
  });
}

// ブレークポイントの幅はドキュメントの設定に合わせる（画面の描画より先に反映する）
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

// 編集位置（選択・デバイス・倍率・タブ・開いている画面）を記憶し、次に開いたときに戻す
if (typeof window !== "undefined") {
  let last = JSON.stringify(pickUi(useEditor.getState()));
  let timer: ReturnType<typeof setTimeout> | null = null;
  useEditor.subscribe((state) => {
    const next = JSON.stringify(pickUi(state));
    if (next === last) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        window.localStorage.setItem(UI_KEY, last);
      } catch {
        // 保存できなくても編集操作は続けられる
      }
    }, 200);
  });
}

/** ドキュメントの自動保存（Editorコンポーネントから購読） */
export function persistDoc(doc: SiteDoc) {
  try {
    const json = JSON.stringify(doc);
    if (window.localStorage.getItem(STORAGE_KEY) === json) return true;
    window.localStorage.setItem(STORAGE_KEY, json);
    // 開いただけでは変わらず、中身が変わったときだけホームの「最終編集」を進める
    touchLocalSite();
  } catch {
    // 容量超過などは黙って無視（フッターの保存表示が更新されないことで気付ける）
    return false;
  }
  return true;
}
