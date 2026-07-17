import { expect, test } from "@playwright/test";

test("Site and page language settings accept suggested and custom values and survive saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Custom languages" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.locator('[data-tutorial="left-tab-site"]').click();

  const siteSettings = page.locator('[data-tutorial="site-basics"]');
  const siteSelect = siteSettings.getByRole("combobox", { name: "言語", exact: true });
  const siteCode = siteSettings.getByRole("textbox", { name: "カスタム言語コード" });
  const readDoc = async () => (await (await page.request.get(`/api/doc?site=${site.id}`)).json()).doc;

  await expect(siteSelect).toHaveValue("ja");
  await siteSelect.selectOption({ label: "カスタム…" });
  await siteCode.fill(" pt-BR ");
  await siteCode.press("Enter");
  await expect(siteCode).toHaveValue("pt-BR");
  await expect.poll(async () => (await readDoc()).lang).toBe("pt-BR");

  for (const invalid of ["", "en_US", "not a language", '<script>']) {
    await siteCode.fill(invalid);
    await siteCode.press("Enter");
    await expect(siteCode).toHaveAttribute("aria-invalid", "true");
    await expect(siteSettings.getByRole("alert")).toContainText("変更は保存されていません");
    expect((await readDoc()).lang).toBe("pt-BR");
  }
  await siteCode.press("Escape");
  await expect(siteCode).toHaveValue("pt-BR");
  await expect(siteSettings.getByRole("alert")).toHaveCount(0);

  await siteSelect.selectOption("en");
  await expect(siteCode).toHaveCount(0);
  await expect.poll(async () => (await readDoc()).lang).toBe("en");
  await page.locator('[data-tutorial="undo"]').click();
  await expect(siteCode).toHaveValue("pt-BR");

  const pageSettings = page.locator('[data-tutorial="page-settings"]');
  const pageSelect = pageSettings.getByRole("combobox", { name: "言語", exact: true });
  const pageCode = pageSettings.getByRole("textbox", { name: "カスタム言語コード" });
  await expect(pageSelect).toHaveValue("");
  await expect(pageSelect.locator('option[value=""]')).toHaveText("サイトと同じ（pt-BR）");
  await pageSelect.selectOption({ label: "カスタム…" });
  await pageCode.fill("en-US");
  await pageCode.press("Enter");
  await expect.poll(async () => { const doc = await readDoc(); return doc.pages[doc.pageOrder[0]].lang; }).toBe("en-US");

  // Existing custom language values can still be edited after reload.
  await page.reload();
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.locator('[data-tutorial="left-tab-site"]').click();
  await expect(siteCode).toHaveValue("pt-BR");
  await expect(pageCode).toHaveValue("en-US");
  await pageSelect.selectOption("");
  await expect(pageCode).toHaveCount(0);
  await expect.poll(async () => { const doc = await readDoc(); return doc.pages[doc.pageOrder[0]].lang; }).toBeUndefined();
  expect((await readDoc()).lang).toBe("pt-BR");
  expect(errors).toEqual([]);
});
