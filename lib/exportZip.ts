import JSZip from "jszip";
import type { SiteDoc } from "./types";
import { exportScopeDoc, prepareExportProject, type ExportFormat, type ExportOptions } from "./export-formats";
import { ASSET_FETCH_CONCURRENCY, fetchWithRetry, mapLimit } from "./assets";
import { tr } from "./i18n";
import { buildAssetNames } from "./generator/names";
import { EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH, type ArchiveAssetMap } from "./site-import";

/** zip を作ってダウンロードさせる。保存先に見つからず同梱できなかったアセットのパスを返す */
export async function exportProjectZip(doc: SiteDoc, request: ExportFormat | ExportOptions = "nextjs"): Promise<string[]> {
  const options: ExportOptions = typeof request === "string"
    ? { framework: request, language: "typescript", style: "css", scope: "project" }
    : request;
  const project = await prepareExportProject(doc, options);
  const { files, binaries, remoteAssets } = project;
  const dirName =
    doc.siteName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-site";
  if (options.framework === "single-html") {
    const html = files["index.html"];
    if (!html || Object.keys(files).length !== 1 || Object.keys(binaries).length ||
        Object.keys(remoteAssets).length) {
      throw new Error("Single HTML generation did not produce exactly one HTML file.");
    }
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = dirName + ".html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return [];
  }

  const zip = new JSZip();
  const root = zip.folder(dirName)!;
  const editableDoc = exportScopeDoc(doc, options);
  // Preserve the full editable document and its original asset IDs separately
  // from the generated framework code, for ZIP URL round-tripping.
  root.file(EDITABLE_DOC_PATH, JSON.stringify(editableDoc));
  const archiveAssets: ArchiveAssetMap = { version: 1, assets: {} };
  const assetNames = buildAssetNames(editableDoc);
  const assetRoot = options.framework === "html" ? "assets/" :
    options.framework === "sveltekit" ? "static/assets/" : "public/assets/";
  for (const [id, name] of assetNames) {
    archiveAssets.assets[id] = assetRoot + name;
  }
  root.file(EDITABLE_ASSETS_PATH, JSON.stringify(archiveAssets));

  for (const [path, content] of Object.entries(files)) {
    root.file(path, content);
  }
  for (const [path, base64] of Object.entries(binaries)) {
    root.file(path, base64, { base64: true });
  }
  // サーバー上のアセットを取得して同梱（KVはAPIプロキシ経由）。
  // 一度に取りに行くとサーバーが 503 を返すため、同時に取得する数を絞り、一時的な失敗は取り直す
  const missing: string[] = [];
  await mapLimit(Object.entries(remoteAssets), ASSET_FETCH_CONCURRENCY, async ([path, source]) => {
    const url = `/api/assets/file?path=${encodeURIComponent(source)}`;
    const res = await fetchWithRetry(url);
    // 保存先に無いアセット（削除済みなど）は、公開と同じく飛ばして続ける
    if (res.status === 404) {
      missing.push(path);
      return;
    }
    if (!res.ok) throw new Error(tr("アセットを読み込めませんでした（{status}）: {path}", { status: res.status, path }));
    root.file(path, await res.arrayBuffer());
  });

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${dirName}-${options.framework}-${options.language}.zip`;
  a.click();
  // すぐに破棄すると、Safari などでダウンロードが始まらないことがある
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return missing.sort();
}
