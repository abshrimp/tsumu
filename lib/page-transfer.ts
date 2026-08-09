"use client";

/**
 * ページをほかのサイトへコピーする。
 * ページと中の要素を、使っているアセット・コンポーネント・フォントと一緒にまとめ、
 * コピー先のサイトの編集データ（D1 / このブラウザの保存）へ書き足す
 */

import type { BreakpointDef, DocNode, NodeStyles, Page, ScriptStep, SiteDoc } from "./types";
import { buildClipPayload, mergeClipDeps, remapAssetIds, type ClipPayload } from "./clip-transfer";
import { createInitialDoc, genId } from "./presets";
import { copySlug, uniquePageNaming } from "./store";
import { isLocalSiteDeleted } from "./site";
import { readBrowserDoc, writeBrowserDoc } from "./browser-doc-storage";
import { tr } from "./i18n";
import { isSiteLang, siteLangOf } from "./site-lang";
import { normalizeQuery } from "./vars";
import { DEFAULT_BREAKPOINTS, MAX_BREAKPOINTS, normalizeBreakpoints } from "./style";

export interface PagePayload {
  breakpoints: BreakpointDef[];
  pages: Page[];
  /** ページの中の要素（入れ子も含む） */
  nodes: DocNode[];
  /** ページが入っていたフォルダの名前（ページID → 名前） */
  folders: Record<string, string>;
  /** コピー元の全ページのURL（ページID → slug。コピーしなかったページへのリンクを付け替えるため） */
  slugs: Record<string, string>;
  /** 同じslugのページを区別するクエリ */
  queries: Record<string, string>;
  deps: ClipPayload;
  /** コピー元のサイトの言語（ページで言語を選んでいなければ、こちらの言語で書かれている） */
  lang?: string;
}

function descendants(doc: SiteDoc, id: string, out: DocNode[]): void {
  const n = doc.nodes[id];
  if (!n) return;
  out.push(structuredClone(n));
  for (const c of n.children) descendants(doc, c, out);
}

/** コピーするページ（並び順どおり。ローディング画面は除く）をまとめる */
export function buildPagePayload(doc: SiteDoc, pageIds: string[]): PagePayload {
  const ids = doc.pageOrder.filter((id) => pageIds.includes(id));
  const pages = ids.map((id) => structuredClone(doc.pages[id]));
  const nodes: DocNode[] = [];
  for (const p of pages) for (const c of p.children) descendants(doc, c, nodes);
  const folders: Record<string, string> = {};
  for (const p of pages) {
    const f = p.folderId ? doc.pageFolders?.find((x) => x.id === p.folderId) : undefined;
    if (f) folders[p.id] = f.name;
  }
  const slugs: Record<string, string> = {};
  const queries: Record<string, string> = {};
  for (const p of Object.values(doc.pages)) {
    slugs[p.id] = p.slug;
    queries[p.id] = p.query ?? "";
  }
  // ページの設定（OGP画像・背景・ページのスクリプト）で使うアセットも拾うため、ページごと渡す
  const deps = buildClipPayload(doc, { nodes, rootIds: [], pages });
  deps.nodes = [];
  return { pages, nodes, folders, slugs, queries, deps, lang: siteLangOf(doc), breakpoints: structuredClone(doc.breakpoints ?? DEFAULT_BREAKPOINTS) };
}

function mapSteps(steps: ScriptStep[] | undefined, fn: (pageId: string) => string) {
  for (const st of steps ?? []) {
    if (st.kind === "open-page") st.pageId = fn(st.pageId);
    else if (st.kind === "if") {
      mapSteps(st.then, fn);
      mapSteps(st.else, fn);
    } else if (st.kind === "repeat" || st.kind === "for-each") mapSteps(st.then, fn);
  }
}

/**
 * まとめたページを、コピー先のドキュメントに足す（d を直接書き換える）。
 * ページ・要素には新しいIDを振り、名前・URLが重なれば「のコピー」を付ける。
 * ページへのリンクは、一緒にコピーしたページ → コピー先の同じURLのページの順に付け替える。
 * 戻り値は足したページの数
 */
