import JSZip from "jszip";
import type { SiteDoc } from "./types";
import { generateProject } from "./generator";
import { buildAssetNames } from "./generator/names";
import { EDITABLE_DOC_PATH, EDITABLE_ASSETS_PATH, type ArchiveAssetMap } from "./site-import";
import { ASSET_FETCH_CONCURRENCY, fetchWithRetry, mapLimit } from "./assets";
import { tr } from "./i18n";

/** zip を作ってダウンロードさせる。保存先に見つからず同梱できなかったアセットのパスを返す */
export async function exportProjectZip(doc: SiteDoc): Promise<string[]> {
  const { files, binaries, remoteAssets } = generateProject(doc);
  const zip = new JSZip();
  const dirName =
    doc.siteName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-site";
  const root = zip.folder(dirName)!;
  // Editable source and original asset IDs are stored separately from generated
  // website code. Importing this archive never needs to parse rendered HTML.
  root.file(EDITABLE_DOC_PATH, JSON.stringify(doc));
  const names = buildAssetNames(doc);
  const assetMap: ArchiveAssetMap = { version: 1, assets: {} };
  for (const [id, name] of names) assetMap.assets[id] = "public/assets/" + name;
  root.file(EDITABLE_ASSETS_PATH, JSON.stringify(assetMap));

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

  // ZIP-level DEFLATE keeps _tsumu/doc.json readable and avoids double compression.
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${dirName}.zip`;
  a.click();
  // すぐに破棄すると、Safari などでダウンロードが始まらないことがある
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return missing.sort();
}
