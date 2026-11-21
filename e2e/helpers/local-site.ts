import { expect, type Page } from "@playwright/test";

export async function localMode(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("tsumu-lang", "ja");
    localStorage.setItem("tsumu-help-seen-v1", "1");
  });
  await page.route("**/api/status", route => route.fulfill({
    json: { auth: false, role: "editor", isAdmin: true, db: false, collabTransport: "none", assets: false, user: null },
  }));
  await page.route("**/api/sites**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/doc**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/assets", async route => {
    await route.fulfill({ status: 503, json: {} });
    expect(route.request().method(), "Browser-only imports must keep file contents on the device").not.toBe("POST");
  });
}
