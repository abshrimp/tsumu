import type { Dict } from "../i18n";
import type { Lang } from "../lang";

/** Language translations keyed by English source text, loaded on demand. */
export const LOCALES: Partial<Record<Lang, () => Promise<Dict>>> = {
  ja: () => import("./ja").then((m) => m.default),
};
