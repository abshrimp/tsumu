import { isTranslatedMessage } from "./i18n";

/** 日本語の文字（自分たちで書いた案内文かどうかの目安） */
const JA = /[぀-ヿ㐀-鿿]/;

/**
 * 画面に出してよいエラー文にする。日本語で書いた案内文（とその訳）だけをそのまま使い、
 * 英語の内部エラー（"Failed to fetch" やDBのエラーなど）は fallback に置き換える
 */
export function userMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (msg && (JA.test(msg) || isTranslatedMessage(msg))) return msg;
  if (e) console.error(e);
  return fallback;
}
