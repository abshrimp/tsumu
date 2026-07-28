/**
 * JSON API のリクエスト本文をストリームから上限付きで読む。
 * Content-Length だけでなく、長さを申告しない chunked 送信にも適用する。
 */
export class JsonBodyTooLargeError extends RangeError {}
export class JsonContentTypeError extends TypeError {}

export async function readJsonLimited(
  req: Request, maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Invalid JSON request limit");
  }
  const type = req.headers.get("content-type");
  if (type && type.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new JsonContentTypeError("Expected application/json");
  }
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new SyntaxError("Invalid Content-Length");
    if (Number(declared) > maxBytes) {
      await req.body?.cancel().catch(() => {});
      throw new JsonBodyTooLargeError("JSON request too large");
    }
  }
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON request body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new JsonBodyTooLargeError("JSON request too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
