"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { searchSiteBody, type BodySearchHit } from "../lib/body-search";
import { tr } from "../lib/i18n";
import { useEditor } from "../lib/store";

/** Search all pages without affecting browser Find or the editor's text inputs. */
export default function BodySearch({ onClose }: { onClose: () => void }) {
  const doc = useEditor((state) => state.doc);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchSiteBody(doc, query), [doc, query]);

  const open = ({ pageId, nodeId, componentId }: BodySearchHit) => {
    const store = useEditor.getState();
    if (!store.doc.pages[pageId]) return;
    store.setActivePage(pageId);
    if (componentId) store.setEditingComponent(componentId);
    store.setLeftTab("layers");
    store.select(nodeId);
    onClose();
  };

  return createPortal(
    <div
      className="modal-backdrop body-search-backdrop"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.currentTarget === e.target) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
        }
      }}
    >
      <div className="modal body-search" role="dialog" aria-modal="true" aria-label={tr("Search page text")}>
        <div className="body-search-head">
          <h2>{tr("Search page text")}</h2>
          <button type="button" className="icon-btn" aria-label={tr("Close")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="body-search-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchRef}
            autoFocus
            type="search"
            value={query}
            aria-label={tr("Search page text")}
            placeholder={tr("Search text across all pages")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="body-search-clear"
              aria-label={tr("Clear search")}
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="body-search-meta" role="status" aria-live="polite">
          {query.trim() ? tr("{n} matches", { n: hits.length }) : tr("Enter words to search page content")}
        </div>
        <div className="body-search-results" role="list" aria-label={tr("Search results")}>
          {!query.trim() || hits.length === 0 ? (
            <p className="body-search-empty">
              {query.trim() ? tr("No matching page text") : tr("Search text across all pages")}
            </p>
          ) : hits.map((hit, index) => (
            <div role="listitem" key={hit.pageId + ":" + hit.nodeId + ":" + index}>
              <button
                type="button"
                className="body-search-result"
                onClick={() => open(hit)}
              >
                <span className="body-search-result-name">{hit.pageName} / {hit.nodeName}</span>
                <span className="body-search-result-excerpt">{hit.excerpt}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
