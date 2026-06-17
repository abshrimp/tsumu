import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { envVar } from "./lib/env";
import { authCallbacks } from "./lib/auth-policy";
export { allowedEmails } from "./lib/allowlist";

/**
 * Google認証の環境変数が揃っているか。揃っていなければ、ログインなしで開ける（middleware.ts）。
 * Cloudflare Workersではシークレットがリクエスト処理中にしか読めないため、
 * モジュール読み込み時に評価せず、毎回関数で判定する
 */
export function authConfigured(): boolean {
  return Boolean(
    envVar("AUTH_SECRET") &&
      envVar("AUTH_GOOGLE_ID") &&
      envVar("AUTH_GOOGLE_SECRET")
  );
}

// 設定を遅延評価（リクエストごと）にして、シークレットを実行時に読む
const authConfig = (): NextAuthConfig => ({
  // Vercel以外のホスト（Cloudflare Workers）ではホスト名の信頼を明示する
  trustHost: true,
  secret: envVar("AUTH_SECRET"),
  providers: [
    Google({
      clientId: envVar("AUTH_GOOGLE_ID"),
      clientSecret: envVar("AUTH_GOOGLE_SECRET"),
    }),
  ],
  callbacks: authCallbacks,
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// Node.js 配備の middleware は Edge で動き、SQLite を読めない。
// ここでは Cookie の検証だけを行い、現在の許可は各 API の auth() で必ず確認する。
export const { auth: middlewareAuth } = NextAuth(() => ({
  ...authConfig(),
  callbacks: { signIn: authCallbacks.signIn },
}));
