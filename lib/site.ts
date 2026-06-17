"use client";

/**
 * ブラウザ側のサイトの扱い: いま開いているサイト（/sites/<id>）、サイトごとのブラウザ保存のキー、
 * D1 が無いときにブラウザ内へ保存するサイトの一覧
 */

import {
  DEFAULT_BRANCH,
  DEFAULT_PREVIEW_BRANCH,
  isSiteId,
  type SiteDest,
  type SiteRecord,
} from "./sites";
import { storageKey } from "./storage-keys";

/** 編集データのブラウザ保存（サイトごとに siteKey で分ける） */
export const DOC_STORAGE_KEY = storageKey("doc-v1");

/** いま開いているサイトのID（エディタの URL /sites/<id> から。エディタの外では空） */
export function currentSiteId(): string {
  if (typeof window === "undefined") return "";
  const m = /^\/sites\/([^/]+)/.exec(window.location.pathname);
  const id = m ? decodeURIComponent(m[1]) : "";
  return isSiteId(id) ? id : "";
}

/** サイトを編集する画面のURL（/sites/<id>） */
export function sitePath(id: string): string {
  return `/sites/${encodeURIComponent(id)}`;
}

/** サイトごとのブラウザ保存のキー */
export function siteKey(key: string, id: string = currentSiteId()): string {
  return `${key}:${id}`;
}

/** サイトごとに分けて保存しているキー（サイトを消すときに一緒に消す） */
export const SITE_SCOPED_KEYS = [
  DOC_STORAGE_KEY,
  storageKey("published-v1"),
  storageKey("published-hash-v1"),
  storageKey("active-page-v1"),
  storageKey("ui-v1"),
  storageKey("unsynced-v1"),
  storageKey("comments-v1"),
];

/** API の URL に、いま開いているサイトを付ける */
export function siteApi(path: string, params: Record<string, string | number> = {}): string {
  const q = new URLSearchParams({ site: currentSiteId() });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  // D1 が無いときは、ブラウザ内に保存した公開先を一緒に送る（D1 があればサーバーは使わない）
  if (path.startsWith("/api/publish")) {
    const dest = localDest();
    if (dest) q.set("dest", JSON.stringify(dest));
  }
  return `${path}${path.includes("?") ? "&" : "?"}${q}`;
}

/** 公開の POST に付ける、サイトと（D1 が無いときの）公開先 */
export function sitePublishFields(): { site: string; dest?: SiteDest } {
  const dest = localDest();
  return { site: currentSiteId(), ...(dest ? { dest } : {}) };
}

/** このブラウザに保存している、ほかのサイトの編集データ（JSON の文字列のまま） */
export function otherLocalDocs(): string[] {
  const own = siteKey(DOC_STORAGE_KEY);
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || key === own) continue;
      if (!key.startsWith(`${DOC_STORAGE_KEY}:`)) continue;
      const raw = window.localStorage.getItem(key);
      if (raw) out.push(raw);
    }
  } catch {
    // 読めなければ、ほかのサイトは無いものとして扱う
  }
  return out;
}

/* ---------- D1 が無いときの、ブラウザ内のサイト一覧 ---------- */

const LOCAL_SITES_KEY = storageKey("sites-v1");

export function loadLocalSites(): SiteRecord[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(LOCAL_SITES_KEY) ?? "[]") as SiteRecord[];
    return Array.isArray(list) ? list.filter((s) => s && isSiteId(s.id)) : [];
  } catch {
    return [];
  }
}

export function saveLocalSites(list: SiteRecord[]): void {
  try {
    window.localStorage.setItem(LOCAL_SITES_KEY, JSON.stringify(list));
  } catch {
    // 保存できなくても一覧の表示は続ける
  }
}

/** いま開いているサイトの最終編集時刻を、ブラウザ内のサイト一覧に記録する */
export function touchLocalSite(at = Date.now()): void {
  const id = currentSiteId();
  const list = loadLocalSites();
  if (!list.some((s) => s.id === id)) return;
  saveLocalSites(list.map((s) => (s.id === id ? { ...s, updatedAt: at, savedAt: at } : s)));
}

/** ブラウザ内に保存した、いま開いているサイトの公開先（無ければ null） */
function localDest(): SiteDest | null {
  if (typeof window === "undefined") return null;
  const site = loadLocalSites().find((s) => s.id === currentSiteId());
  if (!site) return null;
  const { repo, branch, previewBranch, siteUrl, previewUrl } = site;
  return { repo, branch, previewBranch, siteUrl, previewUrl };
}

/** 新しいサイトの公開先の既定値 */
export function emptyDest(): SiteDest {
  return {
    repo: null,
    branch: DEFAULT_BRANCH,
    previewBranch: DEFAULT_PREVIEW_BRANCH,
    siteUrl: null,
    previewUrl: null,
  };
}
