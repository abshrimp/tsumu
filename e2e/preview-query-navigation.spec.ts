import { expect, test } from "@playwright/test";
import { previewQueryDoc } from "../tests/helpers/preview-query-navigation";

for (const slug of ["blog", "posts/[slug]"]) {
  test(`preview URL links and scripts choose the matching ${slug} query page`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const response = await page.request.post("/api/sites", { data: { name: "Preview query navigation" } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    const endpoint = `/api/doc?site=${site.id}`;
    expect((await page.request.put(endpoint, { data: previewQueryDoc(slug) })).ok()).toBeTruthy();
    await page.goto(`/sites/${site.id}`);
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    const saved = (await (await page.request.get(endpoint)).json()).doc;
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    const canvas = page.locator('[data-tutorial="canvas"]');
    await expect(canvas.getByText("Page home", { exact: true })).toBeVisible();
    for (const [link, destination] of [["news-link", "variant1"], ["specific-button", "variant2"], ["archive-link", "variant3"], ["default-link", "variant0"], ["news-link", "variant1"]]) {
      await canvas.getByText(link, { exact: true }).click();
      await expect(canvas.getByText(`Page ${destination}`, { exact: true })).toBeVisible();
      await expect(canvas.getByText("Page home", { exact: true })).toHaveCount(0);
    }
    expect((await (await page.request.get(endpoint)).json()).doc).toEqual(saved);
    expect(errors).toEqual([]);
  });
}
