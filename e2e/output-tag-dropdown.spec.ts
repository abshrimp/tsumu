import { expect, test } from "@playwright/test";

for (const width of [240, 288]) {
  test(`Output tag options and descriptions stay on one truncated line at panel width ${width}px`, async ({ page }) => {
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
    const openMenu = async () => {
      // Position the list first so Playwright's automatic scrolling does not close it via a scroll event.
      await trigger.scrollIntoViewIfNeeded();
      await trigger.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await trigger.click();
      await expect(menu).toBeVisible();
      // Measure spacing after the opening animation settles, not from intermediate coordinates.
      await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    };
    await openMenu();

    // Long descriptions stay on one line while every item retains spacing, full text, and selection behavior.
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

    // Reopening shows the selection, and Escape, outside clicks, and re-selection keep working.
    await openMenu();
    await expect(menu.locator(".is-sel")).toContainText(label);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await openMenu();
    await page.locator('[data-tutorial="right-tab-settings"]').click();
    await expect(menu).toHaveCount(0);
    await openMenu();
    await menu.getByRole("button", { name: /^カスタム/ }).click();
    await expect(page.locator('[data-tutorial="settings-semantic"] input')).toBeVisible();
    await expect(menu).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
