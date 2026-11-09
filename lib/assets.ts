"use client";

import { isEmbeddedAssetUrl } from "./site-import-format";
import { CSS_ASSET_ATTRIBUTES, replaceCssAssetUrls, rewriteCssAssetUrls } from "./css-assets";
import { zipAssetClosure, zipCssPreviewUrls, zipStylesheet, ZIP_CSS_LIMITS } from "./zip-css";
import { appendAssetSuffix } from "./zip-references";
import type { Asset, SiteDoc } from "./types";
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
    const res = await fetch("/api/assets", { method: "POST", body: form, credentials: "same-origin", redirect: "error" });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.path !== "string" || !data.path.startsWith("assets/") || data.path.length === "assets/".length) {
        throw new Error(tr("アップロード結果を確認できませんでした。"));
      }
      return {
        id: genId("asset"),
        // 表示名は元のファイル名のまま（日本語も可）。保存先のパスと書き出しのファイル名は別に安全な名前にする
        name: displayName(file.name),
        path: data.path,
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
      const src = assetSrc(asset);
      if (!src) return;
      const res = await fetchWithRetry(src);
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

/** Consume only bounded bytes, including responses with no length or a misleading one. */
export async function readAssetBytes(response: Response, limit: number, message = "Resource exceeds export size limit."): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new Error(message);
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(part.value);
    }
  } finally { reader?.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/**
 * 一時的な失敗（接続エラー・429・5xx）は少し待って取り直す。
 * 404 などはそのまま返す（呼び出し側で扱う）
 */
export async function fetchWithRetry(url: string, tries = 3, init?: RequestInit): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && i < tries) {
        await res.body?.cancel().catch(() => {});
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

export { isEmbeddedAssetUrl } from "./site-import-format";

/** アセットの表示用URL */
export function assetSrc(asset: Asset): string {
  if (asset.path) return `/api/assets/file?path=${encodeURIComponent(asset.path)}`;
  return isEmbeddedAssetUrl(asset.dataUrl) ? asset.dataUrl : "";
}

/**
 * 画像・動画の要素に持たせる src。ブラウザ内に埋め込んだアセット（dataURL）は要素へ複製せず空にし、
 * 表示するときに assetId から引く（複製すると、使う要素の数だけ編集データが大きくなる）
 */
export function nodeAssetSrc(asset: Asset): string {
  return asset.path ? assetSrc(asset) : "";
}

/** 画像・動画の要素の表示用URL（アセットを使っていれば、アセットから引く） */
export function mediaSrc(doc: SiteDoc, ref: { src: string; assetId?: string }): string {
  const asset = ref.assetId ? doc.assets[ref.assetId] : undefined;
  return asset ? (assetSrc(asset) || ref.src) : ref.src;
}

/**
 * 埋め込みアセットを、サーバーに保存したファイルへ置き換える（doc を書き換える）。
 * 要素の src と、背景画像などスタイルの値に入っている dataURL も差し替える
 */
export function replaceEmbeddedAsset(doc: SiteDoc, assetId: string, path: string): void {
  const asset = doc.assets[assetId];
  if (!asset) return;
  const data = asset.dataUrl;
  asset.path = path;
  delete asset.dataUrl;
  const src = assetSrc(asset);
  const sources = new Map(data ? [[data, src]] : []);
  for (const node of Object.values(doc.nodes)) {
    if (node.image?.assetId === assetId) node.image.src = src;
    if (node.media?.assetId === assetId) node.media.src = src;
    if (!data) continue;
    for (const bp of Object.values(node.styles)) {
      for (const styles of Object.values(bp ?? {})) {
        if (!styles) continue;
        for (const [prop, value] of Object.entries(styles)) {
          if (typeof value === "string") styles[prop] = replaceCssAssetUrls(value, sources);
        }
      }
    }
  }
  if (!data) return;
  // 背景パネルが保存する形式だけを扱い、カスタムCSSの値は書き換えない。
  for (const page of Object.values(doc.pages)) {
    for (const bp of Object.values(page.bodyStyles ?? {})) {
      for (const styles of Object.values(bp ?? {})) {
        if (styles?.backgroundImage === `url("${data}")`) {
          styles.backgroundImage = `url("${src}")`;
        }
      }
    }
  }
}

/** 埋め込みアセットをサーバーへアップロードする（サーバーに保存できなければ null） */
export async function uploadEmbeddedAsset(asset: Asset): Promise<string | null> {
  if (!isEmbeddedAssetUrl(asset.dataUrl)) return asset.path ?? null;
  const blob = await (await fetch(asset.dataUrl)).blob();
  const fresh = await uploadStaticAsset(new File([blob], asset.name, { type: blob.type || asset.mimeType || "" }));
  return fresh.path ?? null;
}

const ASSET_URL_RE = /(?<![\w/:%~.-])(?:([Hh][Tt][Tt][Pp][Ss]?:\/\/[^/\s"'<>]+|\/\/[^/\s"'<>]+))?\/api\/assets\/file\?path=([A-Za-z0-9%._~-]+)/g;

/**
 * HTMLの中のアセットのURLを、期限付きの署名URLにする（HTMLページのプレビュー用）。
 * プレビューはエディタの権限を使えない別オリジンで表示するため、ログインの Cookie が送られない
 */
const ZIP_CSS_URL_RE = /tsumu-zip-css:([A-Za-z0-9%._~-]+)/g;

export function zipPreviewRoots(html: string, assets: Record<string, Asset>): string[] {
  return [...new Set([...html.matchAll(ZIP_CSS_URL_RE)].map((m) => {
    try { return decodeURIComponent(m[1]); } catch { return ""; }
  }))];
}

export async function withSignedAssetUrls(
  html: string, assets: Record<string, Asset> = {}, options: { signal?: AbortSignal; baseUrl?: string; onExpiresAt?: (time: number) => void } = {}
): Promise<string> {
  options.signal?.throwIfAborted();
  const roots = zipPreviewRoots(html, assets);
  const base = options.baseUrl ?? (typeof window !== "undefined" ? window.location.href : undefined);
  const sameOrigin = (prefix: string | undefined) => {
    if (!prefix) return true;
    try { return !!base && new URL(prefix, base).origin === new URL(base).origin; }
    catch { return false; }
  };
  if (roots.some((id) => !zipStylesheet(assets[id]))) throw new Error(tr("ZIPのCSSデータを読み込めません。ZIPを再読み込みしてください。"));
  if (roots.length && html.length > ZIP_CSS_LIMITS.output) throw new Error(tr("ZIPのCSSプレビューが大きすぎます。CSSの依存関係を減らしてZIPを再読み込みしてください。"));
  const reachable = zipAssetClosure(assets, roots);
  const paths = new Set<string>();
  for (const m of html.matchAll(ASSET_URL_RE)) {
    if (!sameOrigin(m[1])) continue;
    try { paths.add(decodeURIComponent(m[2])); } catch { /* Ignore malformed percent encoding. */ }
  }
  for (const id of reachable) if (assets[id].path) paths.add(assets[id].path!);
  const signed: Record<string, string> = {};
  const list = [...paths];
  // The endpoint accepts at most 500 paths. Each distinct path is signed exactly once.
  for (let i = 0; i < list.length; i += 500) {
    options.signal?.throwIfAborted();
    const res = await fetch("/api/assets/sign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: list.slice(i, i + 500) }), signal: options.signal,
    });
    if (!res.ok) {
      if (roots.length) throw new Error(tr("HTMLプレビューのアセットを読み込めませんでした"));
      return html;
    }
    const { urls } = (await res.json()) as { urls: Record<string, string> };
    Object.assign(signed, urls);
  }
  options.signal?.throwIfAborted();
  let expiresAt = Infinity;
  const absolute = (url: string) => {
    const parsed = new URL(url, base);
    const exp = Number(parsed.searchParams.get("exp"));
    if (exp > 0 && Number.isFinite(exp) && parsed.searchParams.has("sig")) expiresAt = Math.min(expiresAt, exp);
    return parsed.href;
  };
  const cssUrls = zipCssPreviewUrls(assets, roots, (asset) => {
    if (!asset.path) return assetSrc(asset);
    const url = signed[asset.path];
    if (!url) throw new Error(tr("HTMLプレビューのアセットを読み込めませんでした"));
    return absolute(url);
  }, { baseUrl: base });
  let output = html.replace(ASSET_URL_RE, (m, prefix: string | undefined, enc: string) => {
    if (!sameOrigin(prefix)) return m;
    try {
      const url = signed[decodeURIComponent(enc)];
      return url ? (base ? absolute(url) : url) : m;
    } catch { return m; }
  });
  if (!roots.length) return output;
  const resolve = (url: string): string | undefined => {
    const match = /^tsumu-zip-css:([^?#]+)([?#][\s\S]*)?$/.exec(url);
    if (match) {
      const target = cssUrls.get(decodeURIComponent(match[1]));
      if (!target) throw new Error(tr("HTMLプレビューのアセットを読み込めませんでした"));
      return appendAssetSuffix(target, match[2] ?? "");
    }
    for (const asset of Object.values(assets)) {
      if (!asset.zip || !asset.dataUrl || !url.startsWith(asset.dataUrl)) continue;
      const suffix = url.slice(asset.dataUrl.length);
      if (/^[?#]/.test(suffix)) return appendAssetSuffix(asset.dataUrl, suffix);
    }
    return undefined;
  };
  const parsed = new DOMParser().parseFromString(output, "text/html");
  let inserted = 0;
  const bounded = (url: string) => {
    const target = resolve(url);
    inserted += target?.length ?? 0;
    if (inserted > ZIP_CSS_LIMITS.output) throw new Error(tr("ZIPのCSSプレビューが大きすぎます。CSSの依存関係を減らしてZIPを再読み込みしてください。"));
    return target;
  };
  for (const el of Array.from(parsed.querySelectorAll("[href],[src],[poster]"))) {
    for (const attr of ["href", "src", "poster"]) {
      const value = el.getAttribute(attr);
      const target = value ? bounded(value) : undefined;
      if (target !== undefined) {
        el.setAttribute(attr, target);
        if (attr === "href" && el.tagName.toLowerCase() === "link" && value?.startsWith("tsumu-zip-css:")) el.removeAttribute("integrity");
      }
    }
  }
  for (const attr of CSS_ASSET_ATTRIBUTES) {
    for (const el of Array.from(parsed.querySelectorAll(`[${attr}]`))) {
      el.setAttribute(attr, rewriteCssAssetUrls(el.getAttribute(attr) ?? "", bounded, ZIP_CSS_LIMITS.output));
    }
  }
  for (const el of Array.from(parsed.querySelectorAll("style"))) {
    el.textContent = rewriteCssAssetUrls(el.textContent ?? "", bounded, ZIP_CSS_LIMITS.output);
  }
  output = `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`;
  if (output.length > ZIP_CSS_LIMITS.output) throw new Error(tr("ZIPのCSSプレビューが大きすぎます。CSSの依存関係を減らしてZIPを再読み込みしてください。"));
  if (Number.isFinite(expiresAt)) options.onExpiresAt?.(expiresAt);
  return output;
}

/** アセットを元のファイル名でダウンロードする */
export async function downloadAsset(asset: Asset): Promise<void> {
  const src = assetSrc(asset);
  if (!src) return;
  let response: Response;
  try {
    response = await fetch(src);
  } catch {
    // CORS等でレスポンスを取得できない場合だけ、新しいタブで開く。
    window.open(src, "_blank", "noopener");
    return;
  }
  // エラー本文を元のファイルとして保存したり、失敗を別タブで隠したりしない。
  if (!response.ok) throw new Error(tr("アセットをダウンロードできませんでした"));
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = asset.name;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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

/**
 * アセット削除時に、背景パネルが設定したページ背景を外す（doc を書き換える）。
 * URL の部分一致で、別のファイルや手書きの複合背景まで削除しない。
 */
export function removePageAssetBackgrounds(doc: SiteDoc, asset: Asset): void {
  const src = assetSrc(asset);
  if (!src) return;
  const backgroundImage = `url("${src}")`;
  for (const page of Object.values(doc.pages)) {
    for (const bp of Object.values(page.bodyStyles ?? {})) {
      for (const styles of Object.values(bp ?? {})) {
        if (styles?.backgroundImage === backgroundImage) delete styles.backgroundImage;
      }
    }
  }
}
