import { extractAssetReferences } from "./asset-gc-plan";
import type { Db } from "./db";
import { documentAssetReferences, readSiteDocument } from "./site-document-service";

/** Asset paths are immutable but shared between sites. Access must be proved by
 * either a pending upload in the requested site or a saved document reference. */
export function siteHasAsset(db: Db, siteId: string, path: string): Promise<boolean> {
  return siteOwnsAssets(db, siteId, [path]);
}

/** Verify that every referenced asset path already belongs to the target site. */
export async function siteOwnsAssets(
  db: Db,
  siteId: string,
  paths: Iterable<string>,
  loadCurrentBody?: () => Promise<string | null>,
): Promise<boolean> {
  const remaining = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith("assets/")) return false;
    remaining.add(path);
  }
  if (!remaining.size) return true;
  const list = [...remaining];
  for (let offset = 0; offset < list.length; offset += 90) {
    const chunk = list.slice(offset, offset + 90);
    const placeholders = chunk.map(() => "?").join(",");
    const uploaded = await db.execute({
      sql: `SELECT path FROM site_asset_uploads WHERE site_id=? AND path IN (${placeholders})`,
      args: [siteId, ...chunk],
    });
    for (const row of uploaded.rows) remaining.delete(String(row.path));
  }
  if (!remaining.size) return true;
  if (!loadCurrentBody) {
    const refs = await documentAssetReferences(db, siteId);
    for (const ref of refs) remaining.delete(ref.path);
    if (!remaining.size) return true;
  }
  const body = await (loadCurrentBody ? loadCurrentBody() : readSiteDocument(db, siteId).then(doc => doc?.body ?? null));
  if (!body) return false;
  const existing = extractAssetReferences(body);
  for (const path of remaining) {
    if (!existing.has(path)) return false;
  }
  return true;
}
