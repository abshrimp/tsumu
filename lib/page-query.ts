/**
 * ページの振り分け条件。受信URLの URLSearchParams.get() / searchParams と同じく、
 * 同じキーが複数ある場合は最初の値を使う。保存済みURLやデータ用の変数は変更しない。
 */
export function pageQueryConditions(query: string | undefined): [string, string][] {
  const conditions = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(query ?? "")) {
    if (key && !conditions.has(key)) conditions.set(key, value);
  }
  return [...conditions];
}
