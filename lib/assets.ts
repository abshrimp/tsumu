"use client";

import { isEmbeddedAssetUrl } from "./site-import-format";
import { svgUsesBlurOrShadow } from "./svg-effects";
import { cachedSvgEffect, cacheSvgEffect, type SvgEffectAnalysis } from "./svg-analysis-cache";
import { CSS_ASSET_ATTRIBUTES, replaceCssAssetUrls, rewriteCssAssetUrls } from "./css-assets";
import { zipAssetClosure, zipCssPreviewUrls, zipStylesheet, ZIP_CSS_LIMITS } from "./zip-css";
import { assetMediaUrl } from "./media-url";
export { assetMediaUrl } from "./media-url";
import { appendAssetSuffix } from "./zip-references";
import type { Asset, SiteDoc } from "./types";
import { genId } from "./presets";
import { tr } from "./i18n";
import { currentSiteId, siteApi } from "./site";
import { otherBrowserDocs } from "./browser-doc-storage";

const MAX_LOCAL_ASSET_BYTES = 2 * 1024 * 1024;

/** アセットの一覧からキャンバスへドラッグするときの MIME タイプ。 */
export const ASSET_DRAG_TYPE = "application/x-tsumu-asset";

function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(tr("Couldn't load the image")));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(tr("Couldn't read the file")));
    reader.readAsDataURL(file);
  });
}

/**
 * 画像・動画・音声をアップロードして Asset を返す。
 * サーバーに保存（Workers KV）できればパスで参照し、できなければ data URL で持つ。
 */
export async function uploadAsset(file: File): Promise<Asset> {
  if (!/^(image|video|audio)\//.test(file.type)) {
    throw new Error(tr("Only image, video and audio files can be added"));
  }
  return uploadStaticAsset(file);
}

