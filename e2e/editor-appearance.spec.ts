import { expect, test } from "@playwright/test";
import { readEditorCss } from "../tests/helpers/editor-css";

test("numeric fields use readable backgrounds in editor dark mode and orange for dark page overrides", async ({ page }) => {
  await page.setContent(`<html><body><aside class="panel-r">
    <div class="grp is-set">
      <span class="grp-label is-set" id="label">Spacing</span>
      <div style="--field: var(--field-base); --field-hover: var(--field-base-hover)">
        <div class="field" id="base"><input aria-label="Inherited margin" /></div>
      </div>
      <div style="--field: var(--field-set); --field-hover: var(--field-set-hover)">
        <div class="field" id="set"><input aria-label="Changed margin" /></div>
      </div>
    </div>
  </aside></body></html>`);
  await page.addStyleTag({ content: readEditorCss() });

  await page.evaluate(() => { document.documentElement.dataset.editorTheme = "dark"; });
  await expect(page.locator("#base")).toHaveCSS("background-color", "rgb(45, 51, 60)");
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(44, 65, 97)");

  await page.locator(".panel-r").evaluate(el => el.classList.add("is-dark"));
  await expect(page.locator("#label")).toHaveCSS("color", "rgb(255, 178, 124)");
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(81, 54, 38)");
  await page.locator("#set input").focus();
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(81, 54, 38)");
  await expect(page.locator("#set")).toHaveCSS("border-color", "rgb(255, 178, 124)");
  await page.locator("#set input").blur();
  await page.locator("#base").hover();
  await expect(page.locator("#base")).toHaveCSS("background-color", "rgb(58, 65, 77)");
  await page.locator("#set").hover();
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(104, 67, 46)");

  await page.mouse.move(0, 0);
  await page.evaluate(() => { document.documentElement.dataset.editorTheme = "light"; });
  await expect(page.locator("#base")).toHaveCSS("background-color", "rgb(240, 244, 249)");
  await expect(page.locator("#set")).toHaveCSS("background-color", "rgb(255, 232, 214)");
  await expect(page.locator("#label")).toHaveCSS("color", "rgb(194, 65, 12)");
});

test("home and editor share appearance preference without changing page theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  await page.goto("/");
  await page.locator(".home-top .home-top-btn").filter({ hasText: "設定" }).click();
  const homeSettings = page.locator(".home-dialog");
  await expect(homeSettings.locator(".appearance-seg")).toBeVisible();
  await homeSettings.locator(".appearance-seg").getByRole("button", { name: "ダークモード" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "dark");
  await homeSettings.getByRole("button", { name: "閉じる" }).click();

  const result = await page.request.post("/api/sites", { data: { name: "Appearance sync" } });
  expect(result.ok()).toBeTruthy();
  const { site } = await result.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "dark");
  await expect(page.locator(".hdr-page-theme")).toBeVisible();

  await page.locator(".hdr-page-theme .dd").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "ダークモード" }).click();
  await page.locator(".panel-l .layer-row").first().click();
  await expect(page.locator(".panel-r")).toHaveClass(/is-dark/);
  await expect(page.locator(".panel-r .state-bar-theme")).toHaveText("ダークモードのスタイルを編集中");

  await page.locator(".hdr-more .icon-btn").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: "設定" }).click();
  await page.locator(".modal .appearance-seg").getByRole("button", { name: "ライトモード" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "light");
  await expect(page.locator(".panel-r .state-bar-theme")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tsumu-editor-appearance"))).toBe("light");

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-editor-theme", "light");
  await page.locator(".home-top .home-top-btn").filter({ hasText: "設定" }).click();
  await expect(page.locator(".home-dialog .appearance-seg").getByRole("button", { name: "ライトモード" }))
    .toHaveAttribute("aria-pressed", "true");
});
