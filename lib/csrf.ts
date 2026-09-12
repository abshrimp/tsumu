/**
 * 他のサイトから送られてきた、状態を変えるリクエストか（CSRF 対策。middleware.ts で使う）。
 * ブラウザの Fetch Metadata と Origin を組み合わせて判定する。scheme の異なる同じホストも
 * 別のオリジンで、特にローカルの認証なしのエディタでは、書き込みを許してはならない。
 */
export function isCrossSiteWrite(req: {
  method: string;
  headers: Headers;
  nextUrl: { host: string; protocol?: string };
}): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return false;

  const site = req.headers.get("sec-fetch-site");
  // Sec-Fetch-Site はブラウザが設定する。same-site（サブドメインや http/https の違い）は許可しない。
  if (site !== null && site !== "same-origin" && site !== "none") return true;

  const origin = req.headers.get("origin");
  // Origin を送らないブラウザ以外のクライアントや、一部の同じオリジンからのリクエストは通す。
  // ブラウザが送る別のサイトからの書き込みには、Origin か Sec-Fetch-Site が付く。
  // 明示的に空の値が送られた場合は、「ヘッダーなし」ではなく不正な Origin として拒否する。
  if (origin === null) return false;
  try {
    const parsed = new URL(origin);
    // Origin ヘッダーは scheme と authority だけで構成される。null、パス、ユーザー情報は認めない。
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) return true;

    // NextRequest の公開 URL を優先する。Host がリバースプロキシの内部の名前でも、
    // Sec-Fetch-Site に頼らずに正しい Origin を判定できる。
    const forwarded = req.headers.get("x-forwarded-host");
    const host = forwarded ?? req.nextUrl.host ?? req.headers.get("host");
    // Host は authority だけで構成される。URL のパーサーが userinfo・パス・空白などを
    // 取り除いて別の値に正規化する前に拒否し、意図しない Origin を許可しない。
    if (!host || /[,/\\?#@\s]/.test(host)) return true;

    const forwardedProto = req.headers.get("x-forwarded-proto");
    const protocol = forwardedProto ?? req.nextUrl.protocol;
    if (!protocol) return parsed.host !== host; // nextUrl を持たない単体テスト用
    if (!/^https?:?$/i.test(protocol)) return true;
    const scheme = protocol.endsWith(":") ? protocol : `${protocol}:`;
    return parsed.origin !== new URL(`${scheme}//${host}`).origin;
  } catch {
    return true;
  }
}
