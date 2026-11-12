"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, HtmlZipPage } from "../../lib/types";
import { htmlZipSource } from "../../lib/html-zip-source";
import { rewriteHtmlZipScriptUrls } from "../../lib/html-zip-script-assets";
import { zipCssUrl, zipStylesheet } from "../../lib/zip-css";
import { assetSrc } from "../../lib/assets";
import { withSignedAssetUrls, zipPreviewRoots } from "../../lib/assets";
import { zipAssetClosure } from "../../lib/zip-css";
import { tr } from "../../lib/i18n";

// 署名付き URL の有効期限は1時間。動いている iframe をやり直さずに済むよう、期限の前に更新を促す。
export const HTML_PREVIEW_REFRESH_MS = 50 * 60 * 1000;
export function useHtmlPreview(src: string, assets: Record<string, Asset>, zip?: HtmlZipPage) {
  const prepared = useMemo(() => {
    const html = htmlZipSource(src, zip, assets,
      asset => zipStylesheet(asset) ? zipCssUrl(asset.id) : assetSrc(asset));
    return rewriteHtmlZipScriptUrls(html, zip, assets, assetSrc);
  }, [src, zip, assets]);
  const key = useMemo(() => JSON.stringify([...zipAssetClosure(assets, zipPreviewRoots(prepared, assets))].map((id) => assets[id])), [prepared, assets]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ src: string; key: string; revision: number; html: string; error?: string; needsRefresh?: boolean }>();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!src.trim()) return;
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
  }, [prepared, key, revision]);
  const current = result?.src === prepared && result.key === key ? result : undefined;
  // 最初のフレームであっても、解決していない内部の CSS の URL はサンドボックスに渡さない。
  return {
    html: current?.html ?? "", error: current?.error,
    needsRefresh: current?.needsRefresh ?? false, refreshing: current?.revision !== revision, refresh,
  };
}
