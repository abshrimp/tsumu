import { envVar } from "./env";

/**
 * アセットの期限付き URL（ログインの Cookie を送れない場所から読むためのもの）。
 * HTMLページのプレビューは、中のスクリプトがエディタの権限を使えないよう、別オリジン（sandbox）で表示する。
 * そこからは Cookie が送られないため、パスごとに署名した期限付きの URL で読ませる
 */

/** 有効期限（1時間。プレビューを開き直せば作り直す） */
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

/** 1回のリクエスト分の署名を、同じ HMAC の鍵と期限で発行する。重複したパスには署名しない。 */
export async function signAssetPaths(
  paths: readonly string[],
  now = Date.now(),
): Promise<Map<string, string | null>> {
  const unique = new Set(paths);
  const key = await hmacKey();
  const tokens = new Map<string, string | null>();
  if (!key) {
    for (const path of unique) tokens.set(path, null);
    return tokens;
  }
  const exp = now + ASSET_TOKEN_TTL;
  const encoder = new TextEncoder();
  for (const path of unique) {
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${path}\n${exp}`));
    tokens.set(path, `exp=${exp}&sig=${toB64Url(sig)}`);
  }
  return tokens;
}

/** 1つのパスに署名する。署名の鍵が無い（認証を使っていない）なら null を返す。 */
export async function signAssetPath(path: string, now = Date.now()): Promise<string | null> {
  return (await signAssetPaths([path], now)).get(path) ?? null;
}

/** 署名が正しく、期限内か */
export async function verifyAssetToken(
  path: string,
  exp: string | null,
  sig: string | null,
  now = Date.now()
): Promise<boolean> {
  // HMAC-SHA256 の Base64URL 表記は、パディング無しで43文字。巨大な入力や正規でない入力を
  // Base64 のデコードや鍵の読み込みに渡さず、公開された GET で過剰な処理が起きないようにする。
  if (!exp || !sig || !/^\d{1,16}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const expiry = Number(exp);
  if (!Number.isSafeInteger(expiry) || expiry < now) return false;
  const bytes = fromB64Url(sig);
  // Base64URL で使われない末尾の2ビットを変えただけの、別の表記は受け付けない。
  if (!bytes || toB64Url(bytes.buffer) !== sig) return false;
  const key = await hmacKey();
  if (!key) return false;
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${path}\n${exp}`));
}
