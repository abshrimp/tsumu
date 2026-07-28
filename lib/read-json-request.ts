/**
 * Read JSON request bodies with a hard byte limit, including chunked requests
 * that do not provide Content-Length.  Both AI and external-data proxy routes
 * accept user-supplied documents, so they must enforce a limit while reading.
 */
export async function readJsonRequestLimited(req: Request, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid body limit");
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new RangeError("Request too large");
  }
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RangeError("Request too large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    return JSON.parse(chunks.join("") + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
