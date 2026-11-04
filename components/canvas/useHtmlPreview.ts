"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset } from "../../lib/types";
import { withSignedAssetUrls, zipPreviewRoots } from "../../lib/assets";
import { zipAssetClosure } from "../../lib/zip-css";
import { tr } from "../../lib/i18n";

// Signed URLs last one hour. Offer a refresh before expiry without resetting the live iframe.
export const HTML_PREVIEW_REFRESH_MS = 50 * 60 * 1000;
export function useHtmlPreview(src: string, assets: Record<string, Asset>) {
  const key = useMemo(() => JSON.stringify([...zipAssetClosure(assets, zipPreviewRoots(src, assets))].map((id) => assets[id])), [src, assets]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ src: string; key: string; revision: number; html: string; error?: string; needsRefresh?: boolean }>();
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!src.trim()) return;
    const controller = new AbortController();
    const isZip = src.includes("tsumu-zip-css:");
    let timer: ReturnType<typeof setTimeout>;
    const prepare = async () => {
      try {
        let expiresAt: number | undefined;
        const html = await withSignedAssetUrls(src, assets, { signal: controller.signal, onExpiresAt: (time) => { expiresAt = time; } });
        if (controller.signal.aborted) return;
        setResult({ src, key, revision, html });
        if (isZip && expiresAt !== undefined) timer = setTimeout(() => {
          if (!controller.signal.aborted) setResult((current) => current && { ...current, needsRefresh: true });
        }, Math.max(0, Math.min(HTML_PREVIEW_REFRESH_MS, expiresAt - Date.now() - 5 * 60 * 1000)));
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult({ src, key, revision, html: "", error: error instanceof Error ? error.message : tr("HTMLプレビューのアセットを読み込めませんでした") });
        // Explicit retry avoids repeatedly expanding a graph that exceeded a permanent limit.
      }
    };
    void prepare();
    return () => { controller.abort(); clearTimeout(timer); };
    // key includes only reachable dependencies, so unrelated editor changes do not restart signing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key, revision]);
  const current = result?.src === src && result.key === key ? result : undefined;
  // Never send unresolved internal CSS URLs to the sandbox, even for the first frame.
  return {
    html: current?.html ?? "", error: current?.error,
    needsRefresh: current?.needsRefresh ?? false, refreshing: current?.revision !== revision, refresh,
  };
}
