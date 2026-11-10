import { expect, test } from "@playwright/test";
import { searchFormValuesBundle } from "../tests/helpers/search-form-values";

for (const format of ["nextjs", "react"] as const) {
  test(`${format} search forms preserve empty and repeated successful fields @form-values`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const script = await searchFormValuesBundle(format);
    await page.route("http://form.export.test/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: '<div id="app"></div>' });
    });
    await page.goto("http://form.export.test/search?tab=products&tab=offers&q=typed&tag=on&tag=b&color=red&color=blue&sort=&size=S");
    await page.addScriptTag({ content: script });
    await expect(page.locator("#q")).toHaveValue("typed");
    await expect(page.locator("#tag-a")).not.toBeChecked();
    await expect(page.locator("#tag-b")).toBeChecked();
    await expect(page.locator("#tag-on")).toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["red", "blue"]);
    await expect(page.locator("#sort")).toHaveValue("");
    await expect(page.locator("#size-s")).toBeChecked();

    await page.locator("#q").fill("");
    await page.locator("#note").fill("");
    await page.locator("#tag-a").check();
    await page.locator("#tag-on").uncheck();
    await page.locator("#color").selectOption(["green", "blue"]);
    await page.locator("#upload").setInputFiles({ name: "fixture.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
    await page.locator("#submit").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("");
    const params = new URL(page.url()).searchParams;
    expect(params.getAll("tab")).toEqual(["products", "offers"]);
    expect(params.getAll("tag")).toEqual(["a", "b"]);
    expect(params.getAll("color")).toEqual(["green", "blue"]);
    expect(params.get("note")).toBe("");
    expect(params.get("sort")).toBe("");
    expect(params.get("size")).toBe("S");
    expect(params.has("disabled")).toBe(false);
    expect(params.has("fieldset-disabled")).toBe(false);
    expect(params.has("upload")).toBe(false);
    expect(params.has("")).toBe(false);
    if (format === "react") await page.addScriptTag({ content: script });
    await expect(page.locator("#q")).toHaveValue("");
    await expect(page.locator("#note")).toHaveValue("");
    await expect(page.locator("#tag-a")).toBeChecked();
    await expect(page.locator("#tag-b")).toBeChecked();
    await expect(page.locator("#tag-on")).not.toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["green", "blue"]);

    // 同じDOMを保持した履歴移動でも、URLにない選択を残さない。
    await page.evaluate(() => {
      window.history.pushState(null, "", "?tab=products&q=&tag=on&color=red");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator("#tag-a")).not.toBeChecked();
    await expect(page.locator("#tag-b")).not.toBeChecked();
    await expect(page.locator("#tag-on")).toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["red"]);
    await page.goBack();
    await expect(page.locator("#tag-a")).toBeChecked();
    await expect(page.locator("#tag-b")).toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["green", "blue"]);
    await page.goForward();
    await expect(page.locator("#color")).toHaveValues(["red"]);
    expect(errors).toEqual([]);
  });
}
