import { expect, test, type Page } from "@playwright/test";

/**
 * スクリプトの画面を、実際のエディタで通しで確かめる。
 * きっかけを選ぶ → ページの上で要素を選ぶ → 動作を追加・並べ替え・削除する。
 */

const rootCards = (page: Page) => page.locator('.se-steps[data-list="root"] > .se-card');
const kinds = (page: Page) => rootCards(page).evaluateAll((cards) =>
  cards.map((card) => (card as HTMLElement).dataset.stepKind).join());

async function addAction(page: Page, key: string, button = '.se-steps[data-list="root"] > .se-add') {
  await page.locator(button).first().click();
  await page.locator(`.se-picker [data-action="${key}"]`).click();
  await expect(page.locator(".se-picker")).toHaveCount(0);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const created = await page.request.post("/api/sites", { data: { name: "Script editor", repo: "example/script-editor" } });
  expect(created.ok()).toBe(true);
  const { site } = await created.json();
  await page.goto(`/sites/${site.id}`);
  await page.locator(".cv-root").waitFor();
  const edit = page.getByRole("button", { name: "スクリプトを編集", exact: true });
  if (!(await edit.isVisible())) await page.locator('[data-tutorial="page-scripts"]').first().locator("button").first().click();
  await edit.click();
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
  // きっかけを選び、ページの上で要素を直接クリックして選ぶ
  await page.locator(".se-new").click();
  await page.locator('[data-trigger="click"]').click();
  await page.locator("[data-pick-on-page]").click();
  await expect(page.locator(".se-pick-bar")).toBeVisible();
  const box = (await page.locator(".cv-root [data-node]").nth(3).boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 8);
  await page.mouse.click(box.x + 12, box.y + 10);
  await expect(page.locator(".se-pick-bar")).toHaveCount(0);
  await expect(page.locator('.se-steps[data-list="root"]')).toBeVisible();
});

test("a script is built by choosing a trigger, an element on the page, and actions", async ({ page }) => {
  for (const key of ["show", "wait", "if", "dialog"]) await addAction(page, key);
  expect(await kinds(page)).toBe("show,wait,if,dialog");
  // まだ決めていない欄があるカードには印が付き、スクリプトの状態にも数が出る
  await expect(page.locator(".se-todo")).toHaveCount(2);
  await expect(page.locator(".se-status")).not.toHaveClass(/is-ready/);

  // 「もし」の中にも、カードの間にも追加できる
  await addAction(page, "copy", '.se-card[data-step-kind="if"] .se-branch .se-add');
  await expect(page.locator('.se-card[data-step-kind="if"] .se-branch .se-card[data-step-kind="copy"]')).toHaveCount(1);
  const gap = page.locator('.se-steps[data-list="root"] > .se-gap').nth(1);
  await gap.hover();
  await gap.locator(".se-gap-btn").click();
  await page.locator('.se-picker [data-action="scroll-to"]').click();
  expect(await kinds(page)).toBe("show,scroll-to,wait,if,dialog");
});

test("the picker only offers actions that work at that place and closes on Escape", async ({ page }) => {
  await page.locator('.se-steps[data-list="root"] > .se-add').click();
  await page.locator(".se-picker input").fill("くり返");
  await expect(page.locator('.se-picker [data-action="break-loop"]')).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator('.se-picker [data-action="repeat"]')).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".se-picker")).toHaveCount(0);
  await expect(page.locator(".se")).toBeVisible();
});

