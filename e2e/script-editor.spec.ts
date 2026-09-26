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

test("cards are reordered by dragging the handle, into branches too, and Escape cancels", async ({ page }) => {
  for (const key of ["show", "wait", "if", "dialog"]) await addAction(page, key);
  const center = async (selector: string) => {
    // 並べ替えた直後は、カードが新しい位置へ動くアニメーションの途中なので、終わってから測る
    await page.waitForFunction(() =>
      document.querySelector(".se-flow")!.getAnimations({ subtree: true }).every((animation) => animation.playState !== "running"));
    const box = (await page.locator(selector).first().boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const first = (await rootCards(page).first().boundingBox())!;
  await drag(page, await center('.se-card[data-step-kind="dialog"] > .se-card-head > .se-grip'), { x: first.x + 60, y: first.y + 4 });
  await expect(page.locator(".se-drop-line")).toBeVisible();
  await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll('.se-steps[data-list="root"] > .se-card')].map((c) => (c as HTMLElement).dataset.stepKind).join() === "dialog,show,wait,if");

  const from = await center('.se-card[data-step-kind="wait"] > .se-card-head > .se-grip');
  const inside = (await page.locator('.se-card[data-step-kind="if"] .se-branch .se-add').boundingBox())!;
  await drag(page, from, { x: inside.x + 80, y: inside.y + 10 });
  // 選択していなかったカードをつかむと選択が変わるが、持ち上げた状態は保たれる
  await expect(page.locator('.se-card[data-step-kind="wait"][data-drag="lifted"]')).toHaveClass(/is-selected/);
  await page.mouse.up();
  await expect(page.locator('.se-card[data-step-kind="if"] .se-branch .se-card[data-step-kind="wait"]')).toHaveCount(1);

  const before = await kinds(page);
  const grip = await center(".se-card > .se-card-head > .se-grip");
  await drag(page, grip, { x: grip.x + 10, y: grip.y + 220 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await kinds(page)).toBe(before);
  await expect(page.locator(".se")).toBeVisible();
});

test("the same reordering works from the keyboard and the card menu, and is undoable", async ({ page }) => {
  for (const key of ["show", "wait", "dialog"]) await addAction(page, key);
  const grip = rootCards(page).first().locator("> .se-card-head > .se-grip");
  await grip.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => kinds(page)).toBe("wait,show,dialog");
  await expect(page.locator(".se-grip:focus")).toHaveCount(1);

  await rootCards(page).first().locator("> .se-card-head .se-card-more").click();
  await page.locator(".se-menu button", { hasText: "複製" }).click();
  await expect.poll(() => kinds(page)).toBe("wait,wait,show,dialog");
  await page.keyboard.press("Backspace");
  await expect.poll(() => kinds(page)).toBe("wait,show,dialog");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => kinds(page)).toBe("wait,wait,show,dialog");
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
