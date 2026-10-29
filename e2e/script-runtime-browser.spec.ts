import { expect, test, type Page } from "@playwright/test";
import { applyPagePayload, buildPagePayload } from "../lib/page-transfer";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import type { ScriptStep, ScriptTrigger, SiteDoc } from "../lib/types";
import { anchorFixture, renderAnchorExport } from "../tests/helpers/instance-anchor";
import { queryCopyFixture, renderQueryCopyExport } from "../tests/helpers/page-copy-query";
import { publishedRadioClear } from "../tests/helpers/radio-clear-bindings";

type Entry = { trigger: ScriptTrigger; steps: ScriptStep[]; keep?: boolean };

function fixture(entries: Entry[]): SiteDoc {
  const pageScripts = entries.map((entry, index) => ({
    id: "script-" + index,
    trigger: entry.trigger,
    keepOnShown: !!entry.keep,
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

  test(mode + ": alert, confirm, and prompt dialogs resolve variables, save results, and continue", async ({ page }) => {
    const alertEntries: Entry[] = [{
      trigger: "click",
      steps: [
        { id: "set", kind: "set-var", into: "customer", value: "田中" },
        { id: "dialog", kind: "dialog", mode: "alert", message: "こんにちは {customer}" },
        { id: "hide", kind: "hide", target: "result" },
      ],
    }];
    const confirmEntries: Entry[] = [{
      trigger: "click",
      steps: [
        { id: "seed", kind: "set-var", into: "seed", value: "初期値" },
        { id: "reset", kind: "set-var", into: "after", value: "" },
        { id: "dialog", kind: "dialog", mode: "confirm", message: "確認しますか {seed}", into: "answer" },
        { id: "after", kind: "set-var", into: "after", value: "continued" },
      ],
    }];
    const promptEntries: Entry[] = [{
      trigger: "click",
      steps: [
        { id: "seed", kind: "set-var", into: "seed", value: "初期値" },
        { id: "reset", kind: "set-var", into: "after", value: "" },
        { id: "dialog", kind: "dialog", mode: "prompt", message: "確認しますか {seed}", defaultValue: "{seed}", into: "answer" },
        { id: "after", kind: "set-var", into: "after", value: "continued" },
      ],
    }];
    await page.setContent(
      '<main data-page-body="a"><button id="alert-btn">Alert</button><button id="confirm-btn">Confirm</button><button id="prompt-btn">Prompt</button><div id="result">Result</div></main>'
    );
    await attach(page, "#alert-btn", alertEntries);
    await attach(page, "#confirm-btn", confirmEntries);
    await attach(page, "#prompt-btn", promptEntries);
    await page.evaluate(() => {
      (window as any).__dialogWrites = [];
      (window as any).__siteVarsOnChange = (key: string, value: unknown) => {
        (window as any).__dialogWrites.push([key, value]);
      };
    });
    await install(page, published, [...alertEntries, ...confirmEntries, ...promptEntries]);

    let nextAction: { expectedType: string; accept: boolean; text?: string } = { expectedType: "alert", accept: true };
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      expect(dialog.type()).toBe(nextAction.expectedType);
      if (nextAction.expectedType === "prompt") expect(dialog.defaultValue()).toBe("初期値");
      if (nextAction.accept) await dialog.accept(nextAction.text);
      else await dialog.dismiss();
    });

    await page.locator("#alert-btn").click();
    await expect.poll(() => dialogs).toEqual(["こんにちは 田中"]);
    await expect(page.locator("#result")).toBeHidden();

    for (const scenario of [
      { btn: "#confirm-btn", mode: "confirm", accept: true, value: true },
      { btn: "#confirm-btn", mode: "confirm", accept: false, value: false },
      { btn: "#prompt-btn", mode: "prompt", accept: true, text: "入力した文字列", value: "入力した文字列" },
      { btn: "#prompt-btn", mode: "prompt", accept: false, value: null },
    ]) {
      dialogs.length = 0;
      await page.evaluate(() => { (window as any).__dialogWrites.length = 0; });
      nextAction = { expectedType: scenario.mode, accept: scenario.accept, text: scenario.text };
      await page.locator(scenario.btn).click();
      await expect.poll(() => dialogs).toEqual(["確認しますか 初期値"]);
      await expect.poll(() => page.evaluate(() => (window as any).__dialogWrites)).toContainEqual(["answer", scenario.value]);
      await expect.poll(() => page.evaluate(() => (window as any).__dialogWrites)).toContainEqual(["after", "continued"]);
    }
  });

  test(mode + ": fetch inside a condition waits for JSON before continuing", async ({ page }) => {
    const entries: Entry[] = [{ trigger: "click", steps: [
      { id: "seed", kind: "set-var", into: "search", value: "hello world" },
      { id: "condition", kind: "if",
        cond: { subject: "var", target: "", left: "{search}", op: "eq", value: "hello world" },
        then: [{
          id: "request", kind: "fetch", as: "items",
          url: "https://api.example.test/?q={search}",
          method: "POST", body: '{"query":"{search}"}',
        }],
      },
      { id: "after", kind: "set-var", into: "after", value: "{items.0.title}" },
    ] }];
    await page.goto("/robots.txt");
    await page.setContent('<main data-page-body="a"><button id="trigger">Request</button></main>');
    await attach(page, "#trigger", entries);
    await page.evaluate(() => {
      (window as any).__writes = [];
      (window as any).__requests = [];
      (window as any).__siteVarsOnChange = (key: string, value: unknown) => {
        (window as any).__writes.push([key, value]);
      };
      window.fetch = (async (url, options) => {
        (window as any).__requests.push({ url, method: options?.method, body: options?.body,
          credentials: options?.credentials });
        return await new Promise<Response>(resolve => {
          (window as any).__completeRequest = () => resolve(Response.json([{ title: "Fetched" }]));
        });
      }) as typeof fetch;
    });
    await install(page, published, entries);
    await page.locator("#trigger").click();
    await expect.poll(() => page.evaluate(() => (window as any).__requests.length)).toBe(1);
    const request = await page.evaluate(() => (window as any).__requests[0]);
    expect(request).toEqual({
      url: "https://api.example.test/?q=hello%20world",
      method: "POST", body: '{"query":"hello world"}', credentials: "omit",
    });
    expect(await page.evaluate(() => (window as any).__writes.map((item: unknown[]) => item[0])))
      .toEqual(["search"]);
    await page.evaluate(() => (window as any).__completeRequest());
    await expect.poll(() => page.evaluate(() => (window as any).__writes.at(-1)))
      .toEqual(["after", "Fetched"]);
  });

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
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      await page.locator("#scroll").click();
      await expect.poll(() => page.evaluate(() => (window as any).__scriptScrollOptions)).toEqual({
        behavior: reducedMotion === "reduce" ? "instant" : "smooth",
        block: "start",
      });
    }
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

// 書き出した DOM を使い、アンカーへの移動と表示を切り替えるスクリプトが、同じコンポーネントを対象にすることを確かめる。
test("Published instance anchors and visibility toggles preserve the master's layout", async ({ page }) => {
  const doc = anchorFixture();
  const { html, css } = renderAnchorExport(doc);
  await page.setContent(html);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: scriptsFile(doc) });
  await expect(page.locator("#first-card")).toHaveCount(1);
  await expect(page.locator("#second-card")).toHaveCount(1);
  await expect(page.locator("#first-card")).toBeHidden();
  await page.locator("#show").click();
  await expect(page.locator("#first-card")).toBeVisible();
  await expect(page.locator("#first-card")).toHaveCSS("display", "flex");
  await expect(page.locator("#second-card")).toBeHidden();
  await page.locator("#jump").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#first-card");
  await expect(page.locator("div")).toHaveCount(2);
});

