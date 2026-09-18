"use client";

/**
 * ページを他のサイトへコピーする。
 * ページと中の要素を、使っているアセット・コンポーネント・フォントと一緒にまとめ、
 * コピー先のサイトの編集データ（サーバー / このブラウザの保存）に書き足す
 */

import type { BreakpointDef, DocNode, NodeStyles, Page, ScriptStep, SiteDoc } from "./types";
import { buildClipPayload, mergeClipDeps, remapAssetIds, type ClipPayload } from "./clip-transfer";
import { createInitialDoc, genId } from "./presets";
import { cloneSteps, scriptUid } from "./script";
import { createPageNaming } from "./page-naming";
import { isLocalSiteDeleted, loadLocalSites } from "./site";
import { validSiteDoc } from "./doc-tree";
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
  /** ページが入っていたフォルダの名前（ページ ID → 名前） */
  folders: Record<string, string>;
  /** コピー元のすべてのページの URL（ページ ID → slug。コピーしなかったページへのリンクを付け替えるため） */
  slugs: Record<string, string>;
  /** 同じ slug のページを区別するクエリ */
  queries: Record<string, string>;
  deps: ClipPayload;
  /** コピー元のサイトの言語（ページで言語を選んでいなければ、この言語で書かれている） */
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
  const selected = new Set(pageIds);
  const ids = doc.pageOrder.filter((id) => selected.has(id));
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
  // ページの設定（OGP 画像・背景・ページのスクリプト）で使うアセットも拾うため、ページごと渡す
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
 * まとめたページを、コピー先の文書に追加する（d を直接書き換える）。
 * ページと要素には新しい ID を振り、名前や URL が重なれば「のコピー」を付ける。
 * ページへのリンクは、一緒にコピーしたページ → コピー先の同じ URL のページ の順に付け替える。
 * 戻り値は、追加したページの数
 */
