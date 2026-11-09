const utf8Encoder = new TextEncoder();

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const clean = value.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(clean, "base64");
    const out = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out;
  }
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(utf8Encoder.encode(text));
}
