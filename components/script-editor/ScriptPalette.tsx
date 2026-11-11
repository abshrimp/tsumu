"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { Search, X } from "lucide-react";
import { tr } from "../../lib/i18n";
import { PaletteLabel } from "./blocks";
import { CAT_INFO, CAT_ORDER, findPaletteItems, Ico, type Payload } from "./palette";

/** Own search state and keyboard interaction without rerendering the workspace. */
export function ScriptPalette({ begin }: {
  begin: (event: PointerEvent, make: () => Payload) => void;
}) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => findPaletteItems(query), [query]);
  return (
    <div className="se-palette" data-tutorial="se-palette">
      <div className="se-pal-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          className="se-pal-search-input"
          aria-label={tr("Find an action")}
          placeholder={tr("Find an action")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="se-pal-search-clear"
            aria-label={tr("Clear search")}
            onClick={() => setQuery("")}
          >
            <X size={13} />
          </button>
        )}
      </div>
      {CAT_ORDER.map((cat) => {
        const categoryItems = items.filter((item) => item.cat === cat);
        if (!categoryItems.length) return null;
        return (
          <div key={cat} className="se-pal-group">
            <div className="se-pal-title">{CAT_INFO[cat].label}</div>
            {categoryItems.map((item) => (
              <div
                key={item.key}
                className="se-blk se-pal-item"
                data-tutorial={`se-block-${item.key}`}
                onPointerDown={(e) => begin(e, item.make)}
              >
                <Ico icon={item.icon} cat={cat} />
                <PaletteLabel label={item.label} />
              </div>
            ))}
          </div>
        );
      })}
      {items.length === 0 && (
        <p className="se-pal-empty" role="status">{tr("No matching actions")}</p>
      )}
    </div>
  );
}
