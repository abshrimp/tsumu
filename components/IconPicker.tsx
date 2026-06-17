"use client";

import { createElement, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { icons } from "lucide-react";
import { tr } from "../lib/i18n";

const ICON_NAMES = Object.keys(icons);

/** PascalCase → kebab-case（lucide の慣用名） */
function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** アイコンコンポーネントをSVG文字列に変換（サイズはCSS任せにする） */
export function iconToSvg(pascalName: string): string {
  const C = icons[pascalName as keyof typeof icons];
  if (!C) return "";
  const div = document.createElement("div");
  const root = createRoot(div);
  flushSync(() => {
    root.render(createElement(C, { size: 24 }));
  });
  const svg = div.innerHTML
    .replace(/width="24"/, 'width="100%"')
    .replace(/height="24"/, 'height="100%"');
  root.unmount();
  return svg;
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
      ? ICON_NAMES.filter((n) => toKebab(n).includes(q))
      : ICON_NAMES;
    return list.slice(0, 96);
  }, [query]);

  return (
    <div className="icon-picker">
      <input
        className="input"
        placeholder={tr("英語で検索（例: heart, arrow, music）")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="icon-picker-grid">
        {matches.map((pascal) => {
          const kebab = toKebab(pascal);
          const C = icons[pascal as keyof typeof icons];
          return (
            <button
              key={pascal}
              type="button"
              className={`icon-picker-cell${value === kebab ? " is-sel" : ""}`}
              data-tip={kebab}
              onClick={() => onSelect(kebab, iconToSvg(pascal))}
            >
              <C size={16} strokeWidth={1.75} />
            </button>
          );
        })}
        {!matches.length && (
          <p className="hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
            {tr("見つかりませんでした")}
          </p>
        )}
      </div>
    </div>
  );
}
