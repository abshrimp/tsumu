import type { Dict } from "../i18n";
import type { Lang } from "../lang";

/**
 * 言語ごとの訳の辞書（日本語の原文 → 訳）。使うときにだけ読み込む。
 * 日本語は原文そのものなので辞書は無い
 */
export const LOCALES: Partial<Record<Lang, () => Promise<Dict>>> = {
  en: () => import("./en").then((m) => m.default),
};
