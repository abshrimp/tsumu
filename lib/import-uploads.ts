import { ASSET_FETCH_CONCURRENCY, mapLimit } from "./assets";
import { newSiteId } from "./sites";

/** 取り消しを受け持つのは、最も外側の取り込みだけ。新しいアップロードで返されたパスを記録する。 */
export async function withImportUploads<T>(
  run: (paths: string[]) => Promise<T>, existing?: string[],
): Promise<T> {
  if (existing) return run(existing);
  const paths: string[] = [];
  try {
    return await run(paths);
  } catch (error) {
    if (paths.length) {
      // 取り込み先はまだ存在しないことがある。保存済みのすべてのサイトの参照を確かめる。
      const site = newSiteId();
      await mapLimit([...new Set(paths)], ASSET_FETCH_CONCURRENCY, async path => {
        await fetch("/api/assets?site=" + encodeURIComponent(site) + "&path=" + encodeURIComponent(path),
          { method: "DELETE", credentials: "same-origin", redirect: "error" }).catch(() => {});
      });
    }
    throw error;
  }
}