test("copied links and script buttons navigate to the matching query variant", async ({ page }) => {
  const { source, target } = queryCopyFixture();
  applyPagePayload(target, buildPagePayload(source, ["home"]));
  const { html } = renderQueryCopyExport(target);
  // 移動はすべてローカルで応答し、外部のサイトには接続しない。
  await page.route("**/*", (route) => route.fulfill({
    contentType: "text/html",
    body: new URL(route.request().url()).search === "?tab=news" ? "<main>News</main>" : "<main>Other</main>",
  }));
  for (const selector of ["#news-link", "#news-button"]) {
    await page.goto("https://page-copy.test/");
    await page.setContent(html);
    await page.addScriptTag({ content: scriptsFile(target) });
    await page.locator(selector).click();
    await expect(page).toHaveURL("https://page-copy.test/blog?tab=news");
    await expect(page.locator("main")).toHaveText("News");
  }
});

// 公開したサイトのランタイムは、Next.js のページ遷移をまたいで残る。
// 古いページで保留中の処理が、新しいページの同じ ID に影響しないことを、実際の DOM で確かめる。
test("Pending scripts from a previous page do not continue after navigating away", async ({ page }) => {
  const steps = [
    { id: "wait", kind: "wait" as const, seconds: 1 },
    { id: "hide", kind: "hide" as const, target: "banner" },
  ];
  const scripts = [{ id: "load", trigger: "load" as const, steps }];
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Navigation", pageOrder: ["a", "b"], nodes: {}, assets: {},
    pages: {
      a: { id: "a", name: "A", slug: "", title: "A", description: "", children: [], pageScripts: scripts },
      b: { id: "b", name: "B", slug: "b", title: "B", description: "", children: [] },
    },
  };
  await page.clock.install();
  await page.setContent('<span hidden data-page-body="a"></span><div id="banner">Page A</div>');
  await page.locator("[data-page-body]").evaluate((el, scripts) => el.setAttribute("data-scripts", JSON.stringify(scripts)), scripts);
  await page.addScriptTag({ content: scriptsFile(doc) });
  await page.evaluate(() => {
    document.body.innerHTML = '<span hidden data-page-body="b"></span><div id="banner">Page B</div>';
  });
  await page.clock.runFor(1500);
  await expect(page.locator("#banner")).toBeVisible();
  await expect(page.locator("#banner")).toHaveText("Page B");
});

