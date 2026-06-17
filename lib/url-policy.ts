/** ブラウザが制御文字を取り除く前に検査し、リンクからのスクリプト実行を防ぐ。 */
export function safeNavigationUrl(value: string): string {
  const url = value.trim();
  // 制御文字（ブラウザが取り除く）と「\」（「/」として読む。/\evil.com が別サイトになる）は、
  // スキーム・ホスト・パスを変えられる位置（クエリ・フラグメントより前）だけで拒む
  const beforeQuery = url.split(/[?#]/, 1)[0];
  if (!url || /[\u0000-\u001f\u007f\\]/.test(beforeQuery) || url.startsWith("//")) return "#";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) return "#";
  if ((scheme === "http" || scheme === "https") && !/^https?:\/\//i.test(url)) return "#";
  return url;
}

/** ブラウザ用の素のJS。生成サイトとエディタの判定の一致はテストで確認する。 */
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
