"use client";

import { getLang, LANGS, setLang, tr } from "../lib/i18n";

/** App-wide language selection used in both the home and editor settings. */
export default function LanguageSelector() {
  const current = getLang();
  return (
    <div className="seg seg-full language-selector" role="radiogroup" aria-label={tr("Language", "language_variant_1")}>
      {LANGS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === current}
          className={value === current ? "is-on" : ""}
          onClick={() => { if (value !== current) setLang(value); }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
