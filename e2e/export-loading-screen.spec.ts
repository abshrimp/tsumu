import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "../tests/helpers/bundle";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("static and single HTML show the authored loading screen until load and only once per tab", async ({ browser }) => {
  const artwork = makeText("Opening the exhibition");
  const heading = makeText("Main exhibition");
  const page = { id: "home", name: "Gallery", title: "Gallery", slug: "news/gallery", description: "", children: [heading.id] };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Gallery", lang: "en", assets: {}, pageOrder: ["home", "about"],
    pages: {
      home: page, about: { ...page, id: "about", slug: "about" },
      splash: { ...page, id: "splash", slug: "__loading-screen", children: [artwork.id] },
    },
    nodes: { [artwork.id]: artwork, [heading.id]: heading },
    loadingScreen: { enabled: true, pageId: "splash", minDuration: 500, fadeDuration: 100, showOnce: true },
  };
  const single = await prepareExportProject(doc, {
    framework: "single-html", language: "javascript", style: "css", scope: "page", pageId: "home",
  });
  doc.pages.home.customEndHtml = '<img src="/gate.png" alt="">';
  const { files } = generateExportProject(doc, "html");
  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  for (const packed of [false, true]) {
    const context = await browser.newContext();
    const tab = await context.newPage();
    try {
      await tab.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
      await tab.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      await tab.route("https://gallery.test/**", async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/(?:second-site\/)?/, "");
        if (path === "gate.png") { await gate; return route.fulfill({ contentType: "image/gif", body: pixel }); }
        const source = packed ? single.files[path] : files[path];
        if (source === undefined) return route.abort();
        return route.fulfill({ body: source, contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html" });
      });
      const url = "https://gallery.test/" + (packed ? "index.html" : "news/gallery/index.html");
      await tab.goto(url, { waitUntil: "domcontentloaded" });
      const status = tab.getByRole("status");
      await expect(status).toHaveText("Opening the exhibition");
      await expect(status).toHaveCSS("position", "fixed");
      if (!packed) {
        await tab.clock.runFor(700);
        await expect(status).toBeVisible();
      }
      release();
      await tab.waitForLoadState("load");
      await tab.clock.runFor(packed ? 499 : 0);
      if (packed) await expect(status).toHaveCSS("opacity", "1");
      await tab.clock.runFor(110);
      await expect(status).toHaveCount(0);
      expect(await tab.locator("body").evaluate(el => el.style.overflow)).toBe("");
      await tab.reload();
      await expect(status).toHaveCount(0);
      await tab.goto(url.replace("gallery.test/", "gallery.test/second-site/"));
      await expect(status).toHaveText("Opening the exhibition");
    } finally { await context.close(); }
  }

  const noJs = await browser.newContext({ javaScriptEnabled: false });
  try {
    const tab = await noJs.newPage();
    await tab.route("https://gallery.test/**", route => route.fulfill({ contentType: "text/html", body: single.files["index.html"] }));
    await tab.goto("https://gallery.test/");
    await expect(tab.getByRole("status")).toHaveCount(0);
    await expect(tab.getByText("Main exhibition")).toBeVisible();

    // Next renders the default overlay on the server, before hydration.
    // A visitor with scripts disabled must still be able to interact with the page.
    const next = generateExportProject({ ...doc, loadingScreen: { ...doc.loadingScreen!, showOnce: false } }, "nextjs");
    const output = { exports: {} as { default?: () => React.ReactElement } };
    const component = transformSync(next.files["components/SiteLoadingScreen.tsx"], { loader: "tsx", format: "cjs", jsx: "automatic" });
    new Function("module", "exports", "require", component.code)(output, output.exports, createRequire(process.cwd() + "/package.json"));
    const initial = renderToStaticMarkup(createElement(output.exports.default!));
    expect(initial).toContain("Opening the exhibition");
    await tab.setContent('<style>' + next.files["app/globals.css"] + '</style>' + initial + '<button>View exhibit</button>');
    await expect(tab.getByRole("status")).toHaveCount(0);
    await tab.getByRole("button", { name: "View exhibit" }).click();
  } finally { await noJs.close(); }
});
