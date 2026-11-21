import { expect, test } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import { scriptsFile } from "../lib/script-runtime";
import type { DocNode, SiteDoc } from "../lib/types";
import { componentListBundle, publishedComponentList } from "../tests/helpers/component-list-export";

const toggle = (id: string): DocNode => ({
  ...makeText(id), id, attrId: id,
  scripts: [{ id: id + "-click", trigger: "click", steps: [{ id: id + "-toggle", kind: "toggle", target: "details" }] }],
});
const doc: SiteDoc = {
  schemaVersion: 1, siteName: "Keyboard controls", assets: {}, pageOrder: ["p"],
  pages: { p: { id: "p", name: "Keys", title: "Keys", slug: "", description: "",
    children: ["native", "custom", "link", "linked-button", "field", "details"] } },
  nodes: {
    native: { ...toggle("native"), semantic: "button" },
    custom: { ...toggle("custom"), semantic: "div", htmlAttrs: { role: "button", tabindex: "0" } },
    link: { ...toggle("link"), link: { kind: "url", url: "#details" } },
    "linked-button": { ...toggle("linked-button"), link: { kind: "url", url: "#details" }, htmlAttrs: { role: "button" } },
    field: { ...makeBox(), id: "field", attrId: "typing", type: "field", field: { kind: "input" } },
    details: { ...makeText("Details"), id: "details", attrId: "details" },
  },
};

for (const format of ["preview", "html", "nextjs"] as const) {
  test(format + " activates a scripted custom button with the keyboard and preserves native key behavior", async ({ page }) => {
    if (format === "preview") {
      await page.setContent('<div id="app"></div>');
      await page.addScriptTag({ content: await componentListBundle(doc, "custom") });
      await page.getByRole("button", { name: "Toggle preview" }).click();
    } else if (format === "nextjs") {
      await page.setContent(await publishedComponentList(doc));
      await page.addScriptTag({ content: scriptsFile(doc) });
    } else {
      const { files } = generateExportProject(doc, "html");
      await page.route("https://controls.test/**", route => {
        const key = new URL(route.request().url()).pathname.slice(1) || "index.html";
        if (!Object.hasOwn(files, key)) return route.abort();
        return route.fulfill({ contentType: key.endsWith(".js") ? "text/javascript" : key.endsWith(".css") ? "text/css" : "text/html", body: files[key] });
      });
      await page.goto("https://controls.test/");
    }
    const panel = page.locator("#details");
    const native = page.locator("#native"), custom = page.locator("#custom"), link = page.locator("#link");
    await expect(panel).toBeVisible();
    await native.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden();
    await page.keyboard.press("Space");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(custom).toBeFocused();
    await custom.click();
    await expect(panel).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();

    await page.keyboard.down("Space");
    await expect(panel).toBeVisible();
    await page.keyboard.up("Space");
    await expect(panel).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.keyboard.down("Space");
    await link.focus();
    await custom.focus();
    await page.keyboard.up("Space");
    await expect(panel).toBeHidden();
    await link.press("Enter");
    await expect(panel).toBeVisible();
    await link.press("Space");
    await expect(panel).toBeVisible();
    const linkedButton = page.locator("#linked-button");
    await linkedButton.press("Enter");
    await expect(panel).toBeHidden();
    await linkedButton.press("Space");
    await expect(panel).toBeVisible();

    await custom.evaluate(el => el.setAttribute("aria-disabled", "true"));
    await custom.click({ force: true });
    await expect(panel).toBeVisible();
    await custom.press("Enter");
    await expect(panel).toBeVisible();
    await custom.press("Space");
    await expect(panel).toBeVisible();
    const field = page.locator("#typing");
    await field.focus();
    await page.keyboard.press("Space");
    await expect(field).toHaveValue(" ");
    await expect(panel).toBeVisible();
  });
}
