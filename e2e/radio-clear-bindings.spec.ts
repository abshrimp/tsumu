import { expect, test, type Page } from "@playwright/test";
import { publishedRadioClear } from "../tests/helpers/radio-clear-bindings";

async function install(page: Page, clearOnChange = false) {
  const published = await publishedRadioClear(clearOnChange);
  await page.setContent(published.html);
  await page.addScriptTag({ content: published.script });
  await page.evaluate(() => {
    const events: string[] = [];
    (window as any).radioEvents = events;
    for (const type of ["input", "change"]) document.addEventListener(type, (event) => {
      const input = event.target as HTMLInputElement;
      if (input.type === "radio") events.push(`${input.parentElement!.id}:${type}`);
    });
  });
}

async function expectCleared(page: Page) {
  await expect(page.locator("#small input")).not.toBeChecked();
  await expect(page.locator("#medium input")).not.toBeChecked();
  await expect(page.locator("#red input")).toBeChecked();
  await expect(page.locator("#result")).toHaveText("size=; small=false; medium=false; index=; color=red");
  await expect(page.locator("#dependent")).toHaveValue("Selected: ");
  await expect(page.locator("#dependent")).toHaveAttribute("placeholder", "Index: ");
}

for (const [label, button] of [
  ["false", "clear-item-0"], ["0", "clear-item-1"], ["off", "clear-item-2"],
  ["no", "clear-item-3"], ["empty string", "clear-item-4"],
  ["clear group", "clear-group"], ["unknown group value", "unknown-group"],
]) {
  test(`Clearing a radio on a published page also updates visible output: ${label}`, async ({ page }) => {
    await install(page);
    await expect(page.locator("#result")).toHaveText("size=S; small=true; medium=false; index=1; color=red");
    await page.locator(`#${button}`).click();
    await expectCleared(page);
    await expect(page.locator("#counts")).toHaveText("||");
    expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([]);
    await page.locator(`#${button}`).click();
    await expectCleared(page);
    expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([]);
  });
}

test("Selecting another radio fires change exactly once on the selected option", async ({ page }) => {
  await install(page);
  await page.locator("#select-medium").click();
  await expect(page.locator("#counts")).toHaveText("|1|");
  await expect(page.locator("#result")).toHaveText("size=M; small=false; medium=true; index=2; color=red");
  await page.locator("#select-medium").click();
  await expect(page.locator("#counts")).toHaveText("|1|");
  await page.locator("#select-small").click();
  await expect(page.locator("#counts")).toHaveText("1|1|");
  await page.locator("#clear-group").click();
  await expectCleared(page);
  await expect(page.locator("#counts")).toHaveText("1|1|");
  expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([
    "medium:input", "medium:change", "small:input", "small:change",
  ]);
});

test("A change script clearing its own radio remains synchronized without recursion", async ({ page }) => {
  await install(page, true);
  await page.locator("#select-medium").click();
  await page.locator("#select-small").click();
  await expectCleared(page);
  await expect(page.locator("#counts")).toHaveText("1|1|");
  expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([
    "medium:input", "medium:change", "small:input", "small:change",
  ]);
});

test("Manual selection emits one notification and clearing a radio preserves edited fields", async ({ page }) => {
  await install(page);
  await page.locator("#clear-group").click();
  await page.locator("#medium input").check();
  await expect(page.locator("#result")).toHaveText("size=M; small=false; medium=true; index=2; color=red");
  await expect(page.locator("#counts")).toHaveText("|1|");
  await page.locator("#clear-item-0").click();
  await expect(page.locator("#medium input")).toBeChecked();
  await page.locator("#dependent").fill("My own text");
  await page.locator("#clear-group").click();
  await expect(page.locator("#dependent")).toHaveValue("My own text");
  await expect(page.locator("#dependent")).toHaveAttribute("placeholder", "Index: ");
  await expect(page.locator("#result")).toHaveText("size=; small=false; medium=false; index=; color=red");
  await expect(page.locator("#counts")).toHaveText("|1|");
  expect(await page.evaluate(() => (window as any).radioEvents)).toEqual(["medium:input", "medium:change"]);
});
