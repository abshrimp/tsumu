import { expect, test } from "@playwright/test";

for (const width of [240, 288]) {
  test(`出力タグの項目と説明を折り返さず省略する（パネル幅 ${width}px）`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((width) => {
      localStorage.setItem("tsumu-help-seen-v1", "1");
      localStorage.setItem("panel-r-w", String(width));
    }, width);
    const response = await page.request.post("/api/sites", { data: { name: "Output tag ellipsis" } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    await page.goto(`/sites/${site.id}`);
    await page.locator('[data-tutorial="layers-panel"]').getByText("ヒーロー", { exact: true }).click();
    await page.locator('[data-tutorial="right-tab-settings"]').click();
    const trigger = page.locator('[data-tutorial="settings-semantic"] .dd');
    const menu = page.locator(".dd-menu");
    await trigger.click();
    await expect(menu).toBeVisible();

    // 長い説明も一行のまま、全項目で上下の余白・全文・選択操作を保つ。
    const items = menu.locator(".dd-item");
    await expect(items).toHaveCount(12);
    const measurements = await items.evaluateAll((buttons) => buttons.map((button) => {
      const label = button.querySelector<HTMLElement>(".dd-col > span")!;
      const desc = button.querySelector<HTMLElement>(".dd-desc")!;
      const row = button.getBoundingClientRect();
      const col = button.querySelector(".dd-col")!.getBoundingClientRect();
      const style = getComputedStyle(desc);
      return {
        label: label.textContent!,
        desc: desc.textContent!,
        title: button.getAttribute("title"),
        whiteSpace: style.whiteSpace,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        height: desc.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        top: col.top - row.top,
        bottom: row.bottom - col.bottom,
        truncated: desc.scrollWidth > desc.clientWidth,
      };
    }));
    expect(measurements.some((item) => item.truncated)).toBe(true);
    for (const item of measurements) {
      expect(item.whiteSpace).toBe("nowrap");
      expect(item.overflow).toBe("hidden");
      expect(item.textOverflow).toBe("ellipsis");
      expect(item.height).toBeCloseTo(item.lineHeight, 0);
      expect(item.top).toBeGreaterThanOrEqual(4);
      expect(item.bottom).toBeGreaterThanOrEqual(4);
      expect(item.title).toBe(`${item.label}\n${item.desc}`);
    }

    const label = "インラインテキスト（span）";
    await menu.getByRole("button", { name: new RegExp(label) }).click();
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName(label);
    await expect(trigger).toHaveAttribute("title", label);
    await expect(trigger.locator(".dd-label")).toHaveCSS("white-space", "nowrap");
    await expect(trigger.locator(".dd-label")).toHaveCSS("text-overflow", "ellipsis");

    // 再度開いたときの選択表示と、Escape・外側クリック・再選択を確認する。
    await trigger.click();
    await expect(menu.locator(".is-sel")).toContainText(label);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await page.locator('[data-tutorial="right-tab-settings"]').click();
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await menu.getByRole("button", { name: /^カスタム/ }).click();
    await expect(page.locator('[data-tutorial="settings-semantic"] input')).toBeVisible();
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
