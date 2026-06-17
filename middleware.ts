import { NextResponse, type NextRequest } from "next/server";
import { middlewareAuth, authConfigured } from "./auth";
import { langOfRequest } from "./lib/lang";
import { isCrossSiteWrite } from "./lib/csrf";
import { anonymousAllowed } from "./lib/anonymous";

export default async function middleware(req: NextRequest) {
  // 辞書を読み込むと大きくなるため、ここで出す文だけを持つ（日本語以外は英語）
  const en = langOfRequest(req) !== "ja";
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") && isCrossSiteWrite(req)) {
    return NextResponse.json({ error: en ? "Cross-site requests are not allowed" : "ほかのサイトからのリクエストは受け付けません" }, { status: 403 });
  }
  // Google認証が未設定なら、ALLOW_ANONYMOUS=true（または npm run dev）のときだけログインなしで開ける
  //（URLを知っている人は誰でも編集・公開できる）
  if (!authConfigured()) {
    if (!anonymousAllowed()) return setupRequired(pathname, en);
    if (pathname === "/login") return NextResponse.redirect(new URL("/", req.nextUrl));
    return NextResponse.next();
  }

  // 期限付きの署名URLのアセット（HTMLページのプレビュー用）は、署名をルートで確かめる
  if (pathname === "/api/assets/file" && req.nextUrl.searchParams.has("sig")) {
    return NextResponse.next();
  }

  const session = await middlewareAuth();

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL("/", req.nextUrl));
    return NextResponse.next();
  }

  if (!session) {
    // APIにはリダイレクトではなくJSONで401を返す
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: en ? "You need to sign in" : "ログインが必要です" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  return NextResponse.next();
}

/** ログインもログインなしの許可も無いときの応答（設定の手順を案内する） */
function setupRequired(pathname: string, en: boolean): NextResponse {
  const message = en
    ? "Sign-in is not configured. Set AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or set ALLOW_ANONYMOUS=true to let anyone with the URL edit and publish."
    : "ログインが設定されていません。AUTH_SECRET・AUTH_GOOGLE_ID・AUTH_GOOGLE_SECRET を設定するか、URLを知っている人が誰でも編集・公開できる状態で動かすなら ALLOW_ANONYMOUS=true を設定してください。";
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 503 });
  }
  const title = en ? "Sign-in is not configured" : "ログインが設定されていません";
  const html = `<!doctype html><html lang="${en ? "en" : "ja"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Tsumu</title><style>body{font:15px/1.7 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;color:#1f1f1f}h1{font-size:20px}code{background:#f1f3f4;padding:1px 5px;border-radius:4px}a{color:#0b57d0}</style></head><body><h1>${title}</h1><p>${message.replace(/(AUTH_[A-Z_]+|ALLOW_ANONYMOUS=true)/g, "<code>$1</code>")}</p><p><a href="https://github.com/abshrimp/tsumu${en ? "#google-sign-in" : "/blob/main/README.ja.md#googleログイン"}">README</a></p></body></html>`;
  return new NextResponse(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const config = {
  // robots.txt は認証なしで配信する（クローラに Disallow を返すため）
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
