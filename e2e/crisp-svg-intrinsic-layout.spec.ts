import { expect, test } from "@playwright/test";
import { generateProject } from "../lib/generator";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

// Regression: the published matsufes.info timetable had a shrink-to-fit flex
// container whose only in-flow child was a sharpened SVG. Absolute-positioning
// that SVG's img collapsed the parent and all its overlaid timetable entries.
test("exported sharpened SVG preserves shrink-to-fit layout and responsive overlays", async ({ page }) => {
  const root = { ...makeBox(), id: "root" };
  const doc: SiteDoc = {
    siteName: "Crisp SVG layout",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", slug: "", name: "Home", title: "Home",
        description: "", children: ["root"],
      },
    },
    nodes: { root },
    assets: {},
  };
  const css = generateProject(doc).files["app/globals.css"];
  expect(css).toContain(".crisp-svg > img");

  const svgUrl = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1670" height="3081">' +
      '<rect width="1670" height="3081" fill="#f7e9ef"/></svg>'
  );
  await page.setContent(`<!doctype html>
<html><head>
  <style>${css}</style>
  <style>
    .section { display: flex; flex-direction: column; align-items: center; padding: 20px; }
    .board { display: flex; flex-direction: column; gap: 12px; position: relative; }
    .overlay { position: absolute; left: 11%; width: 16%; height: 100%; }
    .artwork { width: 100%; max-width: 100%; height: auto; }
  </style>
</head><body>
  <section class="section">
    <div id="board" class="board">
      <div id="overlay" class="overlay"></div>
      <span id="crisp" class="crisp-svg artwork"
        style="--crisp-svg-width:1670px;--crisp-svg-ratio:1670 / 3081">
        <img src="${svgUrl}" alt="Timetable" width="3340" height="6162">
      </span>
    </div>
  </section>
</body></html>`);

  const geometry = async () => page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    return {
      board: rect("#board").width,
      overlay: rect("#overlay").width,
      artwork: rect("#crisp").width,
      height: rect("#crisp").height,
      image: rect("#crisp img").width,
      images: document.querySelectorAll("#crisp img").length,
    };
  });

  for (const width of [390, 740, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const current = await geometry();
    expect(current.board).toBeCloseTo(width - 40, 0);
    expect(current.overlay).toBeGreaterThan(0);
    expect(current.artwork).toBeCloseTo(current.board, 0);
    expect(current.height).toBeCloseTo(current.artwork * 3081 / 1670, 0);
    expect(current.image).toBeCloseTo(current.artwork, 0);
    expect(current.images).toBe(1);
  }

  // A show/hide script can set display:flex on an SVG wrapper.
  await page.locator("#crisp").evaluate((el) => {
    (el as HTMLElement).style.display = "flex";
  });
  const shown = await geometry();
  expect(shown.artwork).toBeGreaterThan(0);
  expect(shown.image).toBeCloseTo(shown.artwork, 0);
});
