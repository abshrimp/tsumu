"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useEditor } from "../lib/store";
import { currentSiteId, loadLocalSites, sitePath } from "../lib/site";
import type { SiteRecord } from "../lib/sites";
import { buildPagePayload, copyPagesToSite } from "../lib/page-transfer";
import { useEscapeToClose } from "./PublishModal";
import { userMessage } from "../lib/errors";
import { tr } from "../lib/i18n";

/** ページを、ほかのサイトへコピーする（コピー先を選ぶダイアログ） */
export default function CopyToSiteModal({ pageIds, onClose }: { pageIds: string[]; onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [sites, setSites] = useState<SiteRecord[] | null>(null);
  const [store, setStore] = useState<"server" | "local">("server");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<SiteRecord | null>(null);
  useEscapeToClose(onClose, !busy);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/sites");
        if (res.status === 503) {
          if (!alive) return;
          setStore("local");
          setSites(loadLocalSites());
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.sites) throw new Error(data?.error ?? tr("読み込めませんでした"));
        if (alive) setSites(data.sites);
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setSites([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const own = currentSiteId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sites ?? []).filter((s) => s.id !== own && (!q || s.name.toLowerCase().includes(q)));
  }, [sites, own, query]);
  const names = pageIds.map((id) => doc.pages[id]?.name).filter(Boolean);

  const copy = async (site: SiteRecord) => {
    setBusy(site.id);
    setError(null);
    try {
      await copyPagesToSite(site, buildPagePayload(useEditor.getState().doc, pageIds), store);
      setDone(site);
    } catch (e) {
      setError(userMessage(e, tr("コピーできませんでした")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal copy-site" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("ほかのサイトへコピー")}</h2>
        <p className="modal-desc">
          {names.length === 1
            ? tr("「{name}」を、選んだサイトの末尾に追加します。使っている画像・コンポーネント・フォントも一緒にコピーします。", { name: names[0] })
            : tr("{n}ページを、選んだサイトの末尾に追加します。使っている画像・コンポーネント・フォントも一緒にコピーします。", { n: names.length })}
        </p>

        {done ? (
          <div className="copy-site-done">
            <p>{tr("「{name}」へコピーしました。", { name: done.name })}</p>
            <a className="btn" href={sitePath(done.id)} target="_blank" rel="noopener">
              <ExternalLink size={13} />
              {tr("新しいタブで開く")}
            </a>
          </div>
        ) : (
          <>
            {sites && sites.length > 6 && (
              <label className="copy-site-search">
                <Search size={13} />
                <input
                  type="search"
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("サイトを探す")}
                  aria-label={tr("サイトを探す")}
                />
              </label>
            )}
            <div className="copy-site-list" role="list">
              {sites === null ? (
                <p className="copy-site-empty">
                  <LoaderCircle size={13} className="spin" />
                  {tr("読み込み中…")}
                </p>
              ) : shown.length === 0 ? (
                <p className="copy-site-empty">
                  {query.trim() ? tr("当てはまるサイトはありません") : tr("コピー先にできるサイトがありません。ホームでサイトを作ってください。")}
                </p>
              ) : (
                shown.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="listitem"
                    className="copy-site-item"
                    disabled={!!busy}
                    onClick={() => void copy(s)}
                  >
                    <span className="copy-site-thumb" aria-hidden>
                      {Array.from(s.name)[0]?.toUpperCase() ?? "S"}
                    </span>
                    <span className="copy-site-name">{s.name}</span>
                    {busy === s.id && <LoaderCircle size={13} className="spin" />}
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {error && (
          <p className="copy-site-error">
            <TriangleAlert size={13} />
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={!!busy}>
            {done ? tr("閉じる") : tr("キャンセル")}
          </button>
        </div>
      </div>
    </div>
  );
}
