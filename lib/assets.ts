"use client";

import type { Asset } from "./types";
import { genId } from "./presets";
import { tr } from "./i18n";
import { otherLocalDocs, siteApi } from "./site";

const MAX_LOCAL_ASSET_BYTES = 2 * 1024 * 1024;

/** アセット一覧からキャンバスへドラッグするときのMIMEタイプ。 */
export const ASSET_DRAG_TYPE = "application/x-tsumu-asset";

function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(tr("画像を読み込めませんでした")));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(tr("ファイルを読み込めませんでした")));
    reader.readAsDataURL(file);
  });
}

/**
 * 画像・動画・音声をアップロードして Asset を返す。
 * サーバー保存（Workers KV）が使えればpath参照、使えなければ dataURL で保持する。
 */
export async function uploadAsset(file: File): Promise<Asset> {
  if (!/^(image|video|audio)\//.test(file.type)) {
    throw new Error(tr("追加できるのは画像・動画・音声のファイルだけです"));
  }
  return uploadStaticAsset(file);
}

/** HTML ZIP内のCSS・JS・フォント等を含む静的ファイルをアップロードする。 */
export async function uploadStaticAsset(file: File): Promise<Asset> {
  let size: { width: number; height: number; svgFilter?: boolean } = {
    width: 0,
    height: 0,
  };
  if (file.type.startsWith("image/")) {
    const objectUrl = URL.createObjectURL(file);
    try {
      size = await measure(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  if (file.type === "image/svg+xml") {
    const svg = await file.text();
    size.svgFilter = hasSvgFilter(svg);
    // width・height の無いSVGは 0 と測れることがあるので、viewBox から実寸を取る
    if (!size.width || !size.height) size = { ...size, ...(svgViewBoxSize(svg) ?? {}) };
  }

  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/assets", { method: "POST", body: form });
    if (res.ok) {
      const data = await res.json();
      return {
        id: genId("asset"),
        // 表示名は元のファイル名のまま（日本語も可）。保存先のパスと書き出しのファイル名は別に安全な名前にする
        name: displayName(file.name),
        ...(data.path ? { path: data.path } : {}),
        bytes: file.size,
        mimeType: file.type,
        ...size,
      };
    }
    // 503 = サーバー保存未設定 → dataURLへフォールバック。それ以外はエラー表示
    if (res.status !== 503) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? tr("アップロードできませんでした（{status}）", { status: res.status }));
    }
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    // ネットワークエラーもフォールバック
  }

  if (file.size > MAX_LOCAL_ASSET_BYTES) {
    throw new Error(
      tr("サーバーに保存できないため追加できません。このブラウザに保存できるのは1ファイル2MBまでです。")
    );
  }
  const dataUrl = await readAsDataUrl(file);
  return {
    id: genId("asset"),
    name: displayName(file.name),
    dataUrl,
    bytes: file.size,
    mimeType: file.type,
    ...size,
  };
}

/** アセットの表示名（前後の空白と、パス区切り・制御文字だけを取り除く） */
function displayName(name: string): string {
  return name.replace(/[\\/\u0000-\u001f]/g, "").trim() || "image";
}

export function assetKind(asset: Asset): "image" | "video" | "audio" {
  if (asset.mimeType?.startsWith("video/")) return "video";
  if (asset.mimeType?.startsWith("audio/")) return "audio";
  if (/\.(mp4|webm|mov|m4v)$/i.test(asset.name)) return "video";
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(asset.name)) return "audio";
  return "image";
}

function hasSvgFilter(svg: string): boolean {
  return /<filter[\s>]/i.test(svg);
}

/** ルートの <svg> の viewBox の幅・高さ（無い・不正なら null） */
function svgViewBoxSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const box = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(root)?.[1];
  const [, , width, height] = (box ?? "").trim().split(/[\s,]+/).map(Number);
  return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
}

/**
 * <filter>（シャドウ等）の有無が未判定か、実寸が 0 のSVGアセットを調べる。
 * 戻り値は判定できたアセットIDと結果（実寸は viewBox から取れたときだけ）。iOS Safariのぼやけ対策の対象判定に使う
 */
