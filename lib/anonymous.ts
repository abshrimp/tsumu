import { envVar } from "./env";

/**
 * Googleログインを設定していないときに、ログインなしで開いてよいか。
 * ログインなしでは URL を知っている人が誰でも編集・公開できるため、`npm run dev` 以外では
 * ALLOW_ANONYMOUS=true で明示したときだけ許す（デモや、手元だけで動かすとき）。
 * middleware（Edge）からも呼ぶので、Node.js 専用のモジュールは読み込まない
 */
export function anonymousAllowed(bindings?: { ALLOW_ANONYMOUS?: string }): boolean {
  return process.env.NODE_ENV === "development" ||
    (bindings ? bindings.ALLOW_ANONYMOUS : envVar("ALLOW_ANONYMOUS")) === "true";
}

/** 接続時の本人確認方法が、現在のログイン設定でも有効か。 */
export function collaborationIdentityAllowed(
  hasUser: boolean, signInConfigured: boolean, bindings?: { ALLOW_ANONYMOUS?: string },
): boolean {
  return signInConfigured ? hasUser : !hasUser && anonymousAllowed(bindings);
}
