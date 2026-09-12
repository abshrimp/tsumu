/**
 * ページの振り分けの条件。受け取った URL の URLSearchParams.get() や searchParams と同じく、
 * 同じキーが複数ある場合は最初の値を使う。保存済みの URL やデータ用の変数は変えない。
 */
export function pageQueryConditions(query: string | undefined): [string, string][] {
  const conditions = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(query ?? "")) {
    if (key && !conditions.has(key)) conditions.set(key, value);
  }
  return [...conditions];
}
