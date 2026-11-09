"use client";

import { createBrowserDoc, deleteBrowserDoc } from "./browser-doc-storage";
import { emptyDest, loadLocalSites, localSiteIdInUse, saveLocalSites, withLocalSiteListLock } from "./site";
import { newSiteId, normalizeSiteInput, type SiteInput, type SiteRecord } from "./site-model";
import { tr } from "./i18n";

/**
 * Write a browser document before publishing its metadata in localStorage.
 * If metadata cannot be committed, removes only the newly created document.
 */
export async function commitLocalBrowserSite(
  site: SiteRecord,
  rawDoc: string,
  createSaveError: () => Error,
): Promise<SiteRecord> {
  let created = false;
  try {
    created = await createBrowserDoc(site.id, rawDoc);
    if (!created) throw createSaveError();
    await withLocalSiteListLock(() => {
      const sites = loadLocalSites({ strict: true });
      if (localSiteIdInUse(site.id, sites) || !saveLocalSites([site, ...sites])) throw createSaveError();
    });
  } catch (error) {
    if (created) await deleteBrowserDoc(site.id).catch(() => {});
    throw error;
  }
  return site;
}

/** Shared by the home screen and an explicitly authorized external editor. */
export async function createLocalBrowserSite(input: SiteInput): Promise<SiteRecord> {
  const validated = normalizeSiteInput(input, { name: "", ...emptyDest() });
  if (!validated.ok) throw new Error(tr(validated.error));
  const name = validated.value.name;
  const id = newSiteId();
  const now = Date.now();
  const site: SiteRecord = { ...validated.value, id, createdAt: now, updatedAt: now };
  const { createInitialDoc } = await import("./presets");
  const doc = createInitialDoc();
  doc.siteName = name;
  return commitLocalBrowserSite(
    site,
    JSON.stringify(doc),
    () => new Error(tr("Could not save changes in this browser. Check your browser's storage space and settings, then try again.")),
  );
}
