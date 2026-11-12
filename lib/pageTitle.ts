/**
 * ページの検索・シェア用のタイトルと、ページ名との連動。
 * ページを追加・複製した直後のタイトルは「まだ決まっていない」ものとして扱い、
 * 初めてページ名を確定したときに1回だけ、タイトルもその名前にする（以降は連動しない）
 */

import { tr } from "./i18n";
import type { Page } from "./types";

/** ページを追加したときに付ける名前（タイトルも同じ） */
export function newPageName(n: number | string): string {
  return tr("Page {n}", { n });
}

/** 編集言語を変えても、英語・日本語で付けた名前と現在の言語の名前を判定できる。 */
export function isAutomaticPageTitle(value: string): boolean {
  const title = value.trim();
  if (/^(?:Page|ページ) \d+$/.test(title)) return true;
  const [prefix, suffix] = newPageName("\u0000").split("\u0000");
  return suffix !== undefined && title.startsWith(prefix) && title.endsWith(suffix) &&
    /^\d+$/.test(title.slice(prefix.length, title.length - suffix.length));
}

/**
 * タイトルがまだ決まっていないか（次にページ名を確定したら、タイトルもその名前にする）。
 */
export function titlePending(page: Pick<Page, "name" | "title" | "titlePending">): boolean {
  return page.titlePending === true;
}

/** ページ名を変える。名前が変わらないとき（欄に触れただけ）は何もしない */
export function renamePage(page: Page, name: string): void {
  if (name === page.name) return;
  if (page.title.trim() && titlePending(page)) page.title = name;
  delete page.titlePending;
  page.name = name;
}

/** タイトルを書き換える（自分で決めたため、以降は連動しない。同じ値なら触れただけなので何もしない） */
export function setPageTitle(page: Page, title: string): void {
  if (title === page.title) return;
  page.title = title;
  delete page.titlePending;
}
