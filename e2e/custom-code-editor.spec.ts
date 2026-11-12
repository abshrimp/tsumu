import { expect, test, type Page } from "@playwright/test";

async function newSite(page: Page, name: string) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name } });
  expect(response.ok()).toBeTruthy();
  const { site } = (await response.json()) as { site: { id: string } };
  await page.goto("/sites/" + site.id);
}

test("site head and body each expand beside their label, without a section button", async ({ page }) => {
  await newSite(page, "Custom code per field");
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const section = page.locator('[data-tutorial="site-code"]');
  await section.locator(".sec-title").click();
  await expect(section.locator(".sec-head .code-editor-button")).toHaveCount(0);
  await expect(section.locator(".code-field-heading .code-editor-button")).toHaveCount(2);
  await section.getByRole("button", { name: "head内コード: コードエディタで編集" }).click();
  const dialog = page.getByRole("dialog", { name: /head内コード.*コードエディタ/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".custom-code-tabs")).toHaveCount(0);
  const source = '<style>.hero { color: red; }</style><script>const answer = "ok";</script>';
  await dialog.getByRole("textbox", { name: "head内コード" }).fill(source);
  await expect(dialog.locator(".code-token-tag").first()).toBeVisible();
  await expect(dialog.locator(".code-token-property")).toContainText("color");
  await expect(dialog.locator(".code-token-keyword")).toContainText("const");
  expect(await dialog.locator(".custom-code-highlight code").evaluate(el => el.textContent)).toBe(source + "\n");
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeGreaterThan(viewport.width * 0.8);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.8);
  await dialog.getByRole("button", { name: "適用" }).click();

  await expect(page.locator("#site-head-code")).toHaveValue(source);
  await expect(page.locator("#site-body-code")).toHaveValue("");
  await section.getByRole("button", { name: "body末尾コード: コードエディタで編集" }).click();
  const bodyDialog = page.getByRole("dialog", { name: /body末尾コード.*コードエディタ/ });
  await bodyDialog.getByRole("textbox", { name: "body末尾コード" }).fill("<script>window.x = 1</script>");
  await bodyDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.locator("#site-body-code")).toHaveValue("");
  await expect(page.locator("#site-head-code")).toHaveValue(source);
});

test("page head and end code have independent enlargement buttons next to labels", async ({ page }) => {
  await newSite(page, "Page custom code");
  const section = page.locator('[data-tutorial="page-code"]');
  await section.locator(".sec-title").click();
  await expect(section.locator(".sec-head .code-editor-button")).toHaveCount(0);
  await section.getByRole("button", { name: "先頭コード（このページのみ）: コードエディタで編集" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "先頭コード（このページのみ）" }).fill("<meta name='test' content='head'>");
  await dialog.getByRole("button", { name: "適用" }).click();
  await section.getByRole("button", { name: "末尾コード（このページのみ）: コードエディタで編集" }).click();
  await dialog.getByRole("textbox", { name: "末尾コード（このページのみ）" }).fill("<script>window.test = 1</script>");
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(section.locator('[id$="-top"]')).toHaveValue("<meta name='test' content='head'>");
  await expect(section.locator('[id$="-end"]')).toHaveValue("<script>window.test = 1</script>");
});

test("raw HTML uses a full-size syntax-highlighted modal without executing HTML", async ({ page }) => {
  await newSite(page, "HTML page editor");
  const section = page.locator('[data-tutorial="page-code"]');
  await section.locator(".sec-title").click();
  await section.locator(".seg").getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByRole("button", { name: "切り替える", exact: true }).click();
  await section.getByRole("button", { name: "HTMLコード: コードエディタで編集" }).click();
  const dialog = page.getByRole("dialog", { name: /HTMLコード.*コードエディタ/ });
  const html = "<!doctype html>\n<html><body><img src=x data-onerror=example><!-- note --><script>const x = 1</script></body></html>";
  await dialog.getByRole("textbox", { name: "HTMLコード" }).fill(html);
  await expect(dialog.locator(".custom-code-highlight img")).toHaveCount(0);
  await expect(dialog.locator(".custom-code-highlight script")).toHaveCount(0);
  expect(await dialog.locator(".custom-code-highlight code").evaluate(el => el.textContent)).toBe(html + "\n");
  await dialog.getByRole("button", { name: "適用" }).click();
  await expect(section.locator('[id$="-rawhtml"]')).toHaveValue(html);
});
