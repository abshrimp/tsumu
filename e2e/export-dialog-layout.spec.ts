import { expect, test } from "@playwright/test";

test("export and history modals keep headers and actions visible while scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 520 });
  await page.goto("/");
  for (const kind of ["export", "hist"] as const) {
    await page.evaluate((kind) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-backdrop";
      overlay.id = "modal-overflow-probe";
      const modal = document.createElement("div");
      modal.className = "modal " + (kind === "hist" ? "hist-modal" : "export-modal export-layout-modal");
      const header = document.createElement("div");
      header.className = "export-layout-header";
      header.textContent = "Dialog heading";
      const content = document.createElement("div");
      content.className = "export-layout-scroll";
      content.textContent = "Long dialog content";
      const tall = document.createElement("div");
      tall.style.height = "1200px";
      content.append(tall);
      const footer = document.createElement("div");
      footer.className = "modal-actions export-layout-actions";
      footer.textContent = "Actions";
      modal.append(header, content, footer);
      overlay.append(modal);
      document.body.append(overlay);
    }, kind);
    const modal = page.locator("#modal-overflow-probe .modal");
    const body = modal.locator(".export-layout-scroll");
    const before = await modal.evaluate((element) => {
      const area = element.querySelector(".export-layout-scroll")!;
      const header = element.querySelector(".export-layout-header")!;
      const footer = element.querySelector(".export-layout-actions")!;
      const outer = element.getBoundingClientRect();
      return {
        fits: outer.left >= 0 && outer.right <= innerWidth && outer.top >= 0 && outer.bottom <= innerHeight,
        scrolls: area.scrollHeight > area.clientHeight && getComputedStyle(area).overflowY === "auto",
        headerVisible: header.getBoundingClientRect().top >= outer.top - 1,
        footerVisible: footer.getBoundingClientRect().bottom <= outer.bottom + 1,
      };
    });
    expect(before).toEqual({ fits: true, scrolls: true, headerVisible: true, footerVisible: true });
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(modal.locator(".export-layout-actions")).toBeInViewport();
    await page.locator("#modal-overflow-probe").evaluate(element => element.remove());
  }
});

test("confirmation prompt fits a compact phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  const result = await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "modal dialog";
    const heading = document.createElement("div");
    heading.className = "dialog-head";
    heading.textContent = "Confirmation";
    const message = document.createElement("p");
    message.className = "dialog-msg";
    message.textContent = "An action requires confirmation.";
    const input = document.createElement("input");
    input.className = "input dialog-input";
    dialog.append(heading, message, input);
    overlay.append(dialog);
    document.body.append(overlay);
    const bounds = dialog.getBoundingClientRect();
    const inputBounds = input.getBoundingClientRect();
    const fits = bounds.left >= 0 && bounds.right <= innerWidth &&
      bounds.top >= 0 && bounds.bottom <= innerHeight &&
      inputBounds.left >= bounds.left && inputBounds.right <= bounds.right;
    overlay.remove();
    return fits;
  });
  expect(result).toBe(true);
});
