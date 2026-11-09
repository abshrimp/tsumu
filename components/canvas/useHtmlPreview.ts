"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, HtmlZipPage } from "../../lib/types";
import { zipAssetClosure, zipCssUrl, zipStylesheet } from "../../lib/zip-css";
import { assetDocUrl, withSignedAssetUrls, zipPreviewRoots } from "../../lib/assets";
import { tr } from "../../lib/i18n";

type HtmlZipSource = typeof import("../../lib/html-zip-source").htmlZipSource;
type RewriteScriptUrls = typeof import("../../lib/html-zip-script-assets").rewriteHtmlZipScriptUrls;
let cachedHtmlZipSource: HtmlZipSource | undefined;
let loadingHtmlZipSource: Promise<HtmlZipSource> | undefined;
let cachedRewriteScripts: RewriteScriptUrls | undefined;
let loadingRewriteScripts: Promise<RewriteScriptUrls> | undefined;

// 署名付き URL の有効期限は1時間。動いている iframe をやり直さずに済むよう、期限の前に更新を促す。
export const HTML_PREVIEW_REFRESH_MS = 50 * 60 * 1000;
export function useHtmlPreview(src: string, assets: Record<string, Asset>, zip?: HtmlZipPage) {
  const needsZipSource = Boolean(zip?.assetIds.some((id) => Boolean(assets[id]?.zip?.path)));
  const [zipSourceReady, setZipSourceReady] = useState(() => Boolean(cachedHtmlZipSource));
  useEffect(() => {
    if (!needsZipSource || cachedHtmlZipSource) return;
    let cancelled = false;
    loadingHtmlZipSource ??= import("../../lib/html-zip-source").then(
      (mod) => (cachedHtmlZipSource = mod.htmlZipSource),
      (error) => { loadingHtmlZipSource = undefined; throw error; },
    );
    void loadingHtmlZipSource
      .then(() => { if (!cancelled) setZipSourceReady(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [needsZipSource]);
  const baseHtml = useMemo(
    () => needsZipSource && cachedHtmlZipSource
      ? cachedHtmlZipSource(src, zip, assets, (asset) => zipStylesheet(asset) ? zipCssUrl(asset.id) : assetDocUrl(asset))
      : src,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src, zip, assets, needsZipSource, zipSourceReady],
  );
  const needsScriptRewrite = Boolean(zip?.assetIds.length && (!needsZipSource || cachedHtmlZipSource) && /<script[\s>]/i.test(baseHtml));
  const [scriptReady, setScriptReady] = useState(() => Boolean(cachedRewriteScripts));
  useEffect(() => {
    if (!needsScriptRewrite || cachedRewriteScripts) return;
    let cancelled = false;
    loadingRewriteScripts ??= import("../../lib/html-zip-script-assets").then(
      (mod) => (cachedRewriteScripts = mod.rewriteHtmlZipScriptUrls),
      (error) => { loadingRewriteScripts = undefined; throw error; },
    );
    void loadingRewriteScripts
      .then(() => { if (!cancelled) setScriptReady(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [needsScriptRewrite]);
  const prepared = useMemo(
    () => needsScriptRewrite && cachedRewriteScripts
      ? cachedRewriteScripts(baseHtml, zip, assets, assetDocUrl)
      : baseHtml,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseHtml, zip, assets, needsScriptRewrite, scriptReady],
  );
  const key = useMemo(() => JSON.stringify([...zipAssetClosure(assets, zipPreviewRoots(prepared))].map((id) => assets[id])), [prepared, assets]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ src: string; key: string; revision: number; html: string; error?: string; needsRefresh?: boolean }>();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!src.trim() || (needsZipSource && !cachedHtmlZipSource) || (needsScriptRewrite && !cachedRewriteScripts)) return;
    const controller = new AbortController();
    const isZip = prepared.includes("tsumu-zip-css:");
    let timer: ReturnType<typeof setTimeout>;
    const prepare = async () => {
      try {
        let expiresAt: number | undefined;
        const html = await withSignedAssetUrls(prepared, assets, { signal: controller.signal, onExpiresAt: (time) => { expiresAt = time; } });
        if (controller.signal.aborted) return;
        setResult({ src: prepared, key, revision, html });
        if (isZip && expiresAt !== undefined) timer = setTimeout(() => {
          if (!controller.signal.aborted) setResult((current) => current && { ...current, needsRefresh: true });
        }, Math.max(0, Math.min(HTML_PREVIEW_REFRESH_MS, expiresAt - Date.now() - 5 * 60 * 1000)));
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ src: prepared, key, revision, html: "", error: error instanceof Error ? error.message : tr("The HTML preview assets could not be loaded.") });
        // 恒久的な上限を超えた依存関係を何度も展開し直さないよう、再試行は利用者の明示的な操作で行う。
      }
    };
    void prepare();
    return () => { controller.abort(); clearTimeout(timer); };
    // key includes only reachable dependencies, so unrelated editor changes do not restart signing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, key, revision, needsZipSource, zipSourceReady, needsScriptRewrite, scriptReady]);
  const current = (!needsZipSource || cachedHtmlZipSource) && (!needsScriptRewrite || cachedRewriteScripts) &&
    result?.src === prepared && result.key === key ? result : undefined;
  // 最初のフレームであっても、解決していない内部の CSS の URL はサンドボックスに渡さない。
  return {
    html: current?.html ?? "", error: current?.error,
    needsRefresh: current?.needsRefresh ?? false, refreshing: current?.revision !== revision, refresh,
  };
}
