import { expect, test } from "@playwright/test";

test("page settings fields have stable identifiers and associated labels", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Form accessibility" } });
  expect(response.ok()).toBeTruthy();
  const { site } = (await response.json()) as { site: { id: string } };

  await page.goto(`/sites/${site.id}`);
  const settings = page.locator('[data-tutorial="page-settings"]');
  await expect(settings).toBeVisible();

  await expect(settings.getByRole("textbox", { name: "名前", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "URL", exact: true })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "言語", exact: true })).toBeVisible();

  const problems = await settings.evaluate((root) => {
    const labels = [...root.querySelectorAll("label")]
      .filter((label) => !label.control)
      .map((label) => label.textContent?.trim() ?? "");
    const fields = [...root.querySelectorAll("input, select, textarea")];
    const unnamedFields = fields.filter((field) => !field.id && !field.getAttribute("name"))
      .map((field) => field.outerHTML.slice(0, 180));
    const ids = fields.map((field) => field.id).filter(Boolean);
    return {
      labels,
      unnamedFields,
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    };
  });

  expect(problems).toEqual({ labels: [], unnamedFields: [], duplicateIds: [] });
});
