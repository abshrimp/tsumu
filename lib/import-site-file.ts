import { withImportUploads } from "./import-uploads";
import { emptyDest, localSiteIdInUse, loadLocalSites, saveLocalSites, withLocalSiteListLock } from "./site";
import { createBrowserDoc, deleteBrowserDoc } from "./browser-doc-storage";
import { newSiteId, type SiteRecord } from "./sites";
import { IMPORT_LIMITS, parseSiteImport, restoreImportAssets, validateImportedDoc } from "./site-import";
import { convertHtmlFile, isEditableSiteZip, isHtmlFile } from "./html-file-import";
import type { SiteDoc } from "./types";
import { storageKey } from "./storage-keys";

export type SaveMode = "server" | "local";
export const importWarningsKey = (id: string) => storageKey("import-warnings-v1") + ":" + id;

export function importFileKind(file: Pick<File, "name">): "zip" | "doc" | "html" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".json")) return "doc";
  if (isHtmlFile(name)) return "html";
  throw new Error("ZIP・doc.json・HTMLファイルを選択してください。");
}

async function localWrite(doc: string, name: string): Promise<string> {
  const id = newSiteId();
  const now = Date.now();
  const site: SiteRecord = { ...emptyDest(), id, name, createdAt: now, updatedAt: now };
  let created = false;
  try {
    created = await createBrowserDoc(id, doc);
    if (!created) throw new Error("Document already exists");
    await withLocalSiteListLock(() => {
      const list = loadLocalSites({ strict: true });
      if (localSiteIdInUse(id, list) || !saveLocalSites([site, ...list])) throw new Error("Site list write failed");
    });
    return id;
  } catch {
    if (created) await deleteBrowserDoc(id).catch(() => {});
    throw new Error("ブラウザにサイトを保存できませんでした。空き容量と保存設定を確認してください。");
  }
}

async function serverWrite(doc: SiteDoc, raw: string, uploads: string[]): Promise<string> {
  const id = newSiteId();
  // The ID is known even if the response is lost. The server exclusively inserts
  // the site and revision 1 in the same transaction.
  const response = await fetch("/api/sites", {
    method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: doc.siteName, importId: id, initialDoc: doc }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null);
  if (response?.ok && data?.site?.id === id) return id;
  if (response && response.status >= 400 && response.status < 500) {
    throw new Error(data?.error || "サイトを作成できませんでした。");
  }
  const saved = await fetch("/api/doc?site=" + id, { credentials: "same-origin", redirect: "error" }).then(res => res.ok ? res.json() : null).catch(() => null);
  if (saved?.exists && JSON.stringify(saved.doc) === raw) return id;
  // A transport or proxy failure does not prove the transaction rolled back.
  // Do not delete uploaded bytes which the in-flight or already edited site may use.
  uploads.length = 0;
  throw new Error("保存結果を確認できませんでした。ホームのサイト一覧を確認してください。");
}

/** Prepare everything before creating the site, then commit its document. */
export async function createSiteFromFile(
  file: File,
  mode: SaveMode,
  progress: (message: string) => void = () => {},
): Promise<{ id: string; warnings: string[] }> {
  return withImportUploads(async paths => {
    const kind = importFileKind(file);
    const limit = kind === "zip" ? IMPORT_LIMITS.zipBytes : IMPORT_LIMITS.docBytes;
    if (!file.size) throw new Error("ファイルが空です。");
    if (file.size > limit) throw new Error("インポートするファイルが大きすぎます。");
    progress("編集データを読み込み中…");
    let doc: SiteDoc;
    let warnings: string[];
    const source = kind === "html" ? null : new Uint8Array(await file.arrayBuffer());
    const html = kind === "html" || (kind === "zip" && source && !(await isEditableSiteZip(source)));
    if (html) {
      const converted = await convertHtmlFile(file, { progress, allPages: true }, paths);
      doc = validateImportedDoc(converted.doc);
      warnings = converted.warnings;
    } else {
      progress("編集データを確認しています…");
      const parsed = await parseSiteImport(source!, kind as "zip" | "doc");
      progress("画像などのアセットを復元しています…");
      const restored = await restoreImportAssets(parsed, progress, paths);
      doc = restored.doc;
      warnings = restored.warnings;
    }
    progress("新規サイトを保存しています…");
    const raw = JSON.stringify(doc);
    if (raw.length > IMPORT_LIMITS.docBytes || new TextEncoder().encode(raw).length > IMPORT_LIMITS.docBytes) {
      throw new Error("編集データが容量上限を超えています。");
    }
    const id = mode === "server"
      ? await serverWrite(doc, raw, paths)
      : await localWrite(raw, doc.siteName);
    try {
      window.sessionStorage.setItem(importWarningsKey(id), JSON.stringify(warnings));
    } catch {
      // The completed import is still usable without a session warning.
      if (warnings.length) console.warn("Import warnings:", warnings);
    }
    return { id, warnings };
  });
}
