import { expect, test } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import type { SiteDoc } from "../lib/types";

test("query-specific HTML adds and removes the generated share image without changing the author's head", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Editions", lang: "en", assets: {}, nodes: {},
    customHeadHtml: '<meta property="og:image" content="https://images.example/author.png" data-author>',
    pageOrder: ["translation", "base"],
    pages: {
      translation: { id: "translation", title: "Hiver", name: "Hiver", description: "Édition française",
        slug: "", query: "edition=fr", lang: "fr", noindex: true, children: [], ogImage: { url: "https://images.example/hiver.png" } },
      base: { id: "base", name: "Winter", title: "Winter", description: "English edition", slug: "", children: [] },
    },
  };
  const { files } = generateExportProject(doc, "html");
  await page.route("https://editions.test/**", route => {
    const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
    if (!Object.hasOwn(files, path)) return route.abort();
    const mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
    return route.fulfill({ contentType: mime, body: files[path] });
  });
  await page.goto("https://editions.test/?edition=fr");
  await expect(page).toHaveTitle("Hiver");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Édition française");
  await expect(page.locator('meta[property="og:image"][data-route-social]')).toHaveAttribute("content", "https://images.example/hiver.png");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("meta[data-author]")).toHaveAttribute("content", "https://images.example/author.png");
  await page.goto("https://editions.test/");
  await expect(page).toHaveTitle("Winter");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('meta[name="robots"], meta[data-route-social]')).toHaveCount(0);
  await expect(page.locator("meta[data-author]")).toHaveAttribute("content", "https://images.example/author.png");
});
