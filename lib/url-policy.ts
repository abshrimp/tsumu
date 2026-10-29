import { isPrivateHost } from "./safe-fetch";

/** ブラウザが制御文字を取り除く前に検査し、リンクからスクリプトが実行されるのを防ぐ。 */
export function safeNavigationUrl(value: string): string {
  const url = value.trim();
  // 制御文字（ブラウザが取り除く）と「\」（「/」として読まれ、/\evil.com が別のサイトになる）は、
  // スキーム・ホスト・パスを変えられる位置（クエリやフラグメントより前）でだけ拒否する
  const beforeQuery = url.split(/[?#]/, 1)[0];
  if (!url || /[\u0000-\u001f\u007f\\]/.test(beforeQuery) || url.startsWith("//")) return "#";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) return "#";
  if ((scheme === "http" || scheme === "https") && !/^https?:\/\//i.test(url)) return "#";
  return url;
}

/** 301 リダイレクト先に使える安全なサイト内パスまたは公開の http(s) URL か */
export function isSafeRedirectTarget(value: string): boolean {
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false;
  const beforeQuery = url.split(/[?#]/, 1)[0];
  if (beforeQuery.includes("\\")) return false;
  if (/^\/(?![/\\])/.test(url)) return true;
  if (!/^https?:\/\/[^/?#@\\]+(?:[/?#]|$)/i.test(url)) return false;
  const parsed = URL.parse(url);
  return Boolean(parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password);
}

/** リバースプロキシ（rewrite）の中継先に使える公開の http(s) URL か（SSRF・認証情報の埋め込みを防ぐ） */
export function isSafeRewriteTarget(value: string): boolean {
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return false;
  const beforeQuery = url.split(/[?#]/, 1)[0];
  if (beforeQuery.includes("\\") || !/^https?:\/\/[^/?#@\\]+(?:[/?#]|$)/i.test(url)) return false;
  const parsed = URL.parse(url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    return false;
  }
  return !isPrivateHost(parsed.hostname);
}

/** 対応しているインラインの画像・音声・動画のリソースは残し、実行できる URL のスキームは拒否する。 */
export function safeResourceUrl(value: string): string {
  const url = value.trim();
  if (/^data:(?:image|video|audio)\/[a-z0-9.+-]+(?:;[a-z0-9-]+=[a-z0-9-]+)*;base64,[a-z0-9+/=]+(?:#[^\u0000-\u001f\u007f]*)?$/i.test(url)) return url;
  if (/^blob:/i.test(url)) return url;
  return safeNavigationUrl(url);
}

/** メディアの literal な URL パス（\{name} など）は残し、実行できるスキームや権限の偽装は拒否する。 */
export function safeMediaUrl(value: string): string {
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return "#";
  if (/^https?:\/\/[^/?#@\\]+(?:\/|$)/i.test(url)) return url;
  return safeResourceUrl(url);
}

/** ブラウザ用の素の JS。生成したサイトとエディタで判定が一致することは、テストで確かめる。 */
export const NAVIGATION_RUNTIME = String.raw`function safeNavigationUrl(value) {
  var url = value.trim();
  var beforeQuery = url.split(/[?#]/, 1)[0];
  if (!url || /[\u0000-\u001f\u007f\\]/.test(beforeQuery) || url.indexOf("//") === 0) return "#";
  var match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  var scheme = match && match[1].toLowerCase();
  if (scheme && ["http", "https", "mailto", "tel"].indexOf(scheme) < 0) return "#";
  if ((scheme === "http" || scheme === "https") && !/^https?:\/\//i.test(url)) return "#";
  return url;
}`;

export const RESOURCE_URL_RUNTIME = String.raw`function safeResourceUrl(value) {
  var url = value.trim();
  if (/^data:(?:image|video|audio)\/[a-z0-9.+-]+(?:;[a-z0-9-]+=[a-z0-9-]+)*;base64,[a-z0-9+/=]+(?:#[^\u0000-\u001f\u007f]*)?$/i.test(url)) return url;
  if (/^blob:/i.test(url)) return url;
  return safeNavigationUrl(url);
}`;