/** アセットやコンポーネントを取り込む前に検証する。コピー先のブレークポイントは決して変えない。 */
function prepareResponsivePayload(d: SiteDoc, payload: PagePayload): PagePayload {
  // ページのコピーは、完全で現在の形の情報がある場合だけ受け付ける。
  // mergeClipDeps がコピー先を書き換える前に、不正な取り込みを拒否する。
  if (!payload || !payload.slugs || !payload.queries ||
      typeof payload.slugs !== "object" || Array.isArray(payload.slugs) ||
      typeof payload.queries !== "object" || Array.isArray(payload.queries)) {
    throw new Error("Invalid page copy metadata");
  }
  const fail = (): never => {
    throw new Error(tr("The source and destination screen-width settings differ or contain unknown references. Nothing was copied, to keep the appearance intact. Match the screen-width settings and try again."));
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
  // 外から来たマスターが、コピー先のコンポーネントと同じ ID を持つことがある。
  // コピー元のマスターはすべて新しい ID で取り込めるため、そのスタイルを正規化する。
  for (const node of [...p.nodes, ...p.deps.componentNodes]) {
    node.styles = styles(node.styles)!;
    if (node.hiddenOn) node.hiddenOn = node.hiddenOn.map(id);
  }
  return p;
}

export function applyPagePayload(d: SiteDoc, p: PagePayload): number {
  p = prepareResponsivePayload(d, p);
  const { assetIds: assetMap, componentIds: componentMap, componentNodes } =
    mergeClipDeps(d, p.deps, {
      preserveSourceOnCollision: true,
      htmlZipAssetIds: new Set(p.pages.flatMap(page => page.htmlZip?.assetIds ?? [])),
    });
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

  // 新しく取り込んだマスターの中のリンクも付け替える。既存のマスターは変えない。
  for (const n of componentNodes) {
    if (n.link?.kind === "page" && n.link.pageId) n.link.pageId = toPage(n.link.pageId);
    for (const s of n.scripts ?? []) mapSteps(s.steps, toPage);
  }

  // ページのスクリプトの画面は、スクリプトとその入れ子のブロックを ID で扱う。
  // 同じページを2回コピーしても、編集や選択の対象があいまいにならないようにする。
  const cloneScripts = <T extends { id: string; steps: ScriptStep[] }>(scripts: T[] | undefined): T[] | undefined =>
    scripts?.map((s) => ({ ...s, id: scriptUid(), steps: cloneSteps(s.steps) }));
  const nodeMap = new Map<string, string>();
  for (const n of p.nodes) nodeMap.set(n.id, genId("node"));
  for (const raw of p.nodes) {
    const n = remapAssetIds(structuredClone(raw), assetMap);
    n.id = nodeMap.get(raw.id)!;
    n.children = n.children.map((c) => nodeMap.get(c)).filter((c): c is string => !!c);
    if (n.scripts) n.scripts = cloneScripts(n.scripts);
    if (n.type === "instance" && n.componentId) {
      n.componentId = componentMap.get(n.componentId) ?? n.componentId;
    }
    if (n.link?.kind === "page" && n.link.pageId) n.link.pageId = toPage(n.link.pageId);
    for (const s of n.scripts ?? []) mapSteps(s.steps, toPage);
    d.nodes[n.id] = n;
  }

  const naming = createPageNaming(d.pages);
  for (const raw of p.pages) {
    const page = remapAssetIds(structuredClone(raw), assetMap);
    if (page.htmlZip) page.htmlZip.assetIds = page.htmlZip.assetIds.map(id => assetMap.get(id) ?? id);
    const id = pageMap.get(raw.id)!;
    const { name, slug } = naming.copy(raw, "transfer");
    page.id = id;
    if (page.scripts) page.scripts = cloneScripts(page.scripts);
    if (page.pageScripts) page.pageScripts = cloneScripts(page.pageScripts);
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
    throw new Error(data?.error ?? tr("Request failed ({status})", { status: res.status }));
  }
  return data ?? {};
}

async function destinationSnapshot(res: Response): Promise<{ doc: SiteDoc; rev: string } | null> {
  const data = await readJson(res);
  if (res.ok && data.exists === false) return null;
  if ((res.status === 409 ? data.conflict === true : data.exists === true) &&
      typeof data.rev === "string" && /^[1-9]\d*$/.test(data.rev) && validSiteDoc(data.doc)) {
    return { doc: data.doc, rev: data.rev };
  }
  throw new Error(tr("Could not read the destination site’s document. Check the destination site and try again."));
}

/**
 * ページを他のサイトへコピーする。
 * server = サーバーに保存しているサイト（他の人が編集中でも、版を確かめて書き足す）、
 * local = このブラウザに保存しているサイト
 */
export async function copyPagesToSite(
  target: { id: string; name: string },
  payload: PagePayload,
  store: "server" | "local"
): Promise<void> {
  if (!payload.pages.length) throw new Error(tr("Page not found"));
  if (store === "local") {
    let doc: SiteDoc;
    let expected: string | null;
    try {
      // コピーのダイアログを開いている間に、コピー先の一覧が古くなることがある。
      // 別のタブで明示的に削除したサイトの内容を、決して作り直さない。
      if (isLocalSiteDeleted(target.id) ||
          !loadLocalSites({ strict: true }).some(site => site.id === target.id)) {
        throw new Error("Local destination missing");
      }
      const raw = await readBrowserDoc(target.id);
      // ブラウザ内のサイトは、作成したときに文書が入る。文書が無かったり壊れていたりしても、
      // 気づかないうちに空のサイトに置き換えてはいけない。
      if (raw === null) throw new Error("Local destination document missing");
      const parsed: unknown = JSON.parse(raw);
      if (!validSiteDoc(parsed)) throw new Error("Invalid destination document");
      expected = raw;
      doc = parsed as SiteDoc;
    } catch {
      throw new Error(tr("Could not read the destination site’s document. Check the destination site and try again."));
    }
    applyPagePayload(doc, payload);
    if (!validSiteDoc(doc)) {
      throw new Error(tr("Could not read the destination site’s document. Check the destination site and try again."));
    }
    try {
      if (isLocalSiteDeleted(target.id)) throw new Error("Local destination deleted");
      const result = await writeBrowserDoc(target.id, JSON.stringify(doc), expected);
      if (result !== "saved" || isLocalSiteDeleted(target.id)) throw new Error("Destination changed");
    } catch {
      throw new Error(tr("Could not copy because the document could not be saved in this browser"));
    }
    return;
  }

  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ site: target.id, ...extra }).toString();
  const loadDestination = async () => destinationSnapshot(await fetch(`/api/doc?${q()}`));
  let snapshot = await loadDestination();
  // 他の人が同時に保存したときは、新しい版に書き足し直す。
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = snapshot?.doc ?? createInitialDoc();
    if (!snapshot) doc.siteName = target.name;
    const start = doc.pageOrder.length;
    applyPagePayload(doc, payload);
    let res: Response | undefined;
    try {
      res = await fetch(`/api/doc?${q(snapshot ? { base: snapshot.rev } : {})}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      if (res.status === 409) {
        snapshot = await destinationSnapshot(res);
        continue;
      }
      if ((await readJson(res)).ok !== true) throw new Error(tr("Couldn't copy"));
      return;
    } catch (error) {
      // 保存後に応答だけが失われることがある。再送する前に、この操作で追加したページを確かめる。
      if (!res || res.ok || res.status >= 500) {
        const saved = await loadDestination().catch(() => null);
        if (saved && doc.pageOrder.slice(start).every(id => Object.hasOwn(saved.doc.pages, id))) return;
      }
      throw error;
    }
  }
  throw new Error(tr("Couldn't copy because someone else saved at the same time. Try again."));
}
