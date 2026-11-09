import { expect, test, type Page } from "@playwright/test";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import type { ScriptStep, ScriptTrigger, SiteDoc } from "../lib/types";

type Entry = { trigger: ScriptTrigger; steps: ScriptStep[]; keep?: boolean };

function fixture(entries: Entry[]): SiteDoc {
  const pageScripts = entries.map((entry, index) => ({
    id: "audit-script-" + index,
    trigger: entry.trigger,
    keepOnShown: !!entry.keep,
    pos: { x: 0, y: 0 },
    steps: entry.steps,
  }));
  return {
    schemaVersion: 1, siteName: "Script browser audit",
    pageOrder: ["a", "b"],
    assets: {},
    nodes: {},
    pages: {
      a: { id: "a", name: "A", slug: "", title: "", description: "", children: [], pageScripts },
      b: { id: "b", name: "B", slug: "b", title: "", description: "", children: [] },
    },
  };
}

async function install(page: Page, published: boolean, entries: Entry[]) {
  const source = published
    ? scriptsFile(fixture(entries))
    : "(" + SCRIPT_RUNTIME + ")({}).install(document);";
  await page.addScriptTag({ content: source });
}

async function attach(page: Page, selector: string, entries: Entry[]) {
  await page.locator(selector).evaluate((el, scripts) => {
    el.setAttribute("data-scripts", JSON.stringify(scripts));
  }, entries);
}

for (const published of [false, true]) {
  const mode = published ? "published" : "preview";

  test(mode + ": an obsolete intersection notification cannot execute a previous page's script", async ({ page }) => {
    const entries: Entry[] = [
      { trigger: "in-view", steps: [{ id: "hide", kind: "hide", target: "banner" }] },
    ];
    await page.setContent('<main data-page-body="a"><div id="old"></div><div id="banner">A</div></main>');
    await attach(page, "#old", entries);
    await page.evaluate(() => {
      const listeners: Array<(entries: Array<{ target: Element; isIntersecting: boolean }>) => void> = [];
      const observed = new Set<Element>();
      (window as any).__observedForScriptAudit = observed;
      (window as any).__deliverScriptIntersection = (target: Element) => {
        for (const listener of listeners) listener([{ target, isIntersecting: true }]);
      };
      (window as any).IntersectionObserver = class {
        constructor(callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
          listeners.push(callback);
        }
        observe(target: Element) { observed.add(target); }
        unobserve(target: Element) { observed.delete(target); }
        disconnect() { observed.clear(); }
      };
    });
    await install(page, published, entries);
    await expect.poll(() => page.evaluate(() =>
      (window as any).__observedForScriptAudit.has(document.getElementById("old"))
    )).toBe(true);

    // The observer may deliver an already queued entry after its old element was detached.
    await page.evaluate((scripts) => {
      const old = document.getElementById("old")!;
      document.body.innerHTML = '<main data-page-body="b"><div id="banner">B</div><div id="fresh"></div></main>';
      document.getElementById("fresh")!.setAttribute("data-scripts", JSON.stringify(scripts));
      (window as any).__deliverScriptIntersection(old);
    }, entries);
    await expect(page.locator("#banner")).toBeVisible();
    await expect(page.locator("#banner")).toHaveText("B");

    // A new element on the new page must still receive the legitimate notification.
    await expect.poll(() => page.evaluate(() =>
      (window as any).__observedForScriptAudit.has(document.getElementById("fresh"))
    )).toBe(true);
    await page.evaluate(() =>
      (window as any).__deliverScriptIntersection(document.getElementById("fresh"))
    );
    await expect(page.locator("#banner")).toBeHidden();
  });

  test(mode + ": denied Clipboard API uses the fallback and removes its temporary field", async ({ page }) => {
    const entries: Entry[] = [
      { trigger: "click", steps: [{ id: "copy", kind: "copy", value: "fallback content" }] },
    ];
    await page.setContent('<main data-page-body="a"><button id="copy">Copy</button></main>');
    await attach(page, "#copy", entries);
    await page.evaluate(() => {
      (window as any).__fallbackCopyForScriptAudit = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: (command: string) => {
          if (command === "copy") {
            (window as any).__fallbackCopyForScriptAudit =
              document.querySelector("textarea")?.value || "";
          }
          return true;
        },
      });
    });
    await install(page, published, entries);
    await page.locator("#copy").click();
    await expect.poll(() => page.evaluate(() =>
      (window as any).__fallbackCopyForScriptAudit
    )).toBe("fallback content");
    await expect(page.locator("textarea")).toHaveCount(0);
  });

  test(mode + ": scroll-to invokes the browser API for the selected element", async ({ page }) => {
    const entries: Entry[] = [
      { trigger: "click", steps: [{ id: "scroll", kind: "scroll-to", target: "target" }] },
    ];
    await page.setContent('<main data-page-body="a"><button id="scroll">Scroll</button><div id="target">Target</div></main>');
    await attach(page, "#scroll", entries);
    await page.evaluate(() => {
      (document.getElementById("target") as HTMLElement).scrollIntoView = (options) => {
        (window as any).__scriptScrollOptions = options;
      };
    });
    await install(page, published, entries);
    await page.locator("#scroll").click();
    await expect.poll(() => page.evaluate(() => (window as any).__scriptScrollOptions)).toEqual({
      behavior: "smooth",
      block: "start",
    });
  });

  test(mode + ": a hover menu stays open on its shown element and closes on exit", async ({ page }) => {
    const entries: Entry[] = [
      { trigger: "hover-start", steps: [{ id: "show", kind: "show", target: "menu" }] },
      { trigger: "hover-end", keep: true, steps: [{ id: "hide", kind: "hide", target: "menu" }] },
    ];
    await page.setContent(
      '<main data-page-body="a"><div id="owner" style="width:140px;height:48px">Open</div>' +
      '<div id="menu" style="display:none;width:140px;height:80px">Menu</div>' +
      '<div id="outside" style="margin-top:200px;width:140px;height:50px">Outside</div></main>'
    );
    await attach(page, "#owner", entries);
    await install(page, published, entries);
    await page.locator("#owner").hover();
    await expect(page.locator("#menu")).toBeVisible();
    // Move the pointer directly: locator.hover() may wait for actionability
    // long enough for the delayed exit to hide a sibling menu.
    const menu = page.locator("#menu");
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(220);
    await expect(menu).toBeVisible();
    await page.locator("#outside").hover();
    await expect(page.locator("#menu")).toBeHidden();
  });
}
