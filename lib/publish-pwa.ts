import type { SiteDoc } from "./types";
import type { ExportFormat } from "./export-formats";

/**
 * 公開先で管理していた Worker だけを終了用に置き換える。
 * sw.js を削除するだけでは、更新に失敗したブラウザに古い Worker が残る。
 * 一覧にも残すことで、後日の訪問者や繰り返しのオフ公開にも同じ終了処理を配信する。
 * ZIP 書き出しには公開先の所有情報がないため、この処理を行わない。
 */
export function addPwaRetirementWorker(
  doc: Pick<SiteDoc, "pwa">,
  generated: Record<string, string> | null,
  files: Record<string, string>,
  outputPaths: string[],
  format: ExportFormat = "nextjs",
): void {
  const swPath = format === "html" ? "sw.js" : "public/sw.js";
  if (doc.pwa?.enabled ||
      (!Object.hasOwn(generated ?? {}, "public/sw.js") && !Object.hasOwn(generated ?? {}, "sw.js"))) return;
  files[swPath] = `self.addEventListener("install", function (e) {
  e.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.delete("site-pwa-v2").catch(function () {}).then(function () {
      return self.registration.unregister();
    })
  );
});
`;
  outputPaths.push(swPath);
}
