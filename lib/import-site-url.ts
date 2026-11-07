import { DOC_STORAGE_KEY, emptyDest, loadLocalSites, saveLocalSites, siteKey } from "./site";
import { newSiteId, type SiteRecord } from "./sites";
import { parseSiteImport, restoreImportAssets } from "./site-import";
import { storageKey } from "./storage-keys";

export type ImportRequest = { mode: "zip" | "doc"; url: string };
export type SaveMode = "server" | "local";
export const importWarningsKey = (id: string) => storageKey("import-warnings-v1") + ":" + id;

export function requestedSiteImport(params: URLSearchParams): ImportRequest | null {
  const zip = params.get("zip");
  const doc = params.get("doc");
  if (!zip && !doc) return null;
  if (zip && doc) throw new Error("ZIPとdoc.jsonのURLは同時に指定できません。");
  const raw = zip || doc!;
  if (raw.length > 2048) throw new Error("URLが長すぎます。");
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error("取得するファイルのURLが正しくありません。"); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("HTTP(S)の公開URLを指定してください。");
  }
  return { mode: zip ? "zip" : "doc", url: parsed.href };
}

async function fetchImportedFile(url: string, kind: "zip" | "doc" | "asset"): Promise<Uint8Array> {
  const response = await fetch("/api/import-source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, kind }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || "外部URLから取得できませんでした。");
  }
  return new Uint8Array(await response.arrayBuffer());
}

function localWrite(doc: string, name: string): string {
  const id = newSiteId();
  const now = Date.now();
  const site: SiteRecord = {
    ...emptyDest(), id, name, createdAt: now, updatedAt: now,
  };
  // Read the current site list before making any writes. A failed list save
  // must not leave behind a partial document or an inaccessible site.
  const list = loadLocalSites({ strict: true });
  const docKey = siteKey(DOC_STORAGE_KEY, id);
  let wroteDoc = false;
  try {
    window.localStorage.setItem(docKey, doc);
    wroteDoc = true;
    if (!saveLocalSites([site, ...list])) throw new Error("サイト一覧を保存できませんでした。");
  } catch {
    if (wroteDoc) {
      try { window.localStorage.removeItem(docKey); } catch {}
    }
    throw new Error("ブラウザにサイトを保存できませんでした。空き容量と保存設定を確認してください。");
  }
  return id;
}

async function serverWrite(doc: string, name: string): Promise<string> {
  const response = await fetch("/api/sites", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => null) as
    { site?: { id: string }; error?: string } | null;
  if (!response.ok || !data?.site?.id) {
    throw new Error(data?.error || "サイトを作成できませんでした。");
  }
  const id = data.site.id;
  try {
    const result = await fetch("/api/doc?site=" + encodeURIComponent(id), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: doc,
    });
    if (!result.ok) {
      const error = await result.json().catch(() => null) as { error?: string } | null;
      throw new Error(error?.error || "編集データを保存できませんでした。");
    }
  } catch (error) {
    // Avoid leaving a site with an empty default document after a failed save.
    await fetch("/api/sites/" + encodeURIComponent(id), { method: "DELETE" }).catch(() => {});
    throw error;
  }
  return id;
}

/** Prepare everything before creating the site, then commit its document. */
export async function createSiteFromUrl(
  request: ImportRequest,
  mode: SaveMode,
  progress: (message: string) => void = () => {},
): Promise<{ id: string; warnings: string[] }> {
  progress("インポート元のファイルを取得しています…");
  const source = await fetchImportedFile(request.url, request.mode);
  progress("編集データを確認しています…");
  const parsed = await parseSiteImport(source, request.mode, request.url);
  progress("画像などのアセットを復元しています…");
  const { doc, warnings } = await restoreImportAssets(parsed,
    (url) => fetchImportedFile(url, "asset"), progress);
  progress("新規サイトを保存しています…");
  const raw = JSON.stringify(doc);
  const id = mode === "server"
    ? await serverWrite(raw, doc.siteName)
    : localWrite(raw, doc.siteName);
  try {
    window.sessionStorage.setItem(importWarningsKey(id), JSON.stringify(warnings));
  } catch {
    // The completed import is still usable without a session warning.
    if (warnings.length) console.warn("Import warnings:", warnings);
  }
  return { id, warnings };
}
