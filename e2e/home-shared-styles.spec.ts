import { expect, test } from "@playwright/test";

test("home controls, dialogs, and file drop overlay load their shared styles", async ({ page }) => {
  await page.goto("/");

  const createButton = page.locator(".home-new.btn-primary");
  await expect(createButton).toBeVisible();

  const buttonStyle = await createButton.evaluate((element) => {
    const style = getComputedStyle(element);
    const accentSample = document.createElement("span");
    accentSample.style.color = "var(--accent)";
    document.body.append(accentSample);
    const accent = getComputedStyle(accentSample).color;
    accentSample.remove();
    return {
      background: style.backgroundColor,
      accent,
      paddingLeft: style.paddingLeft,
      borderRadius: style.borderRadius,
    };
  });
  expect(buttonStyle.background).toBe(buttonStyle.accent);
  expect(buttonStyle.paddingLeft).toBe("14px");
  expect(buttonStyle.borderRadius).toBe("999px");

  await createButton.click();
  const dialog = page.locator(".home-dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => getComputedStyle(element).borderRadius)).toBe("24px");
  const backdrop = await page.locator(".modal-backdrop").evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(backdrop).not.toBe("rgba(0, 0, 0, 0)");

  const dropOverlay = await page.evaluate(() => {
    const element = document.createElement("div");
    element.className = "home-drop-overlay";
    document.body.append(element);
    const style = getComputedStyle(element);
    const result = { position: style.position, display: style.display };
    element.remove();
    return result;
  });
  expect(dropOverlay).toEqual({ position: "fixed", display: "grid" });
});
