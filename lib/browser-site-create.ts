"use client";

import { createBrowserDoc, deleteBrowserDoc } from "./browser-doc-storage";
import { createInitialDoc } from "./presets";
import { emptyDest, loadLocalSites, localSiteIdInUse, saveLocalSites, withLocalSiteListLock } from "./site";
import { newSiteId, normalizeSiteInput, type SiteInput, type SiteRecord } from "./site-model";
import { tr } from "./i18n";

/** Shared by the home screen and an explicitly authorized external editor.
 * Creates the browser document before publishing its metadata in localStorage.
 * If metadata cannot be committed, removes only the newly created document.
 */
export async function createLocalBrowserSite(input: SiteInput): Promise<SiteRecord> {
  const validated = normalizeSiteInput(input, { name: "", ...emptyDest() });
  if (!validated.ok) throw new Error(tr(validated.error));
  const name = validated.value.name;
  const id = newSiteId();
  const now = Date.now();
  const site: SiteRecord = { ...validated.value, id, createdAt: now, updatedAt: now };
  const doc = createInitialDoc();
  doc.siteName = name;
  const saveError = () => new Error(tr("Could not save changes in this browser. Check your browser's storage space and settings, then try again."));
  let created = false;
  try {
    created = await createBrowserDoc(id, JSON.stringify(doc));
    if (!created) throw saveError();
    await withLocalSiteListLock(() => {
      const sites = loadLocalSites({ strict: true });
      if (localSiteIdInUse(id, sites) || !saveLocalSites([site, ...sites])) throw saveError();
    });
  } catch (error) {
    if (created) await deleteBrowserDoc(id).catch(() => {});
    throw error;
  }
  return site;
}
