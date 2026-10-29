"use client";

import { ASSET_FETCH_CONCURRENCY, fetchWithRetry, mapLimit } from "./assets";
import { prepareExportProject } from "./export-formats";
import type { PublishTarget } from "./generator";
import type { SiteDoc } from "./types";
import { currentSiteId } from "./site";
import { tr } from "./i18n";

/**
 * Build only files that a static web server may serve. Unlike the editable export
 * ZIP and GitHub publishing, no _tsumu/doc.json or other editor state is included.
 */
export async function buildStaticPublishZip(doc: SiteDoc, target: PublishTarget): Promise<Blob> {
  const project = await prepareExportProject(doc, {
    framework: "html",
    language: "javascript",
    style: "css",
    scope: "project",
  }, target);
  // Keep the editor's initial JavaScript bundle free of ZIP processing code.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [path, content] of Object.entries(project.files)) zip.file(path, content);
  for (const [path, base64] of Object.entries(project.binaries)) zip.file(path, base64, { base64: true });

  const downloads = new AbortController();
  try {
    await mapLimit(Object.entries(project.remoteAssets), ASSET_FETCH_CONCURRENCY, async ([path, source]) => {
      if (!source.startsWith("assets/")) throw new Error(tr("Asset source not allowed: {source}", { source }));
      const params = new URLSearchParams({ site: currentSiteId(), path: source });
      const response = await fetchWithRetry("/api/assets/file?" + params, 3, { signal: downloads.signal });
      if (!response.ok) throw new Error(tr("Couldn't load asset ({status}): {path}", { status: response.status, path }));
      zip.file(path, await response.arrayBuffer());
    });
  } catch (error) {
    downloads.abort(error);
    throw error;
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
