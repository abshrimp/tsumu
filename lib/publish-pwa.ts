import type { SiteDoc } from "./types";
import type { ExportFormat } from "./export-formats";

/** 既存の登録を終了し、Tsumu のキャッシュだけを消す。 */
export const PWA_RETIREMENT_WORKER = `self.addEventListener("install", function (e) {
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
  // 単一 HTML は PWA を出力しない。ほかの形式は各フレームワークの公開場所に合わせる。
  const swPath = format === "html" || format === "single-html" ? "sw.js"
    : format === "sveltekit" ? "static/sw.js" : "public/sw.js";
  if ((doc.pwa?.enabled && format !== "single-html") ||
      !["public/sw.js", "static/sw.js", "sw.js"].some(path => Object.hasOwn(generated ?? {}, path))) return;
  files[swPath] = PWA_RETIREMENT_WORKER;
  outputPaths.push(swPath);
}


/**
 * 復元先の出力構成から /sw.js の配信場所を選ぶ。既存の Worker や手動ファイルは上書きしない。
 * ロールバックは古い PWA 設定値でなく、実際に戻すファイルの有無で判断する。
 */
export async function rollbackPwaRetirement(
  generated: Record<string, string> | null,
  sourcePaths: string[],
  finalPaths: string[],
  sourceGenerated: Record<string, string> | null,
): Promise<{ path: string; content: string; sha: string } | null> {
  if (!["public/sw.js", "static/sw.js", "sw.js"].some(path => Object.hasOwn(generated ?? {}, path))) return null;
  const source = new Set(sourcePaths);
  // 所有情報がある版では、手動の設定ファイルから出力形式を推測しない。
  const layoutPaths = sourceGenerated ? sourcePaths.filter(path => Object.hasOwn(sourceGenerated, path)) : sourcePaths;
  const layout = new Set(layoutPaths);
  const frameworkConfig = /^(?:next|nuxt|vite)\.config\.(?:js|mjs|cjs|ts|mts)$/;
  const path = layout.has("src/app.html") ? "static/sw.js"
    : layoutPaths.some(path => frameworkConfig.test(path)) ? "public/sw.js"
    : layout.has("index.html") || (!layout.has("package.json") && layoutPaths.some(path => /\.html?$/.test(path))) ? "sw.js"
    : null;
  // 判別できない古い構成や、手動で削除・置換された Worker には所有権を追加しない。
  if (!path || source.has(path) || finalPaths.includes(path)) return null;
  const content = PWA_RETIREMENT_WORKER;
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const object = new Uint8Array(header.length + bytes.length);
  object.set(header); object.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", object);
  const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { path, content, sha };
}
