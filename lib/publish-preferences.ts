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

/** 公開のダイアログが実際に作れる書き出しの設定だけを受け付ける。 */
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

/** 正となるのは DB の値。ブラウザの保存領域には、設定を書き込まない。 */
export async function readPublishedExportOptions(db: Db, siteId: string): Promise<PublishedExportOptions> {
  const result = await db.execute({
    sql: "SELECT framework, language, style FROM site_publish_options WHERE site_id = ?",
    args: [siteId],
  });
  return parsePublishedExportOptions(result.rows[0]) ?? { ...DEFAULT_PUBLISHED_EXPORT_OPTIONS };
}

/** この関数を呼んでよいのは、サーバー側で GitHub へのコミットに成功した経路だけ。 */
export async function savePublishedExportOptions(
  db: Db,
  siteId: string,
  options: PublishedExportOptions,
  expectedRoomKey?: string | null
): Promise<boolean> {
  const fenced = db.backend === "d1" && expectedRoomKey !== undefined;
  const result = await db.execute({
    sql: `INSERT INTO site_publish_options (site_id, framework, language, style)
      SELECT id, ?, ?, ? FROM sites WHERE id = ?
      ${fenced ? "AND EXISTS (SELECT 1 FROM site_document_rooms WHERE site_id = ? AND room_key = ?)" : ""}
      ON CONFLICT(site_id) DO UPDATE SET
        framework = excluded.framework,
        language = excluded.language,
        style = excluded.style`,
    args: [options.framework, options.language, options.style, siteId, ...(fenced ? [siteId, expectedRoomKey ?? null] : [])],
  });
  return result.rowsAffected > 0;
}