test("cards are reordered by dragging the card, into branches too, and Escape cancels", async ({ page }) => {
  for (const key of ["show", "wait", "if", "dialog"]) await addAction(page, key);
  const center = async (selector: string) => {
    // 並べ替えた直後は、カードが新しい位置へ動くアニメーションの途中なので、終わってから測る
    await page.waitForFunction(() =>
      document.querySelector(".se-flow")!.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running"));
    const box = (await page.locator(selector).first().boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const first = (await rootCards(page).first().boundingBox())!;
  await drag(page, await center('.se-card[data-step-kind="dialog"] > .se-card-head > .se-ico'), { x: first.x + 60, y: first.y + 4 });
  await expect(page.locator(".se-drop-line")).toBeVisible();
  await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll('.se-steps[data-list="root"] > .se-card')].map((c) => (c as HTMLElement).dataset.stepKind).join() === "dialog,show,wait,if");

  const from = await center('.se-card[data-step-kind="wait"] > .se-card-head > .se-ico');
  const inside = (await page.locator('.se-card[data-step-kind="if"] .se-branch .se-add').boundingBox())!;
  await drag(page, from, { x: inside.x + 80, y: inside.y + 10 });
  // 選択していなかったカードをつかむと選択が変わるが、持ち上げた状態は保たれる
  await expect(page.locator('.se-card[data-step-kind="wait"][data-drag="lifted"]')).toHaveClass(/is-selected/);
  await page.mouse.up();
  await expect(page.locator('.se-card[data-step-kind="if"] .se-branch .se-card[data-step-kind="wait"]')).toHaveCount(1);

  const before = await kinds(page);
  const grip = await center(".se-card > .se-card-head > .se-ico");
  await drag(page, grip, { x: grip.x + 10, y: grip.y + 220 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await kinds(page)).toBe(before);
  await expect(page.locator(".se")).toBeVisible();
});

test("the same reordering works from the keyboard and the card menu, and is undoable", async ({ page }) => {
  for (const key of ["show", "wait", "dialog"]) await addAction(page, key);
  const card = rootCards(page).first();
  await card.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => kinds(page)).toBe("wait,show,dialog");
  await expect(page.locator(".se-card:focus")).toHaveCount(1);

  await rootCards(page).first().locator("> .se-card-head .se-card-more").click();
  await page.locator(".se-menu button", { hasText: "複製" }).click();
  await expect.poll(() => kinds(page)).toBe("wait,wait,show,dialog");
  await page.keyboard.press("Backspace");
  await expect.poll(() => kinds(page)).toBe("wait,show,dialog");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kinds(page)).toBe("wait,wait,show,dialog");
});

test("action menus copy, cut and paste blocks, including after undo and redo", async ({ page }) => {
  await addAction(page, "show");
  await addAction(page, "wait");

  await rootCards(page).first().locator("> .se-card-head .se-card-more").click();
  await page.locator(".se-menu button").filter({ hasText: "コピー" }).click();
  await rootCards(page).nth(1).locator("> .se-card-head .se-card-more").click();
  await page.locator(".se-menu button").filter({ hasText: "貼り付け" }).click();
  await expect.poll(() => kinds(page)).toBe("show,wait,show");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kinds(page)).toBe("show,wait");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => kinds(page)).toBe("show,wait,show");

  await rootCards(page).last().locator("> .se-card-head .se-card-more").click();
  await page.locator(".se-menu button").filter({ hasText: "切り取り" }).click();
  await expect.poll(() => kinds(page)).toBe("show,wait");
  // 選択がない場合は、画面上部の「貼り付け」で最後に追加する。
  await page.locator('.se-header [aria-label="貼り付け"]').click();
  await expect.poll(() => kinds(page)).toBe("show,wait,show");
});

test("selected cards accept clipboard events without intercepting text fields", async ({ page }) => {
  await addAction(page, "show");
  await addAction(page, "wait");
  const first = rootCards(page).first();
  // Hit the card border, not an interactive control.
  await first.click({ position: { x: 5, y: 4 } });
  await expect(first).toHaveClass(/is-selected/);
  await expect(first).toBeFocused();

  const raw = await page.evaluate(() => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error("The script editor did not handle copy");
    return data.getData("text/plain");
  });
  expect(raw).toContain("Tsumu script actions");

  await rootCards(page).nth(1).click({ position: { x: 5, y: 4 } });
  const handled = await page.evaluate((plain) => {
    const data = new DataTransfer();
    data.setData("text/plain", plain);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, raw);
  expect(handled).toBe(true);
  await expect.poll(() => kinds(page)).toBe("show,wait,show");
});

