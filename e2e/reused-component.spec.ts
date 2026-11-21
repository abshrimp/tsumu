import { expect, test, type Page } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import { scriptsFile } from "../lib/script-runtime";
import type { DocNode, SiteDoc } from "../lib/types";
import { componentListBundle, publishedComponentList } from "../tests/helpers/component-list-export";

const instance = (id: string, componentId: string, attrId?: string): DocNode =>
  ({ ...makeBox(), id, type: "instance", componentId, attrId, styles: {} });
const control = (id: string, target: string): DocNode => ({
  ...makeText(id), id, semantic: "button",
  scripts: [{ id: id + "-click", trigger: "click", steps: [{ id: id + "-hide", kind: "hide", target }] }],
});
const doc: SiteDoc = {
  schemaVersion: 1, siteName: "Repeated cards", assets: {}, pageOrder: ["p"],
  pages: { p: { id: "p", title: "", slug: "", name: "Cards", description: "", children: ["photo", "first", "second", "all"] } },
  components: {
    image: { id: "image", rootId: "picture", name: "Photo" },
    section: { id: "section", rootId: "card", name: "Card" },
    controls: { id: "controls", rootId: "buttons", name: "Controls" },
  },
  nodes: {
    picture: { ...makeBox(), id: "picture", type: "image", image: {
      src: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"/>').toString("base64"),
      alt: "A landscape", width: 12, height: 8,
    } },
    photo: instance("photo", "image", "cover"),
    first: instance("first", "section", "first"), second: instance("second", "section", "second"),
    card: { ...makeBox(), id: "card", children: ["summary", "detail", "one", "two"] },
    summary: control("summary", "detail"), detail: { ...makeText("Details"), id: "detail", attrId: "detail" },
    one: instance("one", "controls"), two: instance("two", "controls"),
    buttons: { ...makeBox(), id: "buttons", children: ["close", "note", "closeParent"] },
    close: control("close", "note"), note: { ...makeText("Note"), id: "note", attrId: "note" },
    closeParent: control("closeParent", "detail"), all: control("all", "detail"),
  },
};

async function verifyControls(page: Page) {
  await page.locator("#second").getByRole("button", { name: "close", exact: true }).last().click();
  await expect(page.locator("#second [id=note]").last()).toBeHidden();
  await expect(page.locator("#second [id=note]").first()).toBeVisible();
  await expect(page.locator("#first [id=note]").last()).toBeVisible();
  await page.locator("#second").getByRole("button", { name: "closeParent" }).first().click();
  await expect(page.locator("#second [id=detail]")).toBeHidden();
  await expect(page.locator("#first [id=detail]")).toBeVisible();
  await page.getByRole("button", { name: "all", exact: true }).click();
  await expect(page.locator("#first [id=detail]")).toBeHidden();
}

test("component roots render the same image in design and preview, and nested interactions stay within the clicked copy", async ({ page }) => {
  await page.route("https://component.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
  await page.goto("https://component.test/");
  await page.addScriptTag({ content: await componentListBundle(doc, "photo") });
  const img = page.locator(".cv-root img[data-node=photo]");
  await expect(img).toHaveAttribute("alt", "A landscape");
  await expect(img).toHaveJSProperty("naturalWidth", 12);
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await expect(img).toHaveAttribute("id", "cover");
  await verifyControls(page);
});

for (const format of ["html", "nextjs"] as const) {
  test(format + " scopes nested component controls to the clicked copy and retains page-wide controls", async ({ page }) => {
    if (format === "nextjs") {
      await page.setContent(await publishedComponentList(doc));
      await page.addScriptTag({ content: scriptsFile(doc) });
    } else {
      const { files } = generateExportProject(doc, format);
      await page.route("https://component.test/**", route => {
        const key = new URL(route.request().url()).pathname.slice(1) || "index.html";
        if (!Object.hasOwn(files, key)) return route.abort();
        return route.fulfill({ contentType: key.endsWith(".js") ? "text/javascript" : key.endsWith(".css") ? "text/css" : "text/html", body: files[key] });
      });
      await page.goto("https://component.test/");
    }
    await expect(page.locator("#cover")).toHaveAttribute("alt", "A landscape");
    await verifyControls(page);
  });
}

test("an absolutely positioned component uses its own parent at the authored breakpoint", async ({ page }) => {
  const layout = structuredClone(doc);
  layout.nodes.frame = { ...makeBox(), id: "frame", attrId: "frame", children: ["photo"],
    styles: { base: { default: { width: "140px", height: "70px", marginLeft: "120px" } } } };
  layout.nodes.picture.styles = { base: { default: { position: "absolute", left: "12px", top: "8px" } },
    sm: { default: { position: "static" } } };
  layout.pages.p.children = ["frame"];
  const { files } = generateExportProject(layout, "html");
  await page.setContent(files["index.html"]);
  await page.addStyleTag({ content: files["styles/site.css"] });
  const frame = page.locator("#frame");
  await page.setViewportSize({ width: 1100, height: 640 });
  await expect(frame).toHaveCSS("position", "relative");
  await expect.poll(() => page.locator("#cover").evaluate(image => (image as HTMLElement).offsetParent?.id)).toBe("frame");
  await page.setViewportSize({ width: 420, height: 640 });
  await expect(frame).toHaveCSS("position", "static");
  await expect(page.locator("#cover")).toHaveCSS("position", "static");
});
