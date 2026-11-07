/** Read a response with a hard byte limit, even if Content-Length is absent or false. */
export class SourceTooLargeError extends Error {
  constructor() { super("Source exceeds size limit"); }
}

export async function readLimitedBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(response.headers.get("content-length") || "0");
  if (length > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new SourceTooLargeError();
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        throw new SourceTooLargeError();
      }
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const result = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