/** Validate before importing any assets or components. Never change destination breakpoints. */
function prepareResponsivePayload(d: SiteDoc, payload: PagePayload): PagePayload {
  // A page copy is accepted only when its complete, current metadata exists.
  // Reject malformed imports before mergeClipDeps can mutate the destination.
  if (!payload || !payload.slugs || !payload.queries ||
      typeof payload.slugs !== "object" || Array.isArray(payload.slugs) ||
      typeof payload.queries !== "object" || Array.isArray(payload.queries)) {
    throw new Error("Invalid page copy metadata");
  }
  const fail = (): never => {
    throw new Error(tr("コピー元とコピー先の画面幅設定が一致しないか、参照できない設定があります。表示を保持するためコピーを中止しました。画面幅設定を揃えてから再試行してください。"));
  };
  const checked = (input: BreakpointDef[]) => {
    if (!Array.isArray(input) || input.length > MAX_BREAKPOINTS) return fail();
    const normalized = normalizeBreakpoints(input);
    if (normalized.length !== input.length || input.some((b) =>
      !b || !Number.isInteger(b.maxWidth) || b.maxWidth < 240 || b.maxWidth > 2999
    )) return fail();
    return normalized;
  };
  const source = checked(payload.breakpoints);
  const target = checked(d.breakpoints ?? DEFAULT_BREAKPOINTS);
  if (source.length !== target.length || source.some((b, i) => b.maxWidth !== target[i].maxWidth)) fail();
  const ids = new Map([["base", "base"], ...source.map((b, i) => [b.id, target[i].id] as [string, string])]);
  const id = (key: string): string => ids.get(key) ?? fail();
  const styles = (value: NodeStyles | undefined): NodeStyles | undefined =>
    value && Object.fromEntries(Object.entries(value).map(([key, style]) => [id(key), style]));
  const p = structuredClone(payload);
  for (const page of p.pages) page.bodyStyles = styles(page.bodyStyles);
  // Existing component masters are reused, not imported or modified.
  const componentNodes = new Map(p.deps.componentNodes.map(n => [n.id, n]));
  const needed = new Set<string>();
  const pending = Object.values(p.deps.components).filter(c => !d.components?.[c.id]).map(c => c.rootId);
  for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
    const node = componentNodes.get(key);
    if (!node || needed.has(key)) continue;
    needed.add(key);
    pending.push(...node.children);
  }
  for (const node of [...p.nodes, ...p.deps.componentNodes.filter(n => needed.has(n.id))]) {
    node.styles = styles(node.styles)!;
    if (node.hiddenOn) node.hiddenOn = node.hiddenOn.map(id);
  }
  return p;
}

export function applyPagePayload(d: SiteDoc, p: PagePayload): number {
  p = prepareResponsivePayload(d, p);
  const { assetIds: assetMap, componentNodes } = mergeClipDeps(d, p.deps);
  const pageMap = new Map<string, string>();
  for (const page of p.pages) pageMap.set(page.id, genId("page"));
  const urlKey = (slug: string, query?: string) => JSON.stringify([slug, normalizeQuery(query)]);
  const byUrl = new Map(Object.values(d.pages).map((x) => [urlKey(x.slug, x.query), x.id]));
  const toPage = (id: string) => {
    const copied = pageMap.get(id);
    if (copied) return copied;
    const slug = p.slugs[id];
    return (slug !== undefined && byUrl.get(urlKey(slug, p.queries[id]))) || id;
  };

  // 新しく取り込んだマスター内のリンクも付け替える。既存のマスターは変更しない。
  for (const n of componentNodes) {
    if (n.link?.kind === "page" && n.link.pageId) n.link.pageId = toPage(n.link.pageId);
    for (const s of n.scripts ?? []) mapSteps(s.steps, toPage);
  }

  const nodeMap = new Map<string, string>();
  for (const n of p.nodes) nodeMap.set(n.id, genId("node"));
  for (const raw of p.nodes) {
    const n = remapAssetIds(structuredClone(raw), assetMap);
    n.id = nodeMap.get(raw.id)!;
    n.children = n.children.map((c) => nodeMap.get(c)).filter((c): c is string => !!c);
    if (n.link?.kind === "page" && n.link.pageId) n.link.pageId = toPage(n.link.pageId);
    for (const s of n.scripts ?? []) mapSteps(s.steps, toPage);
    d.nodes[n.id] = n;
  }

  for (const raw of p.pages) {
    const page = remapAssetIds(structuredClone(raw), assetMap);
    const id = pageMap.get(raw.id)!;
    const { name, slug } = uniquePageNaming(
      d,
      (n) => (n === 0 ? raw.name : n > 1 ? tr("{name} のコピー {n}", { name: raw.name, n }) : tr("{name} のコピー", { name: raw.name })),
      (n) => (n === 0 ? raw.slug : copySlug(raw.slug, n)),
      0
    );
    page.id = id;
    page.name = name;
    page.slug = slug;
    // コピー先のサイトと言語が違えば、ページの言語として残す（中身はコピー元の言語のまま）
    if (!isSiteLang(page.lang) && p.lang && isSiteLang(p.lang) && p.lang !== siteLangOf(d)) page.lang = p.lang;
    page.children = raw.children.map((c) => nodeMap.get(c)).filter((c): c is string => !!c);
    for (const s of [...(page.scripts ?? []), ...(page.pageScripts ?? [])]) mapSteps(s.steps, toPage);
    // フォルダは名前で探し、無ければ同じ名前で作る
    delete page.folderId;
    const folderName = p.folders[raw.id];
    if (folderName) {
      let folder = d.pageFolders?.find((f) => f.name === folderName);
      if (!folder) {
        folder = { id: genId("folder"), name: folderName };
        d.pageFolders = [...(d.pageFolders ?? []), folder];
      }
      page.folderId = folder.id;
    }
    d.pages[id] = page;
    d.pageOrder.push(id);
  }
  return p.pages.length;
}

