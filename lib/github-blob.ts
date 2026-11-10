/**
 * Request body for GitHub's create-blob API (`POST /git/blobs`).
 *
 * The body is built by concatenation, not `JSON.stringify`: escaping a 25 MiB
 * asset's ~34 MiB base64 string costs ~80 ms of CPU, far past the 10 ms limit
 * of Workers Free, while concatenation is effectively free. Base64 produced
 * by `Buffer` contains only `A-Z a-z 0-9 + / =`, none of which JSON escapes.
 */
export function gitBlobRequestBody(content: Uint8Array): string {
  const base64 = Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("base64");
  return '{"content":"' + base64 + '","encoding":"base64"}';
}