/** HTML の ZIP に含まれる CSS・JS・フォントなどの静的なファイルをアップロードする。 */
export async function uploadStaticAsset(file: File): Promise<Asset> {
  let size: { width: number; height: number; svgFilter?: boolean } = {
    width: 0,
    height: 0,
  };
  let svgAnalysis: SvgEffectAnalysis | null = null;
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
    svgAnalysis = { svgFilter: svgUsesBlurOrShadow(svg), ...(svgViewBoxSize(svg) ?? {}) };
    size.svgFilter = svgAnalysis.svgFilter;
    // width・height の無い SVG は大きさが 0 と測られることがあるため、viewBox から実際の大きさを取る
    if (!size.width || !size.height) size = { ...size, width: svgAnalysis.width ?? size.width, height: svgAnalysis.height ?? size.height };
  }

  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/assets", { method: "POST", body: form, credentials: "same-origin", redirect: "error" });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.path !== "string" || !data.path.startsWith("assets/") || data.path.length === "assets/".length) {
        throw new Error(tr("Could not confirm the uploaded file location."));
      }
      if (svgAnalysis) cacheSvgEffect(data.path, svgAnalysis);
      return {
        id: genId("asset"),
        // 表示名は元のファイル名のまま（日本語も使える）。保存先のパスと書き出すファイル名には、別に安全な名前を使う
        name: displayName(file.name),
        path: data.path,
        bytes: file.size,
        mimeType: file.type,
        ...size,
      };
    }
    // 503 = サーバーの保存先が未設定 → data URL で持つ。それ以外はエラーを表示する
    if (res.status !== 503) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? tr("Couldn't upload ({status})", { status: res.status }));
    }
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    // ネットワークのエラーのときも、data URL で持つ
  }

  if (file.size > MAX_LOCAL_ASSET_BYTES) {
    throw new Error(
      tr("This can't be added because server storage isn't available. Files saved in this browser are limited to 2MB each.")
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

/** ルートの <svg> の viewBox の幅と高さ（無いか不正なら null） */
function svgViewBoxSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const box = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(root)?.[1];
  const [, , width, height] = (box ?? "").trim().split(/[\s,]+/).map(Number);
  return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
}

/** SVG画像の実際の内容に基づいて影・ぼかしを判定する。保存先パス単位で結果を再利用する。 */
/** 同じアセットへの並行取得は共有する。 */
const svgAnalysisInFlight = new Map<string, Promise<SvgEffectAnalysis | null>>();

async function analyzeAssetSvg(asset: Asset): Promise<SvgEffectAnalysis | null> {
  const src = assetSrc(asset);
  if (!src) return null;
  const path = asset.path;
  if (path) {
    const cached = await cachedSvgEffect(path);
    if (cached) return cached;
    const ongoing = svgAnalysisInFlight.get(path);
    if (ongoing) return ongoing;
  }
  const pending = (async () => {
    try {
      const res = await fetchWithRetry(src);
      if (!res.ok) return null;
      const svg = await res.text();
      const analysis: SvgEffectAnalysis = { svgFilter: svgUsesBlurOrShadow(svg), ...(svgViewBoxSize(svg) ?? {}) };
      if (path) cacheSvgEffect(path, analysis);
      return analysis;
    } catch {
      return null; // 一時的な取得失敗は記録しない。次回再試行できる。
    }
  })();
  if (!path) return pending; // 埋め込み data URL の読み込みはネットワークに接続しない
  svgAnalysisInFlight.set(path, pending);
  try { return await pending; }
  finally { if (svgAnalysisInFlight.get(path) === pending) svgAnalysisInFlight.delete(path); }
}

export async function detectSvgFilters(
  assets: Record<string, Asset>
): Promise<Record<string, Pick<Asset, "svgFilter"> & Partial<Pick<Asset, "width" | "height">>>> {
  const pending = Object.values(assets).filter(
    (a) => a.mimeType === "image/svg+xml" || (!a.mimeType && /\.svg$/i.test(a.name))
  );
  const result: Record<string, Pick<Asset, "svgFilter"> & Partial<Pick<Asset, "width" | "height">>> = {};
  await mapLimit(pending, ASSET_FETCH_CONCURRENCY, async (asset) => {
    const analysis = await analyzeAssetSvg(asset);
    if (!analysis) return;
    result[asset.id] = {
      svgFilter: analysis.svgFilter,
      ...((!asset.width || !asset.height) && analysis.width && analysis.height
        ? { width: analysis.width, height: analysis.height } : {}),
    };
  });
  return result;
}

/** アセットを同時に取得する数（多すぎると、サーバーが 503 や接続エラーを返す） */
export const ASSET_FETCH_CONCURRENCY = 6;

/** items を最大 limit 件ずつ並行して処理する。失敗した後は新しく始めず、最初の例外をすぐに返す。 */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    try {
      while (!failed && next < items.length) await fn(items[next++]);
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
      throw failure;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** 長さを示さない応答や、誤った長さを示す応答も含め、上限までのバイトだけを読む。 */
export async function readAssetBytes(response: Response, limit: number, message = "Resource exceeds export size limit."): Promise<Uint8Array<ArrayBuffer>> {
  const tooLarge = () => new Error(message);
  if (Number(response.headers.get("content-length")) > limit) {
    void response.body?.cancel().catch(() => {});
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
        throw tooLarge();
      }
      chunks.push(part.value);
    }
  } catch (error) {
    // 読まれていない複製のために上流の後始末が遅れても、こちらの読み手は解放する。
    void reader?.cancel(error).catch(() => {});
    throw error;
  } finally { reader?.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function retryDelay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * 一時的な失敗（接続エラー・429・5xx）は、少し待って取得し直す。
 * 404 などはそのまま返す（呼び出し側で扱う）
 */
export async function fetchWithRetry(url: string, tries = 3, init?: RequestInit): Promise<Response> {
  for (let i = 1; ; i++) {
    init?.signal?.throwIfAborted();
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && i < tries) {
        void res.body?.cancel().catch(() => {});
        await retryDelay(500 * i, init?.signal);
        continue;
      }
      return res;
    } catch (e) {
      init?.signal?.throwIfAborted();
      if (i >= tries) throw e;
      await retryDelay(500 * i, init?.signal);
    }
  }
}

export { isEmbeddedAssetUrl } from "./site-import-format";

/** アセットの表示用の URL */
export function assetSrc(asset: Asset): string {
  if (asset.path) return `/api/assets/file?path=${encodeURIComponent(asset.path)}`;
  return isEmbeddedAssetUrl(asset.dataUrl) ? asset.dataUrl : "";
}

/**
 * 画像・動画の要素に持たせる src。ブラウザ内に埋め込んだアセット（data URL）は要素に複製せずに空にし、
 * 表示するときに assetId から探す（複製すると、使う要素の数だけ編集データが大きくなる）
 */
export function nodeAssetSrc(asset: Asset): string {
  return asset.path ? assetSrc(asset) : "";
}

/** 画像・動画の要素の表示用の URL（アセットを使っていれば、アセットから探す） */
export function mediaSrc(doc: SiteDoc, ref: { src: string; assetId?: string; assetSuffix?: string }): string {
  const asset = ref.assetId ? doc.assets[ref.assetId] : undefined;
  return asset ? assetMediaUrl(assetSrc(asset) || ref.src, ref.assetSuffix) : ref.src;
}

/**
 * 埋め込んだアセットを、サーバーに保存したファイルに置き換える（doc を書き換える）。
 * 要素の src と、背景画像などのスタイルの値に入っている data URL も差し替える
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
    for (const source of node.media?.sources ?? []) if (source.assetId === assetId) source.src = src;
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
  // 背景のパネルが保存する形式だけを扱い、カスタム CSS の値は書き換えない。
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

/** 埋め込んだアセットをサーバーへアップロードする（サーバーに保存できなければ null を返す） */
export async function uploadEmbeddedAsset(asset: Asset): Promise<string | null> {
  if (!isEmbeddedAssetUrl(asset.dataUrl)) return asset.path ?? null;
  const blob = await (await fetch(asset.dataUrl)).blob();
  const fresh = await uploadStaticAsset(new File([blob], asset.name, { type: blob.type || asset.mimeType || "" }));
  return fresh.path ?? null;
}