/* ---------- コピー先のサイトの編集データ ---------- */

async function readJson(res: Response): Promise<Record<string, any>> {
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status !== 409) {
    throw new Error(data?.error ?? tr("通信に失敗しました（{status}）", { status: res.status }));
  }
  return data ?? {};
}

/**
 * ページをほかのサイトへコピーする。
 * server = D1 に保存しているサイト（ほかの人が編集中でも、版を確かめて書き足す）、
 * local = このブラウザに保存しているサイト
 */
export async function copyPagesToSite(
  target: { id: string; name: string },
  payload: PagePayload,
  store: "server" | "local"
): Promise<void> {
  if (store === "local") {
    let doc: SiteDoc;
    let expected: string | null;
    try {
      // The destination list can be stale while the copy dialog is open.
      // Never recreate content for a site explicitly deleted in another tab.
      if (isLocalSiteDeleted(target.id)) throw new Error("Local destination deleted");
      const raw = await readBrowserDoc(target.id);
      expected = raw;
      // 未保存と読み込み失敗を区別し、読めない既存データを初期状態で上書きしない。
      if (raw === null) {
        doc = createInitialDoc();
        doc.siteName = target.name;
      } else {
        doc = JSON.parse(raw) as SiteDoc;
        if (!doc?.pages || !doc.nodes || !doc.assets || !Array.isArray(doc.pageOrder) || !doc.pageOrder.length) {
          throw new Error("Invalid destination document");
        }
      }
    } catch {
      throw new Error(tr("コピー先の編集データを読み込めませんでした。コピー先を確認して、もう一度お試しください。"));
    }
    applyPagePayload(doc, payload);
    try {
      if (isLocalSiteDeleted(target.id)) throw new Error("Local destination deleted");
      const result = await writeBrowserDoc(target.id, JSON.stringify(doc), expected);
      if (result !== "saved" || isLocalSiteDeleted(target.id)) throw new Error("Destination changed");
    } catch {
      throw new Error(tr("ブラウザへの保存ができなかったため、コピーできませんでした"));
    }
    return;
  }

  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ site: target.id, ...extra }).toString();
  let data = await readJson(await fetch(`/api/doc?${q()}`));
  // ほかの人が同時に保存したときは、新しい版に書き足し直す
  for (let attempt = 0; attempt < 4; attempt++) {
    let doc: SiteDoc;
    let base: string | null = null;
    if (data.exists || data.conflict) {
      doc = data.doc as SiteDoc;
      base = String(data.rev);
    } else {
      // まだ一度も開いていないサイト（開いたときと同じ初期の内容に足す）
      doc = createInitialDoc();
      doc.siteName = target.name;
    }
    applyPagePayload(doc, payload);
    const res = await fetch(`/api/doc?${q(base ? { base } : {})}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    data = await readJson(res);
    if (res.ok) return;
  }
  throw new Error(tr("ほかの人の保存と重なったため、コピーできませんでした。もう一度お試しください。"));
}
