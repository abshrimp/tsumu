"use client";

import { useEditorThemePreference, setEditorThemePreference } from "../lib/editor-theme";
import { tr } from "../lib/i18n";

/** Home and editor settings share one appearance preference and live updates. */
export default function EditorAppearanceSelector() {
  const appearance = useEditorThemePreference();
  return (
    <div className="seg seg-full appearance-seg" role="group" aria-label={tr("Editor appearance")}>
      {(["system", "light", "dark"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={appearance === value ? "is-on" : ""}
          aria-pressed={appearance === value}
          onClick={() => setEditorThemePreference(value)}
        >
          {value === "system" ? tr("System setting") : value === "light" ? tr("Light mode") : tr("Dark mode")}
        </button>
      ))}
    </div>
  );
}
