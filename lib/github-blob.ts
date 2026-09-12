/**
 * GitHub の blob を作る API（`POST /git/blobs`）のリクエストの本文。
 *
 * 本文は `JSON.stringify` ではなく、文字列の連結で組み立てる。25 MiB のアセットの約 34 MiB の
 * base64 の文字列をエスケープすると CPU を約 80 ms 使い、Workers の無料プランの 10 ms の上限を
 * 大きく超えるが、連結ならほぼ負担が無い。`Buffer` が作る base64 は `A-Z a-z 0-9 + / =` だけで
 * 構成され、どれも JSON でエスケープされない。
 */
export function gitBlobRequestBody(content: Uint8Array): string {
  const base64 = Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("base64");
  return '{"content":"' + base64 + '","encoding":"base64"}';
}
