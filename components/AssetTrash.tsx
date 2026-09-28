"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { tr } from "../lib/i18n";
import { siteApi, currentSiteId } from "../lib/site";
import type { Asset } from "../lib/types";
import { genId } from "../lib/presets";
import { useServerStatus } from "../lib/status";
import { showConfirm } from "../lib/dialog";
import { loadAllTrash } from "../lib/asset-trash-client";

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
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = !!restoring || !!bulkProgress || loadingAll;

  const fetchPage = async (offset: number): Promise<TrashResponse> => {
    const response = await fetch(siteApi("/api/assets/trash", { offset }), { cache: "no-store" });
    const data = await response.json() as TrashResponse;
    if (!response.ok) throw new Error(data.error ?? tr("Couldn't load"));
    return data;
  };

  useEffect(() => {
    let active = true;
    void fetch(siteApi("/api/assets/trash"), { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json() as TrashResponse;
        if (!res.ok) throw new Error(data.error ?? tr("Couldn't load"));
        if (active) {
          setEnabled(data.enabled);
          setItems(data.items);
          setHasMore(data.hasMore);
          setLoadedCount(data.items.length);
        }
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : tr("Couldn't load")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const loadMore = async () => {
    if (busy || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchPage(loadedCount);
      setItems((current) => [...current, ...data.items.filter(
        (item) => !current.some((existing) => existing.path === item.path)
      )]);
      setLoadedCount((current) => current + data.items.length);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't load"));
    } finally {
      setLoadingMore(false);
    }
  };

  const removeFromList = (path: string) => {
    setItems((current) => current.filter((item) => item.path !== path));
    setLoadedCount((count) => Math.max(0, count - 1));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  };

  const restore = async (item: DeletedAsset) => {
    if (busy || loadingMore) return;
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
      if (currentSiteId() !== site) return;
      onRestore(asset);
      removeFromList(item.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't restore"));
    } finally {
      setRestoring(null);
    }
  };

  const deleteFiles = async (mode: "one" | "selected" | "all", one?: DeletedAsset) => {
    if (busy || loadingMore || loading || !enabled) return;
    const site = currentSiteId();
    if (!site) return;
    const approved = await showConfirm(
      tr("The files will be permanently deleted from the server without waiting seven days. This cannot be undone."),
      {
        title: mode === "one" && one
          ? tr('Delete "{name}" permanently?', { name: filename(one.path) })
          : mode === "all" ? tr("Delete all files permanently?") : tr("Delete selected files permanently?"),
        okLabel: tr("Delete permanently"), danger: true,
      },
    );
    if (!approved || currentSiteId() !== site || busy) return;
    setError(null);
    setLoadingAll(true);
    let paths: string[] = [];
    try {
      if (mode === "all") {
        const all = await loadAllTrash(fetchPage);
        if (currentSiteId() !== site) return;
        setItems(all);
        setLoadedCount(all.length);
        setHasMore(false);
        paths = all.map((item) => item.path);
      } else if (mode === "selected") {
        paths = [...selected];
      } else if (one) {
        paths = [one.path];
      }
      if (!paths.length) return;
      setLoadingAll(false);
      setBulkProgress({ done: 0, total: paths.length });
      let succeeded = 0;
      const failures: string[] = [];
      for (const path of paths) {
        if (currentSiteId() !== site) break;
        try {
          const response = await fetch("/api/assets/trash", {
            method: "DELETE", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ site, path }),
          });
          const data = await response.json() as { error?: string };
          if (!response.ok && !(response.status === 404 && data.error === "File is no longer in trash.")) {
            throw new Error(data.error ?? tr("Couldn't delete permanently"));
          }
          removeFromList(path);
          succeeded++;
        } catch (err) {
          failures.push(filename(path) + ": " +
            (err instanceof Error ? err.message : tr("Couldn't delete permanently")));
        } finally {
          setBulkProgress((current) => current ? { ...current, done: current.done + 1 } : null);
        }
      }
      if (succeeded) onDelete();
      if (failures.length) setError(
        tr("{count} files could not be deleted.", { count: failures.length }) + "\n" + failures.slice(0, 3).join("\n")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't delete permanently"));
    } finally {
      setLoadingAll(false);
      setBulkProgress(null);
    }
  };

  const selectAll = async () => {
    if (busy || loadingMore) return;
    if (!hasMore && selected.size === items.length) {
      setSelected(new Set());
      return;
    }
    setLoadingAll(true);
    setError(null);
    const site = currentSiteId();
    try {
      const all = await loadAllTrash(fetchPage);
      if (site !== currentSiteId()) return;
      setItems(all);
      setLoadedCount(all.length);
      setHasMore(false);
      setSelected(new Set(all.map((item) => item.path)));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("Couldn't load"));
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onClose();
    }} onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }}>
      <div className="modal asset-trash-modal" role="dialog" aria-modal="true" aria-label={tr("Trash")}
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="asset-trash-header">
          <h2><Trash2 size={18} aria-hidden="true" />{tr("Trash")}</h2>
          <button type="button" className="icon-btn" disabled={busy} aria-label={tr("Close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {status?.assetDeletion?.mode === "scheduled" && (
          <p className="hint asset-trash-notice">
            {tr("Assets in trash are permanently deleted after {days} days unless restored.", {
              days: status.assetDeletion.days,
            })}
          </p>
        )}
        {error && <p role="alert" className="asset-trash-error">{error}</p>}
        {loading ? <p>{tr("Loading…")}</p> : !enabled ? (
          <p>{tr("Trash is available for Cloudflare server storage.")}</p>
        ) : (
          <>
            <div className="asset-trash-toolbar">
              <label className="asset-trash-select-all">
                <input type="checkbox" disabled={busy || loadingMore || !items.length && !hasMore}
                  checked={!!items.length && !hasMore && selected.size === items.length}
                  onChange={() => void selectAll()} />
                {tr("Select all")}
              </label>
              <span className="hint">{tr("{count} selected", { count: selected.size })}</span>
              <div className="asset-trash-toolbar-actions">
                <button type="button" className="btn" disabled={busy || loadingMore || !selected.size}
                  onClick={() => void deleteFiles("selected")}>
                  <Trash2 size={13} />{tr("Delete selected")}
                </button>
                <button type="button" className="btn asset-trash-danger" disabled={busy || loadingMore || !items.length && !hasMore}
                  onClick={() => void deleteFiles("all")}>
                  <Trash2 size={13} />{tr("Delete all")}
                </button>
              </div>
            </div>
            {bulkProgress && (
              <p className="hint" role="status">
                {tr("Deleting files…")} {bulkProgress.done} / {bulkProgress.total}
              </p>
            )}
            <div className="asset-trash-list">
              {!items.length && !hasMore ? <p className="hint">{tr("Trash is empty.")}</p> : (
                items.map((item) => (
                  <div className="asset-trash-row" key={item.path}>
                    <label className="asset-trash-file">
                      <input type="checkbox" disabled={busy || loadingMore} checked={selected.has(item.path)}
                        aria-label={filename(item.path)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(item.path);
                            else next.delete(item.path);
                            return next;
                          });
                        }} />
                      <span className="asset-trash-details">
                        <strong>{filename(item.path)}</strong>
                        <span className="hint">
                          {new Date(item.deletedAt).toLocaleString()}
                          {item.bytes != null ? " · " + Math.ceil(item.bytes / 1024) + " KB" : ""}
                        </span>
                      </span>
                    </label>
                    <div className="asset-trash-row-actions">
                      <button type="button" className="btn" disabled={busy || loadingMore}
                        onClick={() => void restore(item)}>
                        <RotateCcw size={14} />{tr("Restore")}
                      </button>
                      <button type="button" className="btn asset-trash-danger" disabled={busy || loadingMore}
                        onClick={() => void deleteFiles("one", item)}>
                        <Trash2 size={14} />{tr("Delete permanently")}
                      </button>
                    </div>
                  </div>
                ))
              )}
              {hasMore && (
                <button type="button" className="btn asset-trash-more" disabled={busy || loadingMore}
                  onClick={() => void loadMore()}>
                  {loadingMore ? tr("Loading…") : tr("Load more")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
