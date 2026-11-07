"use client";

import { useMemo, useState } from "react";
import { icons } from "lucide-react";
import { tr } from "../lib/i18n";

/** PascalCase を kebab-case に変換する（lucide での名前の書き方） */
function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

const ICON_ENTRIES = Object.keys(icons).map((pascal) => ({
  pascal,
  kebab: toKebab(pascal),
}));

/** クリックしたボタン内の SVG を複製し、CSS で大きさを決められる文字列にする */
function buttonIconSvg(button: HTMLButtonElement): string {
  const source = button.querySelector("svg");
  if (!source) return "";
  const svg = source.cloneNode(true) as SVGSVGElement;
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("stroke-width", "2");
  return svg.outerHTML;
}

export default function IconPicker({
  value,
  onSelect,
}: {
  /** 現在のアイコン名（kebab-case） */
  value: string;
  onSelect: (kebabName: string, svg: string) => void;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-");
    const list = q
      ? ICON_ENTRIES.filter((entry) => entry.kebab.includes(q))
      : ICON_ENTRIES;
    return list.slice(0, 96);
  }, [query]);

  return (
    <div className="icon-picker">
      <input
        className="input"
        placeholder={tr("Search (e.g. heart, arrow, music)")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="icon-picker-grid">
        {matches.map(({ pascal, kebab }) => {
          const C = icons[pascal as keyof typeof icons];
          return (
            <button
              key={pascal}
              type="button"
              className={`icon-picker-cell${value === kebab ? " is-sel" : ""}`}
              data-tip={kebab}
              onClick={(e) => onSelect(kebab, buttonIconSvg(e.currentTarget))}
            >
              <C size={16} strokeWidth={1.75} />
            </button>
          );
        })}
        {!matches.length && (
          <p className="hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
            {tr("No results")}
          </p>
        )}
      </div>
    </div>
  );
}
