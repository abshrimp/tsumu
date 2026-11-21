import { expect, test, type Page } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeField, makeText } from "../lib/presets";
import type { DocNode, Page as SitePage, SiteDoc } from "../lib/types";

async function openExport(page: Page, nodes: DocNode[], roots: DocNode[], pageSettings: Partial<SitePage> = {}) {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Cascade", assets: {}, pageOrder: ["p"],
    nodes: Object.fromEntries(nodes.map(node => [node.id, node])),
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: roots.map(node => node.id), ...pageSettings } },
  };
  const { files } = generateExportProject(doc, "html");
  await page.route("https://cascade.test/**", route => {
    const file = new URL(route.request().url()).pathname.slice(1) || "index.html";
    if (!Object.hasOwn(files, file)) return route.abort();
    return route.fulfill({ contentType: file.endsWith(".css") ? "text/css" : "text/html", body: files[file] });
  });
  await page.goto("https://cascade.test/");
}

test("dark containing blocks follow children across responsive width changes", async ({ page }) => {
  const child = { ...makeBox("Child"), darkStyles: {
    base: { default: { position: "absolute" } }, sm: { default: { position: "static" } },
  } };
  const parent = { ...makeBox("Parent"), attrId: "parent", children: [child.id] };
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 700 });
  await openExport(page, [parent, child], [parent]);
  await expect(page.locator("#parent")).toHaveCSS("position", "relative");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.locator("#parent")).toHaveCSS("position", "static");
  await page.setViewportSize({ width: 1280, height: 700 });
  await expect(page.locator("#parent")).toHaveCSS("position", "relative");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("#parent")).toHaveCSS("position", "static");
});

test("classes retained from imported HTML do not inherit an unrelated node's generated styles", async ({ page }) => {
  const card = { ...makeText("Card", { color: "red" }), name: "Card", attrId: "card" };
  const imported = { ...makeText("Imported"), name: "Label", htmlClass: "card card-2", attrId: "imported" };
  await openExport(page, [card, imported], [card, imported]);
  await expect(page.locator("#card")).toHaveCSS("color", "rgb(255, 0, 0)");
  expect(await page.locator("#imported").evaluate(el => el.matches(".card.card-2"))).toBe(true);
  const bodyColor = await page.locator("body").evaluate(el => getComputedStyle(el).color);
  await expect(page.locator("#imported")).toHaveCSS("color", bodyColor);
});

for (const raw of [false, true]) test(`native input on a dark ${raw ? "HTML" : "visual"} page inherits its color scheme`, async ({ page }) => {
  const field = { ...makeField("input"), attrId: "field", styles: {} };
  await page.emulateMedia({ colorScheme: "dark" });
  await openExport(page, [field], [field], {
    bodyDarkStyles: { base: { default: { color: "white", backgroundColor: "black" } } },
    ...(raw ? { rawHtml: '<!doctype html><html><body><input id="field" style="color:inherit"></body></html>' } : {}),
  });
  const input = page.locator("#field");
  const nativeBackground = await input.evaluate(element => {
    const reference = element.cloneNode() as HTMLInputElement;
    reference.style.colorScheme = "dark";
    element.after(reference);
    const color = getComputedStyle(reference).backgroundColor;
    reference.remove();
    return color;
  });
  await expect(input).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(input).toHaveCSS("background-color", nativeBackground);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(input).not.toHaveCSS("background-color", nativeBackground);
});

test("responsive body, focus, hover, and placeholder rules cascade in the static page", async ({ page }) => {
  const field = {
    ...makeField("input"), attrId: "states", styles: {
      base: { default: { placeholderColor: "red" }, hover: { color: "green" }, focus: { color: "blue" } },
      sm: { default: { placeholderColor: "orange" } },
    },
    darkStyles: { sm: { default: { placeholderColor: "yellow" }, focus: { color: "white" } } },
  };
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1200, height: 700 });
  await openExport(page, [field], [field], {
    bodyStyles: { base: { default: { paddingTop: "20px" } }, sm: { default: { paddingTop: "8px" } } },
  });
  const input = page.locator("#states");
  const placeholder = () => input.evaluate(el => getComputedStyle(el, "::placeholder").color);
  await expect.poll(placeholder).toBe("rgb(255, 0, 0)");
  await expect(page.locator("body")).toHaveCSS("padding-top", "20px");
  await input.hover();
  await expect(input).toHaveCSS("color", "rgb(0, 128, 0)");
  await input.focus();
  await expect(input).toHaveCSS("color", "rgb(0, 0, 255)");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.locator("body")).toHaveCSS("padding-top", "8px");
  await expect.poll(placeholder).toBe("rgb(255, 165, 0)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(placeholder).toBe("rgb(255, 255, 0)");
  await expect(input).toHaveCSS("color", "rgb(255, 255, 255)");
});
