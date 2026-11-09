import { ASSET_FETCH_CONCURRENCY, mapLimit } from "./assets";
import { newSiteId } from "./sites";

/** Only the outermost import owns rollback. Record paths returned by new uploads. */
export async function withImportUploads<T>(
  run: (paths: string[]) => Promise<T>, existing?: string[],
): Promise<T> {
  if (existing) return run(existing);
  const paths: string[] = [];
  try {
    return await run(paths);
  } catch (error) {
    if (paths.length) {
      // The destination may not exist yet. Check every saved site's references.
      const site = newSiteId();
      await mapLimit([...new Set(paths)], ASSET_FETCH_CONCURRENCY, async path => {
        await fetch("/api/assets?site=" + encodeURIComponent(site) + "&path=" + encodeURIComponent(path),
          { method: "DELETE", credentials: "same-origin", redirect: "error" }).catch(() => {});
      });
    }
    throw error;
  }
}