export async function detectSvgFilters(
  assets: Record<string, Asset>
): Promise<Record<string, Pick<Asset, "svgFilter"> & Partial<Pick<Asset, "width" | "height">>>> {
  const pending = Object.values(assets).filter(
    (a) =>
      (a.mimeType === "image/svg+xml" || (!a.mimeType && /\.svg$/i.test(a.name))) &&
      (a.svgFilter === undefined || (a.svgFilter && (!a.width || !a.height)))
  );
  const result: Record<string, Pick<Asset, "svgFilter"> & Partial<Pick<Asset, "width" | "height">>> = {};
  // 一度に取りに行くとサーバーが 503 を返すため、同時に取得する数を絞る
  await mapLimit(pending, ASSET_FETCH_CONCURRENCY, async (asset) => {
    try {
      const res = await fetchWithRetry(assetSrc(asset));
      if (!res.ok) return;
      const svg = await res.text();
      const size = !asset.width || !asset.height ? svgViewBoxSize(svg) : null;
      result[asset.id] = { svgFilter: hasSvgFilter(svg), ...(size ?? {}) };
    } catch {
      // 取得できなければ未判定のまま（次回また調べる）
    }
  });
  return result;
}

/** アセットを同時に取得する数（多すぎるとサーバーが 503・接続エラーを返す） */
export const ASSET_FETCH_CONCURRENCY = 6;

/** items を最大 limit 件ずつ並行して処理する（どれかが失敗したらその例外を投げる） */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * 一時的な失敗（接続エラー・429・5xx）は少し待って取り直す。
 * 404 などはそのまま返す（呼び出し側で扱う）
 */
export async function fetchWithRetry(url: string, tries = 3): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if ((res.status === 429 || res.status >= 500) && i < tries) {
        await new Promise((r) => setTimeout(r, 500 * i));
        continue;
      }
      return res;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

/** アセットの表示用URL */
export function assetSrc(asset: Asset): string {
  if (asset.path) return `/api/assets/file?path=${encodeURIComponent(asset.path)}`;
  return asset.dataUrl ?? "";
}

const ASSET_URL_RE = /\/api\/assets\/file\?path=([A-Za-z0-9%._~-]+)/g;

/**
 * HTMLの中のアセットのURLを、期限付きの署名URLにする（HTMLページのプレビュー用）。
 * プレビューはエディタの権限を使えない別オリジンで表示するため、ログインの Cookie が送られない
 */
export async function withSignedAssetUrls(html: string): Promise<string> {
  const paths = new Set<string>();
  for (const m of html.matchAll(ASSET_URL_RE)) {
    try {
      paths.add(decodeURIComponent(m[1]));
    } catch {
      // 壊れたURLはそのまま
    }
  }
  if (!paths.size) return html;
  const res = await fetch("/api/assets/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: [...paths] }),
  });
  if (!res.ok) return html;
  const { urls } = (await res.json()) as { urls: Record<string, string> };
  return html.replace(ASSET_URL_RE, (m, enc: string) => {
    try {
      return urls[decodeURIComponent(enc)] ?? m;
    } catch {
      return m;
    }
  });
}

/** アセットを元のファイル名でダウンロードする */
export async function downloadAsset(asset: Asset): Promise<void> {
  const src = assetSrc(asset);
  if (!src) return;
  try {
    const blob = await (await fetch(src)).blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = asset.name;
      a.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch {
    // CORS等で取得できない場合は新しいタブで開く
    window.open(src, "_blank", "noopener");
  }
}

/**
 * サーバー上のアセットを削除（dataURL資産は何もしない）。
 * ほかのサイトが同じファイルを使っていれば消さない（サーバーでも D1 の全サイトを見て確かめる）
 */
export async function deleteAssetRemote(asset: Asset): Promise<void> {
  if (!asset.path) return;
  const quoted = `"${asset.path}"`;
  if (otherLocalDocs().some((raw) => raw.includes(quoted))) return;
  await fetch(siteApi("/api/assets", { path: asset.path }), {
    method: "DELETE",
  }).catch(() => {
    // 削除失敗はドキュメント側から消えれば実害がないため無視
  });
}
