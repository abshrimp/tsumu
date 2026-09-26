"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { tr } from "../lib/i18n";
import { siteApi, currentSiteId } from "../lib/site";
import type { Asset } from "../lib/types";
import { genId } from "../lib/presets";
import { useServerStatus } from "../lib/status";
import { showConfirm } from "../lib/dialog";

type DeletedAsset = { path: string; deletedAt: number; bytes: number | null };
type TrashResponse = { enabled: boolean; hasMore: boolean; items: DeletedAsset[]; error?: string };
const MIMES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  css: "text/css", js: "text/javascript", json: "application/json",
  pdf: "application/pdf", woff2: "font/woff2",
};

function filename(path: string) {
  const last = path.split("/").pop() ?? "asset";
  const dash = last.indexOf("-");
  return dash < 0 ? last : last.slice(dash + 1);
}

async function assetFromTrash(item: DeletedAsset): Promise<Asset> {
  const name = filename(item.path);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const asset: Asset = {
    id: genId("asset"), name, path: item.path, bytes: item.bytes ?? undefined,
    mimeType: MIMES[ext], width: 0, height: 0,
  };
  if (asset.mimeType?.startsWith("image/")) {
    await new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => {
        asset.width = image.naturalWidth;
        asset.height = image.naturalHeight;
        resolve();
      };
      image.onerror = () => resolve();
      image.src = `/api/assets/file?path=${encodeURIComponent(item.path)}`;
    });
  }
  return asset;
}

export default function AssetTrash({ onClose, onRestore, onDelete }: {
  onClose: () => void;
  onRestore: (asset: Asset) => void;
  onDelete: () => void;
}) {
  const status = useServerStatus();
  const [items, setItems] = useState<DeletedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(siteApi("/api/assets/trash"), { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json() as TrashResponse;
        if (!res.ok) throw new Error(data.error ?? tr("Couldn't load"));
        if (active) { setEnabled(data.enabled); setItems(data.items); setHasMore(data.hasMore); setLoadedCount(data.items.length); }
      }).catch((err) => { if (active) setError(err instanceof Error ? err.message : tr("Couldn't load")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(siteApi("/api/assets/trash", { offset: loadedCount }), { cache: "no-store" });
      const data = await response.json() as TrashResponse;
      if (!response.ok) throw new Error(data.error ?? tr("Couldn't load"));
      setItems((current) => [...current, ...data.items]);
      setLoadedCount((current) => current + data.items.length);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't load"));
    } finally {
      setLoadingMore(false);
    }
  };

  const restore = async (item: DeletedAsset) => {
    if (restoring) return;
    setError(null);
    setRestoring(item.path);
    const site = currentSiteId();
    try {
      if (!site) throw new Error(tr("Invalid site"));
      const asset = await assetFromTrash(item);
      if (currentSiteId() !== site) throw new Error(tr("Site changed. Try again."));
      const response = await fetch("/api/assets/trash", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, path: item.path }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? tr("Couldn't restore"));
      if (currentSiteId() === site) onRestore(asset);
      setItems((previous) => previous.filter((entry) => entry.path !== item.path));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't restore"));
    } finally {
      setRestoring(null);
    }
  };

  const deleteNow = async (item: DeletedAsset) => {
    if (restoring) return;
    const site = currentSiteId();
    if (!site) return;
    const approved = await showConfirm(
      tr("The file will be permanently deleted from the server without waiting seven days. This cannot be undone."),
      { title: tr('Delete "{name}" permanently?', { name: filename(item.path) }),
        okLabel: tr("Delete permanently"), danger: true }
    );
    if (!approved || currentSiteId() !== site) return;
    setError(null);
    setRestoring(item.path);
    try {
      const response = await fetch("/api/assets/trash", {
        method: "DELETE", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, path: item.path }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? tr("Couldn't delete permanently"));
      if (currentSiteId() !== site) return;
      setItems((previous) => previous.filter((entry) => entry.path !== item.path));
      onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't delete permanently"));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr("Trash")}
        style={{ width: "min(620px, calc(100vw - 32px))", display: "flex", flexDirection: "column" }}
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2><Trash2 size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />{tr("Trash")}</h2>
          <button type="button" className="icon-btn" aria-label={tr("Close")} onClick={onClose}><X size={16} /></button>
        </div>
        {status?.assetDeletion?.mode === "scheduled" && (
          <p className="hint">{tr("Assets in trash are permanently deleted after {days} days unless restored.", {
            days: status.assetDeletion.days,
          })}</p>
        )}
        {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
        {loading ? <p>{tr("Loading…")}</p> : !enabled ? (
          <p>{tr("Trash is available for Cloudflare server storage.")}</p>
        ) : !items.length ? <p>{tr("Trash is empty.")}</p> : (
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            {items.map((item) => (
              <div key={item.path} style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{filename(item.path)}</strong>
                  <span className="hint">{new Date(item.deletedAt).toLocaleString()}
                    {item.bytes != null ? ` · ${Math.ceil(item.bytes / 1024)} KB` : ""}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: "none", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" disabled={!!restoring}
                    onClick={() => void restore(item)}>
                    <RotateCcw size={14} />{tr("Restore")}
                  </button>
                  <button type="button" className="btn" disabled={!!restoring}
                    style={{ color: "var(--danger)" }}
                    onClick={() => void deleteNow(item)}>
                    <Trash2 size={14} />{tr("Delete permanently")}
                  </button>
                </div>
              </div>
            ))}
            {hasMore && (
              <button type="button" className="btn" disabled={loadingMore || !!restoring}
                onClick={() => void loadMore()} style={{ margin: "12px 0" }}>
                {loadingMore ? tr("Loading…") : tr("Load more")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
