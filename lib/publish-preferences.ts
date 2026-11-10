import type { Db } from "./db";
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FRAMEWORK_OPTIONS,
  type ExportOptions,
} from "./export-formats";

export type PublishedExportOptions = Pick<ExportOptions, "framework" | "language" | "style">;

export const DEFAULT_PUBLISHED_EXPORT_OPTIONS: PublishedExportOptions = {
  framework: DEFAULT_EXPORT_OPTIONS.framework,
  language: DEFAULT_EXPORT_OPTIONS.language,
  style: DEFAULT_EXPORT_OPTIONS.style,
};

/** Accept only export settings the publish dialog can actually produce. */
export function parsePublishedExportOptions(value: unknown): PublishedExportOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const options = value as Record<string, unknown>;
  if (
    !EXPORT_FRAMEWORK_OPTIONS.some((option) => option.value === options.framework) ||
    (options.language !== "typescript" && options.language !== "javascript") ||
    (options.style !== "css" && options.style !== "css-modules" && options.style !== "tailwind") ||
    ((options.framework === "html" || options.framework === "single-html") &&
      (options.language !== "javascript" || options.style !== "css"))
  ) return null;
  return {
    framework: options.framework as PublishedExportOptions["framework"],
    language: options.language as PublishedExportOptions["language"],
    style: options.style as PublishedExportOptions["style"],
  };
}

/** The DB is authoritative; no preference is written to browser storage. */
export async function readPublishedExportOptions(db: Db, siteId: string): Promise<PublishedExportOptions> {
  const result = await db.execute({
    sql: "SELECT framework, language, style FROM site_publish_options WHERE site_id = ?",
    args: [siteId],
  });
  return parsePublishedExportOptions(result.rows[0]) ?? { ...DEFAULT_PUBLISHED_EXPORT_OPTIONS };
}

/** Only the successful server-side GitHub commit path may call this. */
export async function savePublishedExportOptions(
  db: Db,
  siteId: string,
  options: PublishedExportOptions
): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO site_publish_options (site_id, framework, language, style)
      SELECT id, ?, ?, ? FROM sites WHERE id = ?
      ON CONFLICT(site_id) DO UPDATE SET
        framework = excluded.framework,
        language = excluded.language,
        style = excluded.style`,
    args: [options.framework, options.language, options.style, siteId],
  });
  return result.rowsAffected > 0;
}
