/**
 * ほかのサイトから送られてきた、状態を変えるリクエストか（CSRF対策。middleware.ts で使う）。
 * ブラウザの Fetch Metadata と Origin を組み合わせる。異なる scheme の同一ホストも
 * 別オリジンであり、特にローカル・認証なしのエディタでは書き込みを許してはならない。
 */
export function isCrossSiteWrite(req: {
  method: string;
  headers: Headers;
  nextUrl: { host: string; protocol?: string };
}): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return false;

  const site = req.headers.get("sec-fetch-site");
  // site はブラウザが設定する。same-site（サブドメインや http/https の違い）は許可しない。
  if (site !== null && site !== "same-origin" && site !== "none") return true;

  const origin = req.headers.get("origin");
  // Origin を送らない非ブラウザクライアントや、一部の同一オリジンリクエストを維持する。
  // ブラウザ発のクロスサイト書き込みには Origin または Sec-Fetch-Site が付く。
  // 明示された空の値は「ヘッダーなし」ではなく、不正な Origin として拒否する。
  if (origin === null) return false;
  try {
    const parsed = new URL(origin);
    // Origin ヘッダーは scheme + authority だけ。null、パス、ユーザー情報は認めない。
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) return true;

    // NextRequest の公開 URL を優先する。Host がリバースプロキシ内部名でも
    // Sec-Fetch-Site に依存せず正しい Origin を認識できる。
    const forwarded = req.headers.get("x-forwarded-host");
    const host = forwarded ?? req.nextUrl.host ?? req.headers.get("host");
    // Host は authority のみ。URL パーサーが userinfo・パス・空白などを
    // 捨てて別の値へ正規化する前に拒否し、意図しない Origin を許可しない。
    if (!host || /[,/\\?#@\s]/.test(host)) return true;

    const forwardedProto = req.headers.get("x-forwarded-proto");
    const protocol = forwardedProto ?? req.nextUrl.protocol;
    if (!protocol) return parsed.host !== host; // 次のURLを持たない単体テスト用
    if (!/^https?:?$/i.test(protocol)) return true;
    const scheme = protocol.endsWith(":") ? protocol : `${protocol}:`;
    return parsed.origin !== new URL(`${scheme}//${host}`).origin;
  } catch {
    return true;
  }
}
