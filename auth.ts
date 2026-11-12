import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { envVar } from "./lib/env";
import { authCallbacks } from "./lib/auth-policy";
export { allowedEmails } from "./lib/allowlist";

/**
 * Google 認証の環境変数が揃っているか。揃っていなければ、ログインなしで開ける（proxy.ts）。
 * Cloudflare Workers ではシークレットをリクエストの処理中にしか読めないため、
 * モジュールの読み込み時には評価せず、呼び出すたびに判定する
 */
export function authConfigured(): boolean {
  return Boolean(
    envVar("AUTH_SECRET") &&
      envVar("AUTH_GOOGLE_ID") &&
      envVar("AUTH_GOOGLE_SECRET")
  );
}

// 設定をリクエストごとに遅延評価し、シークレットを実行時に読む
const authConfig = (): NextAuthConfig => ({
  // Vercel 以外のホスト（Cloudflare Workers・Node.js・Docker）で動かすため、ホスト名の信頼を明示する
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

// Proxy では Cookie の検証だけを行い、権限の再確認は各 API の auth() で行う。
// 設定済みの許可リストが更新されても、Cookie の状態だけでアクセスを許可しない。
export const { auth: proxyAuth } = NextAuth(() => ({
  ...authConfig(),
  callbacks: { signIn: authCallbacks.signIn },
}));
