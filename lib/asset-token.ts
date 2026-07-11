import { envVar } from "./env";

/**
 * アセットの期限付きURL（ログインの Cookie を送れない場所から読むため）。
 * HTMLページのプレビューは、中のスクリプトがエディタの権限を使えないよう別オリジン（sandbox）で表示する。
 * そこからは Cookie が送られないので、パスごとに署名した期限付きのURLで読ませる
 */

/** 期限（1時間。プレビューを開き直せば作り直す） */
export const ASSET_TOKEN_TTL = 60 * 60 * 1000;

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = envVar("AUTH_SECRET");
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`asset-url\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

const toB64Url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64Url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** 署名したクエリ（"exp=…&sig=…"）。署名の鍵が無い（ログインを使っていない）なら null */
export async function signAssetPath(path: string, now = Date.now()): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  const exp = now + ASSET_TOKEN_TTL;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${path}\n${exp}`));
  return `exp=${exp}&sig=${toB64Url(sig)}`;
}

/** 署名が正しく、期限内か */
export async function verifyAssetToken(
  path: string,
  exp: string | null,
  sig: string | null,
  now = Date.now()
): Promise<boolean> {
  if (!exp || !sig || !/^\d{1,16}$/.test(exp) || Number(exp) < now) return false;
  const key = await hmacKey();
  const bytes = fromB64Url(sig);
  if (!key || !bytes) return false;
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${path}\n${exp}`));
}