test.describe("Published radio clear bindings", () => {
  async function installRadio(page: Page, clearOnChange = false) {
    const published = await publishedRadioClear(clearOnChange);
    await page.setContent(published.html);
    await page.addScriptTag({ content: published.script });
    await page.evaluate(() => {
      const events: string[] = [];
      (window as any).radioEvents = events;
      for (const type of ["input", "change"]) document.addEventListener(type, (event) => {
        const input = event.target as HTMLInputElement;
        if (input.type === "radio") events.push(`${input.parentElement!.id}:${type}`);
      });
    });
  }

  async function expectCleared(page: Page) {
    await expect(page.locator("#small input")).not.toBeChecked();
    await expect(page.locator("#medium input")).not.toBeChecked();
    await expect(page.locator("#red input")).toBeChecked();
    await expect(page.locator("#result")).toHaveText("size=; small=false; medium=false; index=; color=red");
    await expect(page.locator("#dependent")).toHaveValue("Selected: ");
    await expect(page.locator("#dependent")).toHaveAttribute("placeholder", "Index: ");
  }

  test("Clearing a radio on a published page updates visible output without firing synthetic radio events", async ({ page }) => {
    for (const button of ["clear-item-0", "clear-group", "unknown-group"]) {
      await installRadio(page);
      await expect(page.locator("#result")).toHaveText("size=S; small=true; medium=false; index=1; color=red");
      await page.locator(`#${button}`).click();
      await expectCleared(page);
      await expect(page.locator("#counts")).toHaveText("||");
      expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([]);
      await page.locator(`#${button}`).click();
      await expectCleared(page);
      expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([]);
    }
  });

  test("Selecting another radio fires change once, and clearing in a change handler avoids recursion", async ({ page }) => {
    await installRadio(page);
    await page.locator("#select-medium").click();
    await expect(page.locator("#counts")).toHaveText("|1|");
    await expect(page.locator("#result")).toHaveText("size=M; small=false; medium=true; index=2; color=red");
    await page.locator("#select-medium").click();
    await expect(page.locator("#counts")).toHaveText("|1|");
    await page.locator("#select-small").click();
    await expect(page.locator("#counts")).toHaveText("1|1|");
    await page.locator("#clear-group").click();
    await expectCleared(page);
    await expect(page.locator("#counts")).toHaveText("1|1|");
    expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([
      "medium:input", "medium:change", "small:input", "small:change",
    ]);

    await installRadio(page, true);
    await page.locator("#select-medium").click();
    await page.locator("#select-small").click();
    await expectCleared(page);
    await expect(page.locator("#counts")).toHaveText("1|1|");
    expect(await page.evaluate(() => (window as any).radioEvents)).toEqual([
      "medium:input", "medium:change", "small:input", "small:change",
    ]);
  });

  test("Manual selection emits one notification and clearing a radio preserves edited fields", async ({ page }) => {
    await installRadio(page);
    await page.locator("#clear-group").click();
    await page.locator("#toggle-sizes").click();
    await expect(page.locator("#small input")).toBeDisabled();
    await expect(page.locator("#medium input")).toBeDisabled();
    await expect(page.locator("#red input")).toBeEnabled();
    await page.locator("#toggle-sizes").click();
    await expect(page.locator("#small input")).toBeEnabled();
    await page.locator("#medium input").check();
    await expect(page.locator("#result")).toHaveText("size=M; small=false; medium=true; index=2; color=red");
    await expect(page.locator("#counts")).toHaveText("|1|");
    await page.locator("#clear-item-0").click();
    await expect(page.locator("#medium input")).toBeChecked();
    await page.locator("#dependent").fill("My own text");
    await page.locator("#clear-group").click();
    await expect(page.locator("#dependent")).toHaveValue("My own text");
    await expect(page.locator("#dependent")).toHaveAttribute("placeholder", "Index: ");
    await expect(page.locator("#result")).toHaveText("size=; small=false; medium=false; index=; color=red");
    await expect(page.locator("#counts")).toHaveText("|1|");
    expect(await page.evaluate(() => (window as any).radioEvents)).toEqual(["medium:input", "medium:change"]);
  });
});
