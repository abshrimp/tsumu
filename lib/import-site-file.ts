import { tr } from "./i18n";
import { emptyDest, localSiteIdInUse, loadLocalSites, saveLocalSites, withLocalSiteListLock } from "./site";
import { createBrowserDoc, deleteBrowserDoc } from "./browser-doc-storage";
import { newSiteId, type SiteRecord } from "./sites";
import { isEditorDocument, parseEditableZip, parseSiteImport, restoreImportAssets } from "./site-import";
import { IMPORT_LIMITS, validateImportedDoc } from "./site-import-format";
import { convertHtmlFile, convertHtmlZipSite, isHtmlFile } from "./html-file-import";
import { openImportZip } from "./zip-directory";
import type { SiteDoc } from "./types";
import { storageKey } from "./storage-keys";

type SaveMode = "server" | "local";
const importWarningsKey = (id: string) => storageKey("import-warnings-v1") + ":" + id;

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

/** Create a real site before uploading assets, so each upload can be authorized. */
async function reserveServerSite(): Promise<string> {
  const id = newSiteId();
  const response = await fetch("/api/sites", {
    method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: tr("Importing site"), importId: id }),
  }).catch(() => null);
  if (response?.ok) {
    const data = await response.json().catch(() => null);
    if (data?.site?.id === id) return id;
  } else if (response && [400, 401, 403, 404, 409, 413, 415].includes(response.status)) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? tr("Could not create the site."));
  }
  // The POST may have committed before its response was lost.
  const confirm = await fetch("/api/sites/" + encodeURIComponent(id), { credentials: "same-origin", redirect: "error" }).catch(() => null);
  if (confirm?.ok && (await confirm.json().catch(() => null))?.site?.id === id) return id;
  throw new Error(tr("Could not confirm the save. Check the site list on the home screen."));
}

async function finishServerImport(siteId: string, doc: SiteDoc): Promise<void> {
  const saved = await fetch("/api/doc?site=" + encodeURIComponent(siteId), {
    method: "PUT", credentials: "same-origin", redirect: "error",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc),
  });
  if (!saved.ok) {
    const result = await saved.json().catch(() => null);
    throw new Error(result?.error ?? tr("Could not save the site in this browser. Check available storage and browser settings."));
  }
  const updated = await fetch("/api/sites/" + encodeURIComponent(siteId), {
    method: "PATCH", credentials: "same-origin", redirect: "error",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: doc.siteName }),
  });
  if (!updated.ok) {
    const result = await updated.json().catch(() => null);
    throw new Error(result?.error ?? tr("Couldn't save"));
  }
}

/** Import an archive into a browser-only or authenticated server-backed site. */
export async function createSiteFromFile(
  file: File,
  mode: SaveMode,
  progress: (message: string) => void = () => {},
  onMissingEditData: () => Promise<void> = async () => {},
): Promise<{ id: string; warnings: string[] }> {
  const paths: string[] = [];
  let reservedId: string | null = null;
  let writingDocument = false;
  try {
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
      if (mode === "server") reservedId = await reserveServerSite();
      const converted = zip
        ? await convertHtmlZipSite(zip, progress, paths, reservedId ?? undefined)
        : await convertHtmlFile(file, { progress }, paths, reservedId ?? undefined);
      doc = validateImportedDoc(converted.doc);
      warnings = converted.warnings;
    } else {
      progress(tr("Validating edit data…"));
      const parsed = zip ? await parseEditableZip(zip) : await parseSiteImport(new Uint8Array(await file.arrayBuffer()), "doc");
      if (mode === "server") reservedId = await reserveServerSite();
      progress(tr("Restoring images and other assets…"));
      const restored = await restoreImportAssets(parsed, progress, paths, reservedId ?? undefined);
      doc = restored.doc;
      warnings = restored.warnings;
    }
    progress(tr("Saving the new site…"));
    const raw = JSON.stringify(doc);
    if (raw.length > IMPORT_LIMITS.docBytes || new TextEncoder().encode(raw).length > IMPORT_LIMITS.docBytes) {
      throw new Error(tr("The edit data exceeds the size limit."));
    }
    if (reservedId) {
      // A failed or ambiguous document write must never delete a possibly committed site.
      writingDocument = true;
      await finishServerImport(reservedId, doc);
    }
    const id = reservedId ?? await localWrite(raw, doc.siteName);
    try {
      window.sessionStorage.setItem(importWarningsKey(id), JSON.stringify(warnings));
    } catch {
      // 完了した取り込みは、セッションの警告が無くても使える。
      if (warnings.length) console.warn("Import warnings:", warnings);
    }
    return { id, warnings };
  } catch (error) {
    // Before the document write, this is only an empty site with transient assets.
    // The normal asset GC can reclaim uploads after this site is removed.
    if (reservedId && !writingDocument) {
      await fetch("/api/sites/" + encodeURIComponent(reservedId), {
        method: "DELETE", credentials: "same-origin", redirect: "error",
      }).catch(() => {});
    }
    throw error;
  }
}
