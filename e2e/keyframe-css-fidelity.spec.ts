import { expect, test } from "@playwright/test";
import { motionEditorBundle } from "../tests/helpers/motion-editor-browser";

const cases = [
  { name: "small opacity values", declarations: "opacity: 0.0001;", property: "opacity", expected: "0.0001" },
  { name: "escaped property aliases", declarations: String.raw`\6f pacity: 0.2; opacity: 0.8;`, property: "opacity", expected: "0.8" },
  { name: "case-sensitive custom properties", declarations: "--fadeLevel: 0.25; opacity: var(--fadeLevel);", property: "opacity", expected: "0.25" },
  { name: "opacity fallback order", declarations: "opacity: var(--fadeLevel, 0.2); opacity: 0.8;", property: "opacity", expected: "0.8" },
  { name: "transform fallback order", declarations: "transform: translate3d(4px, 5px, 6px); transform: translateX(12px);", property: "transform", expected: "matrix(1, 0, 0, 1, 12, 0)" },
];

for (const item of cases) {
  test(`opening and applying keyframes preserves ${item.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const source = `from { ${item.declarations} } to { ${item.declarations} }`;
    await page.setContent('<div id="app"></div>');
    await page.addStyleTag({ path: "app/globals.css" });
    await page.addScriptTag({ content: await motionEditorBundle(source) });
    const value = () => page.locator("#motion-probe").evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), item.property);
    await expect.poll(value).toBe(item.expected);
    await expect(page.locator(".kfe-modal")).toBeVisible();
    // The real editor parses CSS when it opens and serializes the visual state on Apply.
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".kfe-modal")).toHaveCount(0);
    await expect.poll(value).toBe(item.expected);
    await page.locator("#reopen").click();
    // Going through CSS mode and back must not accumulate or reorder declarations either.
    await page.locator('[data-tip="CSSで編集"]').click();
    await page.locator('[data-tip="CSSで編集"]').click();
    await expect(page.locator(".kfe-lane")).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect.poll(value).toBe(item.expected);
    expect(errors).toEqual([]);
  });
}

test("opening and applying nearby keyframes preserves the animated position", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = "from { transform: translateX(0px); } 49.9999% { transform: translateX(100px); } 50% { transform: translateX(0px); } to { transform: translateX(100px); }";
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ path: "app/globals.css" });
  await page.addScriptTag({ content: await motionEditorBundle(source) });
  const position = () => page.locator("#motion-probe").evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) return null;
    animation.currentTime = 25000;
    return new DOMMatrix(getComputedStyle(element).transform).m41;
  });
  await expect.poll(position).toBeCloseTo(50, 2);
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator(".kfe-modal")).toBeVisible();
    await page.getByRole("button", { name: "適用", exact: true }).click();
    await expect(page.locator(".kfe-modal")).toHaveCount(0);
    await expect(page.locator("#saved")).toContainText("49.9999%");
    await expect.poll(position).toBeCloseTo(50, 2);
    if (pass === 0) await page.locator("#reopen").click();
  }
  expect(errors).toEqual([]);
});
