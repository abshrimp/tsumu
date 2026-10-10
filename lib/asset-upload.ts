// プラットフォームが FormData を組み立てる前に、multipart のストリーム全体に上限をかける。
// ファイルの大きさを確かめるだけでは、他の項目や chunked のリクエストを抑えられない。
export async function readAssetForm(req: Request, maxBytes: number): Promise<FormData | null> {
  if (Number(req.headers.get("content-length")) > maxBytes) {
    // 複製したリクエストは、もう一方の分岐が終わるまで取り消しを完了できない。
    // 大きすぎるアップロードへの応答を止めたままにせず、こちらの受信だけを止める。
    void req.body?.cancel().catch(() => {});
    throw new RangeError("Upload too large");
  }
  if (!req.body) return null;
  const type = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "multipart/form-data") {
    // ファイルを含められない形式は、本文の到着を待たずに受信を止める。
    void req.body.cancel().catch(() => {});
    return null;
  }
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
