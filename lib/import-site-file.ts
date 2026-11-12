import { tr } from "./i18n";
import { createDocPatch } from "./doc-patch";
import { withImportUploads } from "./import-uploads";
import { emptyDest, localSiteIdInUse, loadLocalSites, saveLocalSites, withLocalSiteListLock } from "./site";
import { createBrowserDoc, deleteBrowserDoc } from "./browser-doc-storage";
import { newSiteId, type SiteRecord } from "./sites";
import { IMPORT_LIMITS, isEditorDocument, parseEditableZip, parseSiteImport, restoreImportAssets, validateImportedDoc } from "./site-import";
import { convertHtmlFile, convertHtmlZipSite, isHtmlFile } from "./html-file-import";
import { openImportZip } from "./zip-directory";
import type { SiteDoc } from "./types";
import { storageKey } from "./storage-keys";

export type SaveMode = "server" | "local";
export const importWarningsKey = (id: string) => storageKey("import-warnings-v1") + ":" + id;

export function importFileKind(file: Pick<File, "name">): "zip" | "doc" | "html" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".json")) return "doc";
  if (isHtmlFile(name)) return "html";
  throw new Error(tr("Choose a ZIP, doc.json, or HTML file."));
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
    throw new Error(tr("Could not save the site in this browser. Check available storage and browser settings."));
  }
}

async function serverWrite(doc: SiteDoc, uploads: string[]): Promise<string> {
  const id = newSiteId();
  // 応答が失われても、指定した ID で初版の保存を確認できる。
  const response = await fetch("/api/sites", {
    method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: doc.siteName, importId: id, initialDoc: doc }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null);
  if (response?.ok && data?.site?.id === id) return id;
  // API の明示的な拒否ならアップロードを取り消せる。プロキシの 408 などは保存後にも届き得る。
  if (response && [400, 401, 403, 404, 409, 413, 415].includes(response.status) && typeof data?.error === "string") {
    throw new Error(data.error || tr("Could not create the site."));
  }
  // 確認中に処理が失敗しても、サーバーで確定済みかもしれないアセットを削除しない。
  uploads.length = 0;
  const saved = await fetch("/api/doc?site=" + id, { credentials: "same-origin", redirect: "error" }).then(res => res.ok ? res.json() : null).catch(() => null);
  // DocumentRoom は保存した行から文書を組み直すため、設定や ID の並びは変わり得る。
  if (saved?.exists && saved.doc && createDocPatch(doc, saved.doc)?.length === 0) return id;
  throw new Error(tr("Could not confirm the save. Check the site list on the home screen."));
}

/** サイトを作る前にすべてを準備し、それから文書を確定する。 */
export async function createSiteFromFile(
  file: File,
  mode: SaveMode,
  progress: (message: string) => void = () => {},
  onMissingEditData: () => Promise<void> = async () => {},
): Promise<{ id: string; warnings: string[] }> {
  return withImportUploads(async paths => {
    const kind = importFileKind(file);
    const limit = kind === "zip" ? IMPORT_LIMITS.zipBytes : IMPORT_LIMITS.docBytes;
    if (!file.size) throw new Error(tr("The file is empty."));
    if (file.size > limit) throw new Error(tr("The import file is too large."));
    progress(tr("Reading edit data…"));
    let doc: SiteDoc;
    let warnings: string[];
    const zip = kind === "zip" ? await openImportZip(file, IMPORT_LIMITS.entries) : undefined;
    if (kind === "html" || (zip && !Object.values(zip.files).some(isEditorDocument))) {
      if (zip) await onMissingEditData();
      const converted = zip
        ? await convertHtmlZipSite(zip, progress, paths)
        : await convertHtmlFile(file, { progress }, paths);
      doc = validateImportedDoc(converted.doc);
      warnings = converted.warnings;
    } else {
      progress(tr("Validating edit data…"));
      const parsed = zip ? await parseEditableZip(zip) : await parseSiteImport(new Uint8Array(await file.arrayBuffer()), "doc");
      progress(tr("Restoring images and other assets…"));
      const restored = await restoreImportAssets(parsed, progress, paths);
      doc = restored.doc;
      warnings = restored.warnings;
    }
    progress(tr("Saving the new site…"));
    const raw = JSON.stringify(doc);
    if (raw.length > IMPORT_LIMITS.docBytes || new TextEncoder().encode(raw).length > IMPORT_LIMITS.docBytes) {
      throw new Error(tr("The edit data exceeds the size limit."));
    }
    const id = mode === "server"
      ? await serverWrite(doc, paths)
      : await localWrite(raw, doc.siteName);
    try {
      window.sessionStorage.setItem(importWarningsKey(id), JSON.stringify(warnings));
    } catch {
      // 完了した取り込みは、セッションの警告が無くても使える。
      if (warnings.length) console.warn("Import warnings:", warnings);
    }
    return { id, warnings };
  });
}
