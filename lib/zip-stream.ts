import { tr } from "./i18n";
import type { ZipEntry } from "./zip";

/** アーカイブの項目を展開している途中で、許される最大のバイト数を超えた。 */
export class ZipEntryTooLargeError extends Error {
  constructor() {
    super(tr("The ZIP expands beyond the size limit."));
  }
}

/** *実際の* 出力が上限を超えた時点で、すぐに展開を止める。 */
export async function readZipEntryLimited(entry: ZipEntry, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const { readZipBytes } = await import("./zip");
  return readZipBytes(entry, maxBytes, () => new ZipEntryTooLargeError());
}

export async function verifyZipEntry(entry: ZipEntry, maxBytes: number): Promise<void> {
  const { verifyZipBytes } = await import("./zip");
  await verifyZipBytes(entry, maxBytes, () => new ZipEntryTooLargeError());
}
