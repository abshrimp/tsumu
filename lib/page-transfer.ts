"use client";

/**
 * ページをほかのサイトへコピーする。
 * ページと中の要素を、使っているアセット・コンポーネント・フォントと一緒にまとめ、
 * コピー先のサイトの編集データ（D1 / このブラウザの保存）へ書き足す
 */

import type { DocNode, Page, ScriptStep, SiteDoc } from "./types";
import { buildClipPayload, mergeClipDeps, remapAssetIds, type ClipPayload } from "./clip-transfer";
import { createInitialDoc, genId } from "./presets";
import { copySlug, uniquePageNaming } from "./store";
import { DOC_STORAGE_KEY, siteKey } from "./site";
import { tr } from "./i18n";
import { isSiteLang, siteLangOf } from "./site-lang";

export interface PagePayload {
  pages: Page[];
  /** ページの中の要素（入れ子も含む） */
  nodes: DocNode[];
  /** ページが入っていたフォルダの名前（ページID → 名前） */
  folders: Record<string, string>;
  /** コピー元の全ページのURL（ページID → slug。コピーしなかったページへのリンクを付け替えるため） */
  slugs: Record<string, string>;
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
  for (const p of Object.values(doc.pages)) slugs[p.id] = p.slug;
  // ページの設定（OGP画像・背景・ページのスクリプト）で使うアセットも拾うため、ページごと渡す
  const deps = buildClipPayload(doc, { nodes: [...nodes, ...(pages as unknown as DocNode[])], rootIds: [] });
  deps.nodes = [];
  return { pages, nodes, folders, slugs, deps, lang: siteLangOf(doc) };
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
export function applyPagePayload(d: SiteDoc, p: PagePayload): number {
  const assetMap = mergeClipDeps(d, p.deps);
  const pageMap = new Map<string, string>();
  for (const page of p.pages) pageMap.set(page.id, genId("page"));
  const bySlug = new Map(Object.values(d.pages).map((x) => [x.slug, x.id]));
  const toPage = (id: string) => {
    const copied = pageMap.get(id);
    if (copied) return copied;
    const slug = p.slugs[id];
    return (slug !== undefined && bySlug.get(slug)) || id;
  };

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
    const key = siteKey(DOC_STORAGE_KEY, target.id);
    let doc: SiteDoc | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) doc = JSON.parse(raw) as SiteDoc;
    } catch {
      doc = null;
    }
    if (!doc?.pages || !doc.pageOrder?.length) {
      doc = createInitialDoc();
      doc.siteName = target.name;
    }
    applyPagePayload(doc, payload);
    try {
      window.localStorage.setItem(key, JSON.stringify(doc));
    } catch {
      throw new Error(tr("ブラウザの保存領域が足りないため、コピーできませんでした"));
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
