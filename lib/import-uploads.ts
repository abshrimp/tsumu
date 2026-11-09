import { ASSET_FETCH_CONCURRENCY, mapLimit } from "./assets";
import { siteApi } from "./site";

/** 取り消しを受け持つのは、最も外側の取り込みだけ。新しいアップロードで返されたパスを記録する。 */
export async function withImportUploads<T>(
  run: (paths: string[]) => Promise<T>, existing?: string[], siteId?: string,
): Promise<T> {
  if (existing) return run(existing);
  const paths: string[] = [];
  try {
    return await run(paths);
  } catch (error) {
    if (paths.length) {
      await mapLimit([...new Set(paths)], ASSET_FETCH_CONCURRENCY, async path => {
        const url = siteId
          ? "/api/assets?site=" + encodeURIComponent(siteId) + "&path=" + encodeURIComponent(path)
          : siteApi("/api/assets", { path });
        await fetch(url, { method: "DELETE", credentials: "same-origin", redirect: "error" }).catch(() => {});
      });
    }
    throw error;
  }
}
