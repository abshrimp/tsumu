import { DOC_STORAGE_KEY, emptyDest, loadLocalSites, saveLocalSites, siteKey } from "./site";
import { newSiteId, type SiteRecord } from "./sites";
import { IMPORT_LIMITS, parseSiteImport, restoreImportAssets } from "./site-import";
import { storageKey } from "./storage-keys";

export type SaveMode = "server" | "local";
export const importWarningsKey = (id: string) => storageKey("import-warnings-v1") + ":" + id;

export function importFileKind(file: Pick<File, "name">): "zip" | "doc" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".json")) return "doc";
  throw new Error("ZIPまたはdoc.jsonファイルを選択してください。");
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
export async function createSiteFromFile(
  file: File,
  mode: SaveMode,
  progress: (message: string) => void = () => {},
): Promise<{ id: string; warnings: string[] }> {
  const kind = importFileKind(file);
  const limit = kind === "zip" ? IMPORT_LIMITS.zipBytes : IMPORT_LIMITS.docBytes;
  if (!file.size) throw new Error("ファイルが空です。");
  if (file.size > limit) throw new Error("インポートするファイルが大きすぎます。");
  progress("編集データを読み込み中…");
  const source = new Uint8Array(await file.arrayBuffer());
  progress("編集データを確認しています…");
  const parsed = await parseSiteImport(source, kind);
  progress("画像などのアセットを復元しています…");
  const { doc, warnings, createdPaths } = await restoreImportAssets(parsed, progress);
  progress("新規サイトを保存しています…");
  const raw = JSON.stringify(doc);
  let id: string;
  try {
    id = mode === "server"
      ? await serverWrite(raw, doc.siteName)
      : localWrite(raw, doc.siteName);
  } catch (error) {
    // The site has not been committed; remove any asset uploads created by this
    // failed attempt. The storage service verifies cross-site references.
    const cleanupId = newSiteId();
    await Promise.allSettled(createdPaths.map((path) =>
      fetch("/api/assets?site=" + encodeURIComponent(cleanupId) +
        "&path=" + encodeURIComponent(path), { method: "DELETE" })
    ));
    throw error;
  }
  try {
    window.sessionStorage.setItem(importWarningsKey(id), JSON.stringify(warnings));
  } catch {
    // The completed import is still usable without a session warning.
    if (warnings.length) console.warn("Import warnings:", warnings);
  }
  return { id, warnings };
}
