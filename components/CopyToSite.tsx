"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useEditor } from "../lib/store";
import { currentSiteId, loadLocalSites, sitePath } from "../lib/site";
import type { SiteRecord } from "../lib/sites";
import { buildPagePayload, copyPagesToSite } from "../lib/page-transfer";
import { useEscapeToClose } from "../lib/use-escape-to-close";
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
        if (!res.ok || !data?.sites) throw new Error(data?.error ?? tr("Couldn't load"));
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
      setError(userMessage(e, tr("Couldn't copy")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal copy-site" onClick={(e) => e.stopPropagation()}>
        <h2>{tr("Copy to another site")}</h2>
        <p className="modal-desc">
          {names.length === 1
            ? tr("“{name}” will be added to the end of the site you choose, along with the images, components and fonts it uses.", { name: names[0] })
            : tr("{n} pages will be added to the end of the site you choose, along with the images, components and fonts they use.", { n: names.length })}
        </p>

        {done ? (
          <div className="copy-site-done">
            <p>{tr("Copied to “{name}”.", { name: done.name })}</p>
            <a className="btn" href={sitePath(done.id)} target="_blank" rel="noopener">
              <ExternalLink size={13} />
              {tr("Open in a new tab")}
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
                  placeholder={tr("Search sites")}
                  aria-label={tr("Search sites")}
                />
              </label>
            )}
            <div className="copy-site-list" role="list">
              {sites === null ? (
                <p className="copy-site-empty">
                  <LoaderCircle size={13} className="spin" />
                  {tr("Loading…")}
                </p>
              ) : shown.length === 0 ? (
                <p className="copy-site-empty">
                  {query.trim() ? tr("No matching sites") : tr("There is no other site to copy to. Create one on the home screen.")}
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
            {done ? tr("Close") : tr("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
