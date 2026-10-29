import type { Db } from "./db";
import { documentAssetReferences } from "./site-document-service";

/** Asset paths are immutable but shared between sites. Access must be proved by
 * either a pending upload in the requested site or a saved document reference. */
export async function siteHasAsset(db: Db, siteId: string, path: string): Promise<boolean> {
  if (!path.startsWith("assets/")) return false;
  const pending = await db.execute({
    sql: "SELECT 1 FROM site_asset_uploads WHERE site_id=? AND path=? LIMIT 1",
    args: [siteId, path],
  });
  if (pending.rows.length) return true;
  const refs = await documentAssetReferences(db, siteId);
  return refs.some(ref => ref.path === path);
}
