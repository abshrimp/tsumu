import JSZip from "jszip";
import type { Asset, SiteDoc } from "./types";
import { prepareExportScopeDoc, prepareExportProject, type ExportFormat, type ExportOptions } from "./export-formats";
import { ASSET_FETCH_CONCURRENCY, fetchWithRetry, isEmbeddedAssetUrl, mapLimit } from "./assets";
import { tr } from "./i18n";
import { buildAssetNames } from "./generator/names";
import { cssValue } from "./generator/css";
import { assertGeneratedPaths } from "./generator/output-paths";
import { EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH, type ArchiveAssetMap } from "./site-import";
import { zipStylesheet } from "./zip-css";
import { importedAssetPath } from "./generator/imported-assets";

/** A ZIP's top-level folder is also a filesystem path, not just a download label. */
export function exportDirectoryName(siteName: string): string {
  const name = siteName.toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "") || "my-site";
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name) ? "_" + name : name;
}

/** zip を作ってダウンロードさせる。保存先に見つからず同梱できなかったアセットのパスを返す */
export async function exportProjectZip(doc: SiteDoc, request: ExportFormat | ExportOptions = "nextjs"): Promise<string[]> {
  const options: ExportOptions = typeof request === "string"
    ? { framework: request, language: "typescript", style: "css", scope: "project" }
    : request;
  const editableDoc = await prepareExportScopeDoc(doc, options);
  // Imported elements that cannot be represented by visual nodes retain their
  // URLs in custom HTML. Resolve those URLs for the downloadable website while
  // keeping the editable snapshot bound to its original asset IDs/locations.
  const websiteDoc = structuredClone(editableDoc);
  const assetNames = buildAssetNames(editableDoc);
  for (const node of Object.values(websiteDoc.nodes)) {
    if (node.code?.html) node.code.html = cssValue(editableDoc, "rawHtml", node.code.html, assetNames);
  }
  const project = await prepareExportProject(websiteDoc, { ...options, scope: "project" });
  const { files, binaries } = project;
  const remoteAssets = { ...project.remoteAssets };
  const dirName = exportDirectoryName(doc.siteName);
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

  const archiveAssets: ArchiveAssetMap = { version: 1, assets: {} };
  const originalStylesheets = new Map<string, Asset>();
  const assetRoot = options.framework === "html" ? "assets/" :
    options.framework === "sveltekit" ? "static/assets/" : "public/assets/";
  for (const [id, name] of assetNames) {
    const asset = editableDoc.assets[id];
    const stylesheet = zipStylesheet(asset);
    const importedPath = stylesheet && importedAssetPath(asset);
    const alias = importedPath ? assetRoot + importedPath.slice("public/assets/".length) : undefined;
    const existingOriginal = alias && (Object.hasOwn(files, alias) ||
      Object.hasOwn(binaries, alias) || Object.hasOwn(remoteAssets, alias));
    // Website CSS has rewritten URLs. Restoring those bytes under the original
    // ZIP path breaks script-relative CSS imports on the next export.
    // Reuse the original alias already emitted for ZIPs containing JavaScript.
    const path = stylesheet ? existingOriginal ? alias : "_tsumu/assets/" + name : assetRoot + name;
    archiveAssets.assets[id] = path;
    if (stylesheet && !existingOriginal) originalStylesheets.set(path, asset);
  }
  // Reserve editable entries before JSZip creates any directories.
  assertGeneratedPaths(project, [EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH, ...originalStylesheets.keys()]);
  const zip = new JSZip();
  const root = zip.folder(dirName)!;
  root.file(EDITABLE_DOC_PATH, JSON.stringify(editableDoc));
  root.file(EDITABLE_ASSETS_PATH, JSON.stringify(archiveAssets));
  for (const [path, asset] of originalStylesheets) {
    if (asset.path) remoteAssets[path] = asset.path;
    else if (isEmbeddedAssetUrl(asset.dataUrl)) {
      root.file(path, await (await fetch(asset.dataUrl!)).arrayBuffer());
    } else {
      root.file(path, zipStylesheet(asset)!.source);
    }
  }

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
