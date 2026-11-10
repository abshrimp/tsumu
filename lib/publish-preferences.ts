import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FRAMEWORK_OPTIONS,
  type ExportOptions,
} from "./export-formats";
import { currentSiteId, siteKey } from "./site";
import { storageKey } from "./storage-keys";

export type PublishedExportOptions = Pick<ExportOptions, "framework" | "language" | "style">;

/** Last successful GitHub Push settings, scoped to the site and this browser. */
const PUBLISHED_EXPORT_OPTIONS_KEY = storageKey("publish-options-v1");

function defaults(): PublishedExportOptions {
  const { framework, language, style } = DEFAULT_EXPORT_OPTIONS;
  return { framework, language, style };
}

/** Invalid or inaccessible local storage should never prevent opening Publish. */
export function loadPublishedExportOptions(): PublishedExportOptions {
  if (typeof window === "undefined" || !currentSiteId()) return defaults();
  try {
    const raw = window.localStorage.getItem(siteKey(PUBLISHED_EXPORT_OPTIONS_KEY));
    if (!raw) return defaults();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults();
    const options = value as Record<string, unknown>;
    if (
      !EXPORT_FRAMEWORK_OPTIONS.some((item) => item.value === options.framework) ||
      (options.language !== "typescript" && options.language !== "javascript") ||
      (options.style !== "css" && options.style !== "css-modules" && options.style !== "tailwind") ||
      ((options.framework === "html" || options.framework === "single-html") &&
        (options.language !== "javascript" || options.style !== "css"))
    ) return defaults();
    return {
      framework: options.framework as PublishedExportOptions["framework"],
      language: options.language as PublishedExportOptions["language"],
      style: options.style as PublishedExportOptions["style"],
    };
  } catch {
    return defaults();
  }
}

/** Call only after a successful GitHub commit, not when an option is selected. */
export function savePublishedExportOptions(options: PublishedExportOptions, siteId: string): void {
  if (typeof window === "undefined" || !siteId) return;
  try {
    window.localStorage.setItem(siteKey(PUBLISHED_EXPORT_OPTIONS_KEY, siteId), JSON.stringify(options));
  } catch {
    // Publishing succeeded even if the browser refuses optional preferences.
  }
}
