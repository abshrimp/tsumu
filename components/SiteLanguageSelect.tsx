"use client";

import { useEffect, useId, useState } from "react";
import { tr } from "../lib/i18n";
import { isEnterKey } from "../lib/keys";
import { isSiteLang, SITE_LANGS } from "../lib/site-lang";

const CUSTOM = "__custom__";
const isCustom = (value: string) => !!value && !SITE_LANGS.some((lang) => lang.value === value);

/** サイトとページで共通の言語の選択欄。空文字は、ページでは「サイトと同じ」を表す。 */
export default function SiteLanguageSelect({ value, onChange, inheritLabel, id }: {
  value: string;
  onChange: (value: string) => void;
  inheritLabel?: string;
  id?: string;
}) {
  const [custom, setCustom] = useState(() => isCustom(value));
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();

  // ページの切り替え・元に戻す操作・共同編集で値が変わったときも、入力欄の表示をそろえる。
  useEffect(() => {
    setCustom(isCustom(value));
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (!isSiteLang(next)) {
      setInvalid(true);
      return;
    }
    setDraft(next);
    setInvalid(false);
    if (next !== value) onChange(next);
  };

  return (
    <div className="site-language-select">
      <select
        id={id ?? `${hintId}-select`}
        className="select"
        aria-label={tr("Language")}
        value={custom ? CUSTOM : value}
        onChange={(event) => {
          const next = event.target.value;
          setInvalid(false);
          setCustom(next === CUSTOM);
          if (next === CUSTOM) setDraft(value);
          else onChange(next);
        }}
      >
        {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
        {SITE_LANGS.map((lang) => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
        <option value={CUSTOM}>{tr("Custom…")}</option>
      </select>
      {custom && (
        <>
          <input
            id={`${hintId}-custom`}
            className="input"
            aria-label={tr("Custom language code")}
            aria-describedby={hintId}
            aria-invalid={invalid || undefined}
            value={draft}
            placeholder="en-US"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (isEnterKey(event)) event.currentTarget.blur();
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                setDraft(value);
                setInvalid(false);
              }
            }}
          />
          <p id={hintId} className="hint" role={invalid ? "alert" : undefined}>
            {invalid
              ? tr("Enter a language code (e.g. en-US or pt-BR). Your change has not been saved.")
              : tr("Enter a language code (e.g. en-US or pt-BR).")}
          </p>
        </>
      )}
    </div>
  );
}
