// Limit the entire multipart stream before the platform builds its FormData.
// A file-size check alone cannot bound other fields or a chunked request.
export async function readAssetForm(req: Request, maxBytes: number): Promise<FormData | null> {
  if (Number(req.headers.get("content-length")) > maxBytes) {
    await req.body?.cancel().catch(() => {});
    throw new RangeError("Upload too large");
  }
  if (!req.body) return null;
  let length = 0;
  const body = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      length += chunk.byteLength;
      if (length > maxBytes) throw new RangeError("Upload too large");
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(body, { headers: req.headers }).formData();
  } catch {
    if (length > maxBytes) throw new RangeError("Upload too large");
    return null;
  }
}
