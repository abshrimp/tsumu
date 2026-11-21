import { expect, test, type Page } from "@playwright/test";
import { generateProject } from "../lib/generator";
import { generateStandaloneHtml } from "../lib/generator/html-export";
import { makeBox, makeText } from "../lib/presets";
import type { Motion, SiteDoc } from "../lib/types";

async function openExport(page: Page, blockObserver = false) {
  const motions: Motion[] = [
    { id: "load", trigger: "load", keyframes: "pulse", duration: 3, delay: 0, easing: "linear", repeat: -1 },
    { id: "enter", trigger: "in-view", keyframes: "fade-up", duration: 0.2, delay: 0, easing: "ease-out" },
    { id: "entry-pulse", trigger: "in-view", keyframes: "pulse", duration: 1, delay: 0, easing: "ease" },
  ];
  const spacer = makeBox("Spacer", { height: "200vh" });
  const text = { ...makeText("Work"), attrId: "work", motions };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Motion", assets: {}, pageOrder: ["home"],
    nodes: { [spacer.id]: spacer, [text.id]: text },
    pages: { home: {
      id: "home", name: "Home", slug: "", title: "Home", description: "", children: [spacer.id, text.id],
    } },
  };
  const { files } = generateStandaloneHtml(doc, generateProject(doc));
  await page.route("https://motion.test/**", (route) => {
    const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
    if ((blockObserver && path === "inview.js") || !(path in files)) return route.abort();
    const contentType = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html";
    return route.fulfill({ contentType, body: files[path] });
  });
  await page.goto("https://motion.test/");
}

test("the exported section remains readable when the in-view script fails to load", async ({ page }) => {
  await openExport(page, true);
  const work = page.locator("#work");
  await work.evaluate(el => el.scrollIntoView());
  await expect(work).toHaveCSS("opacity", "1");
  await expect(work).toHaveCSS("animation-name", "anim-pulse");
});

test("entry motion starts on intersection and observes newly rendered content", async ({ page }) => {
  await openExport(page);
  const work = page.locator("#work");
  await expect(work).toHaveCSS("animation-name", "anim-pulse");
  const loadMotion = await work.evaluateHandle(el => el.getAnimations()[0]);
  await work.evaluate(el => el.scrollIntoView());
  await expect(work).toHaveCSS("animation-name", "anim-pulse, anim-fade-up, inview-anim-pulse");
  expect(await work.evaluate((el, motion) => el.getAnimations()[0] === motion, loadMotion)).toBe(true);
  await expect(work).toHaveCSS("opacity", "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await work.evaluate(el => {
    const replacement = el.cloneNode(true) as HTMLElement;
    replacement.classList.remove("is-inview");
    el.replaceWith(replacement);
  });
  await expect(work).toHaveClass(/\bis-inview\b/);
  await expect(work).toHaveCSS("animation-iteration-count", "1");
  expect(await work.evaluate(el => el.getAnimations().every(animation =>
    Number(animation.effect?.getTiming().duration) < 1))).toBe(true);
  await expect(work).toHaveCSS("opacity", "1");
});
