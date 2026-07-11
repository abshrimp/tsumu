/**
 * ほかのサイトから送られてきた、状態を変えるリクエストか（CSRF対策。middleware.ts で使う）。
 * ブラウザは別のサイトからの POST などに Origin・Sec-Fetch-Site を付ける。
 * ログインを使っていない（Cookie で守れない）ときも、ローカルで開いたエディタを
 * 別のサイトから操作されないようにする
 */
export function isCrossSiteWrite(req: { method: string; headers: Headers; nextUrl: { host: string } }): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return false;
  // 今のブラウザは Sec-Fetch-Site を必ず付けるので、あればそれだけで決める。
  // リバースプロキシが Host を内部の名前に書き換えていても、エディタ自身のリクエストを止めないように
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  // 付けない古いブラウザは、Origin とホスト名を比べる
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