test("unset action fields allow copying and pasting the containing block without taking text paste", async ({ page }) => {
  await addAction(page, "copy");
  await addAction(page, "show");
  const original = rootCards(page).first();
  const blankInput = original.locator("input.se-in.is-empty").first();
  await expect(blankInput).toHaveValue("");
  await blankInput.focus();

  // The last added action ("show") remains selected. Copying from the empty
  // input must copy its own "copy" action rather than that stale selection.
  const copied = await blankInput.evaluate((input) => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    input.dispatchEvent(event);
    return { handled: event.defaultPrevented, text: data.getData("text/plain") };
  });
  expect(copied.handled).toBe(true);
  const payload = JSON.parse(copied.text.slice("Tsumu script actions v1\n".length));
  expect(payload.steps).toMatchObject([{ kind: "copy", value: "" }]);

  const pasted = await blankInput.evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }, copied.text);
  expect(pasted).toBe(true);
  await expect.poll(() => kinds(page)).toBe("copy,copy,show");
  expect(await rootCards(page).nth(1).locator("input.se-in").first().inputValue()).toBe("");
  const ids = await rootCards(page).evaluateAll((cards) =>
    cards.map((card) => (card as HTMLElement).dataset.stepId));
  expect(new Set(ids).size).toBe(3);

  // Ordinary text paste in an unset field must remain a native input action.
  const ordinaryText = await blankInput.evaluate((input) => {
    const data = new DataTransfer();
    data.setData("text/plain", "some text");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(ordinaryText).toBe(false);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kinds(page)).toBe("copy,show");
});

test("real keyboard shortcuts copy and paste an unset target picker block", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await addAction(page, "show");
  await addAction(page, "wait");

  // The last action is still selected, but focus moves to the first action's unset button.
  const unset = rootCards(page).first().locator("button.se-in.is-empty").first();
  await unset.focus();
  await page.keyboard.press("ControlOrMeta+c");
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("Tsumu script actions v1");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(text.slice("Tsumu script actions v1\n".length)).steps)
    .toMatchObject([{ kind: "show", target: "" }]);

  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => kinds(page)).toBe("show,show,wait");

  // Opening the target picker must not prevent copying its owner action.
  await unset.click();
  await expect(page.locator("[data-se-popover]")).not.toHaveCount(0);
  await unset.focus();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("Escape");
  await rootCards(page).last().focus();
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => kinds(page)).toBe("show,show,wait,show");

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kinds(page)).toBe("show,show,wait");
});

test("real keyboard shortcuts copy an unset select while filled text retains native copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await addAction(page, "open-page");
  await addAction(page, "copy");
  const select = rootCards(page).first().locator("select.se-in.is-empty").first();
  await select.focus();
  await page.keyboard.press("ControlOrMeta+c");
  const raw = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(raw.slice("Tsumu script actions v1\n".length)).steps)
    .toMatchObject([{ kind: "open-page", pageId: "" }]);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(() => kinds(page)).toBe("open-page,open-page,copy");

  const textInput = rootCards(page).last().locator("input.se-in").first();
  await textInput.fill("example");
  await textInput.press("ControlOrMeta+a");
  await textInput.press("ControlOrMeta+c");
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe("example");
  await textInput.press("ControlOrMeta+v");
  await expect.poll(() => kinds(page)).toBe("open-page,open-page,copy");
});

test("a script that only opens a page is complete as soon as the page is chosen", async ({ page }) => {
  await addAction(page, "open-page");
  await expect(page.locator(".se-status")).not.toHaveClass(/is-ready/);
  await page.locator('.se-card[data-step-kind="open-page"] select').nth(1).selectOption({ index: 1 });
  // ボックスでは保存するとリンクになり ID が変わるが、開いていたスクリプトは開いたままにする
  await expect(page.locator(".se-when")).toBeVisible();
  await expect(page.locator('.se-card[data-step-kind="open-page"]')).toHaveCount(1);
  await expect(page.locator(".se-status")).toHaveClass(/is-ready/);
});
