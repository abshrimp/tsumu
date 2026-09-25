import { expect, test, type Page } from "@playwright/test";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import type { ScriptStep, ScriptTrigger, SiteDoc } from "../lib/types";

type Entry = { trigger: ScriptTrigger; steps: ScriptStep[]; keep?: boolean };

function fixture(entries: Entry[]): SiteDoc {
  const pageScripts = entries.map((entry, index) => ({
    id: "script-" + index,
    trigger: entry.trigger,
    keepOnShown: !!entry.keep,
    pos: { x: 0, y: 0 },
    steps: entry.steps,
  }));
  return {
    schemaVersion: 1, siteName: "Script browser tests",
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

    // 監視の仕組みは、元の要素が取り外された後に、すでにキューに入った項目を届けることがある。
    await page.evaluate((scripts) => {
      const old = document.getElementById("old")!;
      document.body.innerHTML = '<main data-page-body="b"><div id="banner">B</div><div id="fresh"></div></main>';
      document.getElementById("fresh")!.setAttribute("data-scripts", JSON.stringify(scripts));
      (window as any).__deliverScriptIntersection(old);
    }, entries);
    await expect(page.locator("#banner")).toBeVisible();
    await expect(page.locator("#banner")).toHaveText("B");

    // 新しいページの新しい要素は、正当な通知を引き続き受け取らなければならない。
    await expect.poll(() => page.evaluate(() =>
      (window as any).__observedForScriptAudit.has(document.getElementById("fresh"))
    )).toBe(true);
    await page.evaluate(() =>
      (window as any).__deliverScriptIntersection(document.getElementById("fresh"))
    );
    await expect(page.locator("#banner")).toBeHidden();
  });

  test(mode + ": alert shows resolved variables and continues after dismissal", async ({ page }) => {
    const entries: Entry[] = [{
      trigger: "click",
      steps: [
        { id: "set", kind: "set-var", into: "customer", value: "田中" },
        { id: "dialog", kind: "dialog", mode: "alert", message: "こんにちは {customer}" },
        { id: "hide", kind: "hide", target: "result" },
      ],
    }];
    await page.setContent('<main data-page-body="a"><button id="trigger">Open alert</button><div id="result">Result</div></main>');
    await attach(page, "#trigger", entries);
    await install(page, published, entries);
    const messages: string[] = [];
    page.on("dialog", async (dialog) => {
      expect(dialog.type()).toBe("alert");
      messages.push(dialog.message());
      await dialog.accept();
    });
    await page.locator("#trigger").click();
    await expect.poll(() => messages).toEqual(["こんにちは 田中"]);
    await expect(page.locator("#result")).toBeHidden();
  });

  for (const scenario of [
    { mode: "confirm" as const, accepted: true, value: true },
    { mode: "confirm" as const, accepted: false, value: false },
    { mode: "prompt" as const, accepted: true, value: "入力した文字列" },
    { mode: "prompt" as const, accepted: false, value: null },
  ]) {
    test(mode + ": " + scenario.mode + (scenario.accepted ? " accepted" : " cancelled") +
      " saves the correct result and continues", async ({ page }) => {
      const entries: Entry[] = [{
        trigger: "click",
        steps: [
          { id: "seed", kind: "set-var", into: "seed", value: "初期値" },
          { id: "dialog", kind: "dialog", mode: scenario.mode, message: "確認しますか {seed}",
            defaultValue: "{seed}", into: "answer" },
          { id: "after", kind: "set-var", into: "after", value: "continued" },
        ],
      }];
      await page.setContent('<main data-page-body="a"><button id="trigger">Show dialog</button></main>');
      await attach(page, "#trigger", entries);
      await page.evaluate(() => {
        (window as any).__dialogWrites = [];
        (window as any).__siteVarsOnChange = (key: string, value: unknown) => {
          (window as any).__dialogWrites.push([key, value]);
        };
      });
      await install(page, published, entries);
      const dialogs: string[] = [];
      page.on("dialog", async (dialog) => {
        dialogs.push(dialog.message());
        expect(dialog.type()).toBe(scenario.mode);
        if (scenario.mode === "prompt") expect(dialog.defaultValue()).toBe("初期値");
        if (scenario.accepted) await dialog.accept(scenario.mode === "prompt" ? "入力した文字列" : undefined);
        else await dialog.dismiss();
      });
      await page.locator("#trigger").click();
      await expect.poll(() => dialogs).toEqual(["確認しますか 初期値"]);
      await expect.poll(() => page.evaluate(() => (window as any).__dialogWrites)).toContainEqual(
        ["answer", scenario.value]
      );
      await expect.poll(() => page.evaluate(() => (window as any).__dialogWrites)).toContainEqual(
        ["after", "continued"]
      );
    });
  }

  test(mode + ": denied Clipboard API does not invoke deprecated DOM copy", async ({ page }) => {
    const entries: Entry[] = [
      { trigger: "click", steps: [{ id: "copy", kind: "copy", value: "fallback content" }] },
    ];
    await page.setContent('<main data-page-body="a"><button id="copy">Copy</button></main>');
    await attach(page, "#copy", entries);
    await page.evaluate(() => {
      (window as any).__modernCopyForScriptAudit = "";
      (window as any).__legacyCopyForScriptAudit = false;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (value: string) => {
          (window as any).__modernCopyForScriptAudit = value;
          return Promise.reject(new Error("denied"));
        } },
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => {
          (window as any).__legacyCopyForScriptAudit = true;
          throw new Error("Deprecated copy must not run");
        },
      });
    });
    await install(page, published, entries);
    await page.locator("#copy").click();
    await expect.poll(() => page.evaluate(() =>
      (window as any).__modernCopyForScriptAudit
    )).toBe("fallback content");
    expect(await page.evaluate(() => (window as any).__legacyCopyForScriptAudit)).toBe(false);
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
    // ポインターを直接動かす。locator.hover() は操作できる状態になるまで待つことがあり、
    // その間に、遅れて外れる処理が兄弟のメニューを隠してしまう。
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
