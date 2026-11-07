import type { Asset, SiteDoc } from "./types";
import { ASSET_FETCH_CONCURRENCY, assetSrc, fetchWithRetry, mapLimit, readAssetBytes } from "./assets";
import { buildAssetNames } from "./generator/names";
import { EDITABLE_ASSETS_PATH, EDITABLE_DOC_PATH, type ArchiveAssetMap } from "./site-import";
import { IMPORT_LIMITS } from "./site-import-format";
import { zipStylesheet } from "./zip-css";
import { tr } from "./i18n";

/** A complete editor backup, independent of the original server's asset storage. */
export async function createSiteBackup(doc: SiteDoc): Promise<Blob> {
  const documentBytes = new TextEncoder().encode(JSON.stringify(doc));
  if (documentBytes.byteLength > IMPORT_LIMITS.docBytes) {
    throw new Error(tr("The edit data exceeds the size limit."));
  }
  const names = buildAssetNames(doc);
  const manifest: ArchiveAssetMap = { version: 1, assets: {} };
  for (const [id, name] of names) manifest.assets[id] = "public/assets/" + name;
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const { ZipBuilder } = await import("./zip");
  const zip = new ZipBuilder();
  zip.file(EDITABLE_DOC_PATH, documentBytes);
  zip.file(EDITABLE_ASSETS_PATH, manifestBytes);

  let expanded = documentBytes.byteLength + manifestBytes.byteLength;
  if (expanded > IMPORT_LIMITS.expandedBytes || names.size + 2 > IMPORT_LIMITS.entries) {
    throw new Error(tr("The backup is too large to restore."));
  }
  const abort = new AbortController();
  try {
    await mapLimit([...names], ASSET_FETCH_CONCURRENCY, async ([id]) => {
      const asset: Asset = doc.assets[id];
      const url = assetSrc(asset);
      let bytes: Uint8Array;
      if (url) {
        const response = await fetchWithRetry(url, 3, {
          credentials: "same-origin", redirect: "error", signal: abort.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new Error(response.status === 404
            ? tr("Could not retrieve the asset: {name}", { name: asset.name })
            : tr("Couldn't load asset ({status}): {path}", { status: response.status, path: asset.name }));
        }
        bytes = await readAssetBytes(response, IMPORT_LIMITS.assetBytes,
          tr("The asset is too large to import: {name}", { name: asset.name }));
      } else {
        // ZIP-imported stylesheets can still have their original source without a stored file.
        const stylesheet = zipStylesheet(asset);
        if (!stylesheet) throw new Error(tr("Could not retrieve the asset: {name}", { name: asset.name }));
        bytes = new TextEncoder().encode(stylesheet.source);
        if (bytes.byteLength > IMPORT_LIMITS.assetBytes) {
          throw new Error(tr("The asset is too large to import: {name}", { name: asset.name }));
        }
      }
      expanded += bytes.byteLength;
      if (expanded > IMPORT_LIMITS.expandedBytes) throw new Error(tr("The backup is too large to restore."));
      zip.file(manifest.assets[id], bytes);
    });
  } catch (error) {
    abort.abort(error);
    throw error;
  }

  const blob = await zip.toBlob({ compression: "DEFLATE" });
  if (blob.size > IMPORT_LIMITS.zipBytes) throw new Error(tr("The backup is too large to restore."));
  return blob;
}
