import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { build } from "../tests/helpers/bundle";

function fragmentSite(): SiteDoc {
  const link = { ...makeText("Read details"), id: "jump", link: { kind: "url" as const, url: "/案内?edition=ja#詳しい説明" } };
  const spacer = { ...makeBox(), id: "space", styles: { base: { default: { height: "1600px" } } } };
  const heading = { ...makeText("Destination"), id: "heading", attrId: "詳しい説明", htmlAttrs: { tabindex: "-1" },
    styles: { base: { default: { scrollMarginTop: "72px" } } } };
  const page = { id: "p", name: "Home", title: "", description: "", slug: "", children: ["jump"] };
  return {
    schemaVersion: 1, siteName: "Edition", assets: {}, pageOrder: ["p", "base", "ja"],
    nodes: { jump: link, space: spacer, heading, tail: { ...spacer, id: "tail" } },
    pages: { p: page, base: { ...page, id: "base", slug: "案内", children: [] },
      ja: { ...page, id: "ja", slug: "案内", query: "edition=ja", children: ["space", "heading", "tail"] } },
  };
}

for (const language of ["typescript", "javascript"] as const) {
  const browserTag = language === "typescript" ? " @export-navigation" : "";
  test("React " + language + " deep links focus the query edition's fragment on the first render" + browserTag, async ({ page }) => {
    const { files } = await prepareExportProject(fragmentSite(), { framework: "react", scope: "project", language, style: "css" });
    const dir = await mkdtemp(join(tmpdir(), "fragment-export-"));
    try {
      for (const [name, source] of Object.entries(files).filter(([name]) => name.startsWith("src/"))) {
        await mkdir(dirname(join(dir, name)), { recursive: true });
        await writeFile(join(dir, name), source);
      }
      const source = "src/main." + (language === "javascript" ? "jsx" : "tsx");
      const built = await build({ entryPoints: [join(dir, source)], nodePaths: [resolve("node_modules")], bundle: true, format: "esm",
        platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, outdir: dir, write: false });
      const html = files["index.html"].replace("/" + source, "/main.js").replace("</head>", '<link rel="stylesheet" href="/main.css"></head>');
      await page.route("https://fragments.test/**", route => {
        const name = new URL(route.request().url()).pathname;
        if (name === "/main.js" || name === "/main.css") {
          const file = built.outputFiles.find(output => output.path.endsWith(name))!;
          return route.fulfill({ contentType: name.endsWith(".js") ? "text/javascript" : "text/css", body: file.text });
        }
        return route.fulfill({ contentType: "text/html", body: html });
      });
      await page.goto("https://fragments.test/");
      await page.getByRole("link", { name: "Read details" }).click();
      const heading = page.locator('[id="詳しい説明"]');
      await expect(heading).toBeInViewport();
      const offsetError = () => heading.evaluate(el => Math.abs(el.getBoundingClientRect().top - 72));
      await expect.poll(offsetError).toBeLessThan(2);
      await expect(heading).toBeFocused();
      const bookmark = page.url();
      await page.goto("about:blank");
      await page.goto(bookmark);
      await expect.poll(offsetError).toBeLessThan(2);
      // Browser history should restore the reader's position even when the URL contains a bookmark.
      await page.evaluate(() => window.scrollTo(0, 430));
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(430);
      await page.goto("https://fragments.test/");
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await page.goBack();
      await expect(page).toHaveURL(bookmark);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(430);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("canvas preview opens the same Unicode path, query edition and anchor as the exported page", async ({ page }) => {
  const { componentListBundle } = await import("../tests/helpers/component-list-export");
  const doc = fragmentSite();
  await page.route("https://editor.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
  await page.goto("https://editor.test/workspace");
  await page.addScriptTag({ content: await componentListBundle(doc, "jump") });
  await page.addStyleTag({ content: ".canvas-area { height: 500px; max-height: 500px; overflow: auto; }" });
  await page.getByRole("button", { name: "Toggle preview" }).click();
  await page.locator(".cv-root").getByRole("link", { name: "Read details" }).click();
  const heading = page.locator('.cv-root [id="詳しい説明"]');
  await expect(heading).toBeInViewport();
  await expect.poll(() => page.locator(".canvas-area").evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await expect(page).toHaveURL("https://editor.test/workspace");
});
