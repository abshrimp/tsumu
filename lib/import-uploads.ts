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
      await Promise.allSettled([...new Set(paths)].map(path => fetch(
        "/api/assets?site=" + encodeURIComponent(site) + "&path=" + encodeURIComponent(path),
        { method: "DELETE" },
      )));
    }
    throw error;
  }
}
