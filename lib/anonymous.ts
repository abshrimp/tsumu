import { envVar } from "./env";

/**
 * Googleログインを設定していないときに、ログインなしで開いてよいか。
 * ログインなしでは URL を知っている人が誰でも編集・公開できるため、`npm run dev` 以外では
 * ALLOW_ANONYMOUS=true で明示したときだけ許す（デモや、手元だけで動かすとき）。
 * middleware（Edge）からも呼ぶので、Node.js 専用のモジュールは読み込まない
 */
export function anonymousAllowed(): boolean {
  return process.env.NODE_ENV === "development" || envVar("ALLOW_ANONYMOUS") === "true";
}
