import { expect, test } from "@playwright/test";
import { aspectRatioDoc } from "../tests/helpers/aspect-ratio";

test("Removing a breakpoint in another editor does not let an in-progress aspect ratio overwrite shared styles", async ({ page: a, browser }, testInfo) => {
  const other = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL), locale: "ja-JP", viewport: { width: 1440, height: 900 },
  });
  try {
    await a.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const created = await a.request.post("/api/sites", { data: { name: "Aspect-ratio collaboration" } });
    expect(created.ok()).toBeTruthy();
    const { site } = await created.json();
    const api = `/api/doc?site=${site.id}`;
    const initial = await (await a.request.get(api)).json();
    const fixture = aspectRatioDoc();
    const seeded = await a.request.put(`${api}${initial.rev ? `&base=${initial.rev}` : ""}`, { data: fixture });
    expect(seeded.ok()).toBeTruthy();
    const events = a.waitForRequest((request) => request.url().includes("/api/collab/events"));
    await a.goto(`/sites/${site.id}`);
    await expect(a.getByText("サーバー保存済み")).toBeVisible();
    await events;
    await a.locator('[data-tutorial="layers-panel"] .layer-name').filter({ hasText: /^a$/ }).click();
    await a.locator('[data-tutorial="breakpoint-sm"]').click();
    await a.locator('[data-tip="最小・最大サイズと縦横比"]').click();
    const ratio = a.locator('input[placeholder="例: 16 / 9"]');
    await expect(ratio).toHaveValue("16 / 9");

    const b = await other.newPage();
    await b.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    await b.goto(`/sites/${site.id}`);
    await expect(b.getByText("サーバー保存済み")).toBeVisible();
    await b.locator('[data-tutorial="left-tab-site"]').click();
    const remove = b.getByRole("button", { name: "スマホを削除", exact: true });
    await expect(remove).toBeVisible();
    await ratio.fill("4 / 3");
    await ratio.evaluate((input) => { (window as any).previousRatioInput = input; });
    await remove.click();
    await expect(b.getByText("サーバー保存済み")).toBeVisible();
    await expect(a.locator('[data-tutorial="breakpoint-sm"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(ratio).toHaveValue("16 / 9");
    expect(await a.evaluate(() => (window as any).previousRatioInput.isConnected)).toBe(false);
    await ratio.focus();
    await a.keyboard.press("Enter");
    const canvas = a.locator('.cv-root [data-node="a"]');
    await expect(canvas).toHaveCSS("aspect-ratio", "16 / 9");
    // API が保存したノードのスタイルは、すべてブレークポイントを削除する前の値と同じまま。
    expect((await (await a.request.get(api)).json()).doc.nodes).toEqual(fixture.nodes);

    await ratio.fill("3 / 2");
    await a.keyboard.press("Enter");
    await expect(canvas).toHaveCSS("aspect-ratio", "3 / 2");
    await expect.poll(async () => (await (await a.request.get(api)).json()).doc.nodes.a.styles.base.default.aspectRatio).toBe("3 / 2");
    await a.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect(ratio).toHaveValue("16 / 9");
    await expect(canvas).toHaveCSS("aspect-ratio", "16 / 9");
    await expect.poll(async () => (await (await a.request.get(api)).json()).doc.nodes.a.styles.base.default.aspectRatio).toBe("16 / 9");
    await a.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(ratio).toHaveValue("3 / 2");
    await expect(canvas).toHaveCSS("aspect-ratio", "3 / 2");
    await expect.poll(async () => (await (await a.request.get(api)).json()).doc.nodes.a.styles.base.default.aspectRatio).toBe("3 / 2");
    expect((await (await a.request.get(api)).json()).doc.nodes.b).toEqual(fixture.nodes.b);
  } finally {
    await other.close();
  }
});