const ASSET_URL_RE = /(?<![\w/:%~.-])(?:([Hh][Tt][Tt][Pp][Ss]?:\/\/[^/\s"'<>]+|\/\/[^/\s"'<>]+))?\/api\/assets\/file\?path=([A-Za-z0-9%._~-]+)/g;

/**
 * HTML の中のアセットの URL を、期限付きの署名付き URL にする（HTMLページのプレビュー用）。
 * プレビューは、エディタの権限を使えない別オリジンで表示するため、ログインの Cookie が送られない
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
  if (roots.some((id) => !zipStylesheet(assets[id]))) throw new Error(tr("The ZIP stylesheet data could not be read. Import the ZIP again."));
  if (roots.length && html.length > ZIP_CSS_LIMITS.output) throw new Error(tr("The ZIP stylesheet preview is too large. Reduce the CSS dependencies and import the ZIP again."));
  const reachable = zipAssetClosure(assets, roots);
  const paths = new Set<string>();
  for (const m of html.matchAll(ASSET_URL_RE)) {
    if (!sameOrigin(m[1])) continue;
    try { paths.add(decodeURIComponent(m[2])); } catch { /* Ignore malformed percent encoding. */ }
  }
  for (const id of reachable) if (assets[id].path) paths.add(assets[id].path!);
  const signed: Record<string, string> = {};
  const list = [...paths];
  // このエンドポイントが受け付けるのは、最大500個のパス。異なるパスには、それぞれ1回だけ署名する。
  for (let i = 0; i < list.length; i += 500) {
    options.signal?.throwIfAborted();
    const res = await fetch("/api/assets/sign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: list.slice(i, i + 500) }), signal: options.signal,
    });
    if (!res.ok) {
      if (roots.length) throw new Error(tr("The HTML preview assets could not be loaded."));
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
    if (!url) throw new Error(tr("The HTML preview assets could not be loaded."));
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
      if (!target) throw new Error(tr("The HTML preview assets could not be loaded."));
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
    if (inserted > ZIP_CSS_LIMITS.output) throw new Error(tr("The ZIP stylesheet preview is too large. Reduce the CSS dependencies and import the ZIP again."));
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
  if (output.length > ZIP_CSS_LIMITS.output) throw new Error(tr("The ZIP stylesheet preview is too large. Reduce the CSS dependencies and import the ZIP again."));
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
    // CORS などで応答を取得できない場合だけ、新しいタブで開く。
    window.open(src, "_blank", "noopener");
    return;
  }
  // エラーの本文を元のファイルとして保存したり、失敗を別のタブで隠したりしない。
  if (!response.ok) throw new Error(tr("Could not download the asset."));
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
 * サーバー上のアセットを削除する（data URL のアセットでは何もしない）。
 * 他のサイトが同じファイルを使っていれば消さない（Node.js・Docker のサーバーは、全サイトを調べて確かめる。
 * Cloudflare は D1 に GC の候補を登録し、猶予期間（既定7日）の後に全サイトを確認してから削除する）
 */
export async function deleteAssetRemote(asset: Asset): Promise<void> {
  if (!asset.path) return;
  const quoted = `"${asset.path}"`;
  // ブラウザ内だけに保存した別のサイトがそのファイルを参照していても、Cloudflare のエンドポイントは
  // GC の候補に登録するため、削除の操作を受け取る必要がある。Node.js・Docker では、
  // browserReferenced の印を使って、その場で削除するときの安全を保つ。
  let browserReferenced = false;
  if (typeof window !== "undefined") {
    try {
      browserReferenced = (await otherBrowserDocs(currentSiteId()))
        .some((raw) => raw.includes(quoted));
    } catch {
      // ブラウザ内の索引が使えなくても、Cloudflare の GC への登録を止めてはいけない。
      // Node.js・Docker では、分からないときは安全のためにファイルを残す。
      browserReferenced = true;
    }
  }
  await fetch(siteApi("/api/assets", {
    path: asset.path, ...(browserReferenced ? { browserReferenced: "1" } : {}),
  }), {
    method: "DELETE",
  }).catch(() => {
    // 削除の失敗は、文書から消えていれば実害が無いため、無視する
  });
}

/**
 * アセットを削除したときに、背景のパネルで設定したページの背景を外す（doc を書き換える）。
 * URL の部分一致で、別のファイルや、手で書いた複数の背景まで削除しない。
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
