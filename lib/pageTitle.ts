/**
 * ページの検索・シェア用タイトルと、ページ名との連動。
 * ページを追加・複製した直後のタイトルは「まだ決まっていない」扱いで、
 * 初めてページ名を確定したときに1回だけタイトルもその名前にする（以降は連動しない）
 */

import { tr } from "./i18n";
import type { Page } from "./types";

/** ページを追加したときに付ける名前（タイトルも同じ） */
export const NEW_PAGE_NAME = "ページ {n}";

/**
 * 自動で付けた文字か（ページの追加で付く「ページ 3」など）。
 * 作ったときの表示言語で保存されるので、日本語の形といまの言語の形の両方を見る
 */
export function autoNamed(value: string, template: string): boolean {
  const mark = "\u0000";
  return [template.replace("{n}", mark), tr(template, { n: mark })].some((form) => {
    const re = form
      .split(mark)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\d+");
    return new RegExp(`^${re}$`).test(value.trim());
  });
}

/**
 * タイトルがまだ決まっていないか（次にページ名を確定したら、タイトルもその名前にする）。
 */
export function titlePending(page: Pick<Page, "name" | "title" | "titlePending">): boolean {
  return page.titlePending === true;
}

/** ページ名を変える。名前が変わらないとき（欄を触っただけ）は何もしない */
export function renamePage(page: Page, name: string): void {
  if (name === page.name) return;
  if (page.title.trim() && titlePending(page)) page.title = name;
  delete page.titlePending;
  page.name = name;
}

/** タイトルを書き換える（自分で決めたので、以降は連動しない。同じ値なら触っただけなので何もしない） */
export function setPageTitle(page: Page, title: string): void {
  if (title === page.title) return;
  page.title = title;
  delete page.titlePending;
}
