import { expect, test } from "@playwright/test";

test("コンポーネント化を取り消しても、コピーした要素をキーボードで貼り付けられる", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Clipboard history" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();

  const canvas = page.locator('[data-tutorial="canvas"]');
  // プリセットの見出しには、この文字列に続いて二行目の案内も入っている。
  const content = canvas.getByText("見出しをここに");
  await expect(content).toHaveCount(1);
  await page.locator('[data-tutorial="layers-panel"]').getByText("ヒーロー", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "コンポーネント化", exact: true }).click();
  await expect(canvas.locator("[data-instance]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(canvas.locator("[data-instance]")).toHaveCount(0);
  await expect(content).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(content).toHaveCount(2);
  await expect(canvas.getByText("（コンポーネントが見つかりません）", { exact: true })).toHaveCount(0);

  // 依存を含めて貼り付け全体が一回で戻り、やり直しと保存後の再読み込みでも表示される。
  await page.keyboard.press("ControlOrMeta+z");
  await expect(content).toHaveCount(1);
  await expect(canvas.locator("[data-instance]")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(content).toHaveCount(2);
  await expect.poll(async () => {
    const current = await (await page.request.get(`/api/doc?site=${site.id}`)).json();
    return Object.keys(current.doc.components ?? {}).length;
  }).toBe(1);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  await page.reload();
  await expect(content).toHaveCount(2);
  await expect(canvas.locator("[data-instance]")).toHaveCount(1);
  expect(errors).toEqual([]);
});
