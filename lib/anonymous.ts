import { envVar } from "./env";

/**
 * Google ログインを設定していないときに、ログインなしで開いてよいか。
 * ログインなしでは、URL を知っている人が誰でも編集・公開できるため、`npm run dev` 以外では
 * ALLOW_ANONYMOUS=true で明示したときだけ許す（デモや、手元だけで動かすとき）。
 * middleware（Edge）からも呼ぶため、Node.js 専用のモジュールは読み込まない
 */
export function anonymousAllowed(bindings?: { ALLOW_ANONYMOUS?: string }): boolean {
  return process.env.NODE_ENV === "development" ||
    (bindings ? bindings.ALLOW_ANONYMOUS : envVar("ALLOW_ANONYMOUS")) === "true";
}

/**
 * ログインなしの要求を、この Host 宛てとして受け付けてよいか。
 * `npm run dev` が設定なしでログインなしにしているときは、手元のブラウザ（localhost）からだけ受け付ける。
 * 悪意のあるサイトが自分のドメインを 127.0.0.1 に向け直す（DNS rebinding）と、同じオリジンとして
 * API を呼べてしまい、CSRF の検査では防げないため。ほかの端末から開くときは ALLOW_ANONYMOUS=true を明示する。
 */
export function anonymousHostAllowed(host: string | null): boolean {
  if (process.env.NODE_ENV !== "development" || envVar("ALLOW_ANONYMOUS") === "true") return true;
  return host !== null && isLoopbackHost(host);
}

/** localhost・127.0.0.0/8・[::1] を指す Host ヘッダーか（ポートは問わない）。 */
export function isLoopbackHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "[::1]" ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(name);
}

/** 接続したときの本人確認の方法が、現在のログインの設定でも有効か。 */
export function collaborationIdentityAllowed(
  hasUser: boolean, signInConfigured: boolean, bindings?: { ALLOW_ANONYMOUS?: string },
): boolean {
  return signInConfigured ? hasUser : !hasUser && anonymousAllowed(bindings);
}
