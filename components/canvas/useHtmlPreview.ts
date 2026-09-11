"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, HtmlZipPage } from "../../lib/types";
import { htmlZipSource } from "../../lib/html-zip-source";
import { zipCssUrl, zipStylesheet } from "../../lib/zip-css";
import { assetSrc } from "../../lib/assets";
import { withSignedAssetUrls, zipPreviewRoots } from "../../lib/assets";
import { zipAssetClosure } from "../../lib/zip-css";
import { tr } from "../../lib/i18n";

// Signed URLs last one hour. Offer a refresh before expiry without resetting the live iframe.
export const HTML_PREVIEW_REFRESH_MS = 50 * 60 * 1000;
export function useHtmlPreview(src: string, assets: Record<string, Asset>, zip?: HtmlZipPage) {
  const prepared = useMemo(() => htmlZipSource(src, zip, assets,
    asset => zipStylesheet(asset) ? zipCssUrl(asset.id) : assetSrc(asset)), [src, zip, assets]);
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
        // Explicit retry avoids repeatedly expanding a graph that exceeded a permanent limit.
      }
    };
    void prepare();
    return () => { controller.abort(); clearTimeout(timer); };
    // key includes only reachable dependencies, so unrelated editor changes do not restart signing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, key, revision]);
  const current = result?.src === prepared && result.key === key ? result : undefined;
  // Never send unresolved internal CSS URLs to the sandbox, even for the first frame.
  return {
    html: current?.html ?? "", error: current?.error,
    needsRefresh: current?.needsRefresh ?? false, refreshing: current?.revision !== revision, refresh,
  };
}
