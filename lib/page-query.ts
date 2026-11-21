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

/** 公開サイトと同じく、クエリの条件が最も多く一致するページを選ぶ。 */
export function queryPage<T extends { query?: string }>(pages: T[], query: URLSearchParams): T | undefined {
  let best = pages[0];
  let score = -1;
  for (const page of pages) {
    const conditions = pageQueryConditions(page.query);
    if (conditions.length > score && conditions.every(([key, value]) => query.get(key) === value)) {
      best = page;
      score = conditions.length;
    }
  }
  return best;
}

/**
 * ページの URL から、app/ の下のフォルダ名を作る。「_」で始まるフォルダは Next.js では
 * 非公開のフォルダ（URL にならない）になるため、URL の「_」を表す %5F で始める
 */
export function routeDir(slug: string): string {
  return slug
    .split("/")
    // 「.」「..」の区切りや使えない文字で、プロジェクトの外を指すパスを作らない（AI や取り込んだデータの URL もここを通る）
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^A-Za-z0-9._~\-\[\]]/g, "-"))
    .map((seg) => (seg.startsWith("_") ? `%5F${seg.slice(1)}` : seg))
    .join("/");
}

/** 生成サイトが比較する条件だけを、キーの順序に左右されない形にする。 */
export function pageQueryKey(query: string | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams(pageQueryConditions(query));
  params.sort();
  return params.toString();
}
