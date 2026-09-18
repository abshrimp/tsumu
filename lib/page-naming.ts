import { tr } from "./i18n";
import { pageQueryKey, routeDir } from "./page-query";
import { newPageName } from "./pageTitle";
import type { Page } from "./types";

/**
 * 複製したページの URL。「[slug]」の区切りに文字を足すと使えない URL になるため、
 * その手前の区切りに -copy を付ける（products/[slug] → products-copy/[slug]）
 */
function copySlug(slug: string, n: number): string {
  const suffix = n > 1 ? `copy-${n}` : "copy";
  const segs = slug.split("/");
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i] && segs[i] !== "[slug]") {
      segs[i] += `-${suffix}`;
      return segs.join("/");
    }
  }
  return slug ? `${suffix}/${slug}` : suffix;
}

// 通常のページは異なるクエリ条件で1つのルートを共有できる。
function queryKey(page: Page): string | null {
  return page.rawHtml?.trim() || page.redirectTo !== undefined || page.rewriteTo !== undefined
    ? null : pageQueryKey(page.query);
}

/** 一括複製・コピーでは、既存のページを一度だけ読み、割り当てるたびに索引に追加する。 */
export function createPageNaming(pages: Record<string, Page>) {
  const names = new Set<string>();
  const routes = new Map<string, Set<string> | null>();

  function reserve(name: string, slug: string, query: string | null) {
    names.add(name);
    const path = routeDir(slug);
    const existing = routes.get(path);
    if (query === null || path === "404") routes.set(path, null);
    else if (existing === undefined) routes.set(path, new Set([query]));
    else existing?.add(query);
    return { name, slug };
  }
  for (const page of Object.values(pages)) reserve(page.name, page.slug, queryKey(page));

  return {
    newPage(start: number) {
      let n = start;
      while (names.has(newPageName(n)) || routes.has(`page-${n}`)) n++;
      return reserve(newPageName(n), `page-${n}`, "");
    },
    copy(page: Page, mode: "duplicate" | "transfer") {
      const query = queryKey(page);
      let n = mode === "transfer" ? 0 : 1;
      let slug = n === 0 ? page.slug : copySlug(page.slug, n);
      let used = routes.get(routeDir(slug));
      while (used !== undefined && (used === null || query === null || used.has(query))) {
        slug = copySlug(page.slug, ++n);
        used = routes.get(routeDir(slug));
      }
      // エディタ内の表示名だけが重なる場合、元の URL は保持できる。
      const nameAt = (i: number) => {
        if (i === 0) return page.name;
        if (i === 1) return tr("{name} copy", { name: page.name });
        return tr("{name} copy {n}", { name: page.name, n: i });
      };
      let name = nameAt(n);
      while (names.has(name)) name = nameAt(++n);
      return reserve(name, slug, query);
    },
  };
}
