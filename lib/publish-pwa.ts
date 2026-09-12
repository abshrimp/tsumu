import type { SiteDoc } from "./types";
import type { ExportFormat } from "./export-formats";

/**
 * 公開先で管理していた Service Worker だけを、終了用のものに置き換える。
 * sw.js を削除するだけでは、更新に失敗したブラウザに古い Worker が残る。
 * 一覧にも残しておくことで、後日の訪問者や、繰り返しオフにして公開した場合にも、同じ終了処理を配信する。
 * ZIP での書き出しには公開先の所有の情報が無いため、この処理は行わない。
 */
export function addPwaRetirementWorker(
  doc: Pick<SiteDoc, "pwa">,
  generated: Record<string, string> | null,
  files: Record<string, string>,
  outputPaths: string[],
  format: ExportFormat = "nextjs",
): void {
  // 単一の HTML は PWA を出力しない。他の形式は、各フレームワークの公開場所に合わせる。
  const swPath = format === "html" || format === "single-html" ? "sw.js"
    : format === "sveltekit" ? "static/sw.js" : "public/sw.js";
  if ((doc.pwa?.enabled && format !== "single-html") ||
      !["public/sw.js", "static/sw.js", "sw.js"].some(path => Object.hasOwn(generated ?? {}, path))) return;
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
