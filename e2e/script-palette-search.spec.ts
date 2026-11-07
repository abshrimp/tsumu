import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { scriptDataPickerBundle } from "../tests/helpers/script-data-picker";

let bundle: string;
test.beforeAll(async () => { bundle = await scriptDataPickerBundle(); });
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

const palette = (page: Page) => page.locator('[data-tutorial="se-palette"]');

test("検索欄のフォーカスは入力欄と外枠に二重表示されない", async ({ page }) => {
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  const wrapper = palette(page).locator(".se-pal-search");
  const unfocusedBorder = await wrapper.evaluate((el) => getComputedStyle(el).borderTopColor);

  await search.focus();
  await expect(search).toBeFocused();
  const styles = await search.evaluate((input) => {
    const searchBox = input.closest(".se-pal-search")!;
    return {
      focusVisible: input.matches(":focus-visible"),
      inputOutlineStyle: getComputedStyle(input).outlineStyle,
      inputBoxShadow: getComputedStyle(input).boxShadow,
      wrapperBorder: getComputedStyle(searchBox).borderTopColor,
      wrapperBorderWidth: getComputedStyle(searchBox).borderTopWidth,
    };
  });
  expect(styles.focusVisible).toBe(true);
  expect(styles.inputOutlineStyle).toBe("none");
  expect(styles.inputBoxShadow).toBe("none");
  expect(styles.wrapperBorderWidth).toBe("1px");
  expect(styles.wrapperBorder).not.toBe(unfocusedBorder);
});

test("検索文字の有無で高さが変わらず、クリア操作は1つだけ", async ({ page }) => {
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  const wrapper = palette(page).locator(".se-pal-search");
  // The workspace uses CSS zoom. boundingBox() includes transient zoom changes
  // during the initial opening, so measure the element's actual CSS box instead.
  const height = () => wrapper.evaluate((el) => (el as HTMLElement).offsetHeight);
  const before = await height();
  await expect(wrapper).toHaveCSS("height", "36px");
  await search.fill("件数");
  await expect(palette(page).getByRole("button", { name: "検索をクリア" })).toHaveCount(1);
  expect(await height()).toBe(before);
  await expect(search).toHaveCSS("appearance", "none");
  await palette(page).getByRole("button", { name: "検索をクリア" }).click();
  await expect(search).toHaveValue("");
  expect(await height()).toBe(before);
  await expect(palette(page).getByRole("button", { name: "検索をクリア" })).toHaveCount(0);
});

test("用途を検索して必要なブロックを探せる。検索しても文書と登録形式は変わらない", async ({ page }) => {
  const before = await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc));
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  const cards = palette(page).locator(".se-pal-item");
  const originalCount = await cards.count();
  expect(originalCount).toBeGreaterThan(25);

  await search.fill("数える");
  await expect(cards).toHaveCount(1);
  await expect(palette(page).locator('[data-tutorial="se-block-count"]')).toBeVisible();
  await expect(palette(page).locator(".se-pal-title")).toHaveText(["リスト"]);

  await search.fill("API");
  await expect(cards).toHaveCount(1);
  await expect(palette(page).locator('[data-tutorial="se-block-fetch"]')).toBeVisible();

  await search.fill("保存");
  await expect(palette(page).locator('[data-tutorial="se-block-store-save"]')).toBeVisible();

  await search.fill("該当しない操作987654");
  await expect(cards).toHaveCount(0);
  await expect(palette(page).getByRole("status")).toHaveText("一致する操作がありません");

  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(originalCount);
  expect(await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc))).toBe(before);
});

test("旧称でも検索でき、検索クリア後に全てのカテゴリが戻る", async ({ page }) => {
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  await search.fill("配列");
  await expect(palette(page).locator('[data-tutorial="se-block-count"]')).toBeVisible();
  await expect(palette(page).locator('[data-tutorial="se-block-fetch"]')).toHaveCount(0);
  await expect(palette(page).locator(".se-pal-title")).toHaveText(["リスト"]);

  await palette(page).getByRole("button", { name: "検索をクリア" }).click();
  await expect(search).toHaveValue("");
  await expect(palette(page).locator('[data-tutorial="se-block-fetch"]')).toBeVisible();
  await expect(palette(page).locator(".se-pal-title").first()).toHaveText("きっかけ");
});


test("目的や言い換えから関連する操作が見つかる", async ({ page }) => {
  const search = palette(page).getByRole("searchbox", { name: "操作を探す" });
  const cases: [string, string][] = [
    ["タップ", "click"],
    ["マウスオーバー", "hover-start"],
    ["スクロールで出現", "in-view"],
    ["値が変わったとき", "change"],
    ["REST", "fetch"],
    ["URLに飛ぶ", "open-page"],
    ["アンカーへ移動", "scroll-to"],
    ["入力禁止", "set-enabled"],
    ["カンマ区切り", "split"],
    ["項目数", "count"],
    ["1件取得", "array-find"],
    ["各項目に追加", "array-field"],
    ["フィルター解除", "unfilter-array"],
    ["価格順", "sort-array"],
    ["ローカルストレージ", "store-save"],
    ["前回の値を読む", "store-load"],
    ["足し算", "calc"],
    ["正規表現", "replace"],
    ["クリップボード", "copy"],
    ["一定時間停止", "wait"],
    ["条件分岐", "if"],
    ["無限ループ", "repeat"],
  ];
  for (const [query, key] of cases) {
    await search.fill(query);
    await expect(palette(page).locator(`[data-tutorial="se-block-${key}"]`), query).toBeVisible();
  }
});
