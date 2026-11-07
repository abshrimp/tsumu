import { tr } from "./i18n";
import { IMPORT_LIMITS } from "./site-import-format";
import type { ZipArchive, ZipEntry } from "./zip";

export function zipEntrySize(entry: ZipEntry): number | null {
  const size = entry.uncompressedSize;
  return typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null;
}

export function isSafeArchivePath(path: string): boolean {
  return !!path && !path.includes("\\") && !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((part) => !!part && part !== "." && part !== "..");
}

/** ファイルと明示的なディレクトリを合わせた物理レコードの上限。 */
export function checkZipRecordCount(records: number, maxFiles: number): void {
  if (records > maxFiles * 4) throw new Error(tr("The ZIP contains too many files."));
}

export async function openImportZip(source: File | Uint8Array, maxFiles: number): Promise<ZipArchive> {
  if ((source instanceof Uint8Array ? source.byteLength : source.size) > IMPORT_LIMITS.zipBytes) {
    throw new Error(tr("The import file is too large."));
  }
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  const { ZipArchive } = await import("./zip");
  return ZipArchive.open(bytes, {
    maxRecords: maxFiles * 4,
    maxExpandedBytes: IMPORT_LIMITS.expandedBytes,
    onTooManyRecords: () => new Error(tr("The ZIP contains too many files.")),
    onInvalidDirectory: () => new Error(tr("The ZIP file directory is invalid.")),
    onDuplicatePath: () => new Error(tr("The ZIP contains duplicate file paths.")),
  });
}
