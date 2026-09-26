/** Search aliases are separate from UI translation dictionaries. */
import type { Lang } from "../../lang";
import en from "./en";
import ja from "./ja";

/** Japanese searches retain both Japanese and English aliases, as before localization. */
const japaneseTerms: Record<string, string> = Object.fromEntries(
  Object.entries(en).map(([key, english]) => [
    key,
    [ja[key], english].filter(Boolean).join(" "),
  ])
);

/** Fall back to English for languages without dedicated search aliases. */
export function searchTermsFor(lang: Lang): Record<string, string> {
  return lang === "ja" ? japaneseTerms : en;
}
