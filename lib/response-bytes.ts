export class ResponseTooLargeError extends Error {}

/** 長さを示さない応答や、誤った長さを示す応答も含め、上限までのバイトだけを読む。 */
export async function readResponseBytes(response: Response, limit: number, message = "Resource exceeds export size limit."): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get("content-length")) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new ResponseTooLargeError(message);
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) {
        throw new ResponseTooLargeError(message);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    // 読まれていない複製のために上流の後始末が遅れても、こちらの読み手は解放する。
    void reader?.cancel(error).catch(() => {});
    throw error;
  } finally { reader?.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
