import { test, expect, type Page } from "@playwright/test";
import { aiChatBundle } from "../tests/helpers/ai-chat";
import { aiCloneBundle } from "../tests/helpers/ai-clone";

test.describe("ai-chat-history", () => {
test.describe("AI chat history", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await aiChatBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<main id="app"></main>');
    await page.addScriptTag({ content: bundle });
    await page.locator(".ai-suggest button").first().click();
  });

  for (const changes of [false, true]) {
    test(`AI ${changes ? "change has its own Undo" : "no-op does not offer Undo for a manual change"}`, async ({ page }) => {
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      await page.evaluate((changes) => {
        const state = (window as any).aiHistoryEditor.getState();
        state.setActivePage("q");
        state.updateDoc((doc: any) => { doc.nodes.b.text.content = "Manual B"; });
        (window as any).finishAiHistory([{ op: "set_text", id: "a", text: changes ? "AI A" : "Original A" }]);
      }, changes);
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(page.locator(".ai-msg.is-assistant > p")).toHaveText("Done");
      const undo = page.locator(".ai-msg-meta button");
      await expect(undo).toHaveCount(changes ? 1 : 0);
      if (changes) {
        await undo.click();
        expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc.nodes.a.text.content)).toBe("Original A");
        await page.evaluate(() => (window as any).aiHistoryEditor.getState().redo());
        expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc.nodes.a.text.content)).toBe("AI A");
      }
      expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc.nodes.b.text.content)).toBe("Manual B");
    });
  }

  for (const mode of ["no-op", "change", "cancel"] as const) {
    test(`AI ${mode} preserves an in-progress numeric scrub`, async ({ page }) => {
      await page.evaluate(() => (window as any).aiHistoryEditor.getState().setActivePage("q"));
      const beforeManual = await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc);
      const scrub = page.locator(".field-pre.scrub");
      const box = (await scrub.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
      await page.evaluate((mode) => (window as any).finishAiHistory([
        { op: "set_text", id: "a", text: mode === "change" ? "AI A" : "Original A" },
      ]), mode);
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      await expect(page.locator(".ai-msg-meta button")).toHaveCount(0);
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
      const manual = await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc);
      expect(manual.nodes.b.styles.base.default.fontSize).toBe(`${parseFloat(beforeManual.nodes.b.styles.base.default.fontSize) + 20}px`);
      if (mode === "cancel") await page.locator(".ai-activity-head button").evaluate((button) => (button as HTMLButtonElement).click());
      await page.mouse.up();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      const undo = page.locator(".ai-msg-meta button");
      await expect(undo).toHaveCount(mode === "change" ? 1 : 0);
      if (mode === "change") await undo.click();
      expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc)).toEqual(manual);
      await page.evaluate(() => (window as any).aiHistoryEditor.getState().undo());
      expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc)).toEqual(beforeManual);
      await page.evaluate(() => (window as any).aiHistoryEditor.getState().redo());
      expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc)).toEqual(manual);
      if (mode === "change") {
        await page.evaluate(() => (window as any).aiHistoryEditor.getState().redo());
        expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc.nodes.a.text.content)).toBe("AI A");
        expect(await page.evaluate(() => (window as any).aiHistoryEditor.getState().doc.nodes.b)).toEqual(manual.nodes.b);
      }
    });
  }
});

test("AI availability is checked once per editor load, not on focus", async ({ page }) => {
  const created = await page.request.post("/api/sites", { data: { name: "AI availability" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json() as { site: { id: string } };

  let checks = 0;
  await page.route("**/api/ai", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    checks++;
    return route.fulfill({ json: { enabled: false, provider: null, model: null } });
  });

  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas"]')).toBeVisible();
  await expect.poll(() => checks).toBe(1);

  // Returning to this tab or window must not request the same configuration again.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  expect(checks).toBe(1);

  // A full reload starts a new editor session and checks the setting again.
  await page.reload();
  await expect(page.locator('[data-tutorial="canvas"]')).toBeVisible();
  await expect.poll(() => checks).toBe(2);
});
});

test.describe("ai-clone-isolation", () => {
let bundle: string;
test.beforeAll(async () => { bundle = await aiCloneBundle(); });
const snapshot = (page: Page) => page.evaluate(() => {
  const state = (window as any).aiCloneEditor.getState();
  return { doc: state.doc, past: state.past.length, future: state.future.length };
});
async function duplicate(page: Page) {
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator(".ai-suggest")).toBeVisible();
  const before = await snapshot(page);
  await page.locator(".ai-suggest button").first().click();
  await expect(page.locator(".ai-msg.is-assistant > p")).toHaveText("Duplicated");
  const saved = await snapshot(page);
  expect(saved.past).toBe(before.past + 1);
  expect(saved.doc.nodes).toEqual(await page.evaluate(() => (window as any).aiCloneServerDoc.nodes));
  return { before, saved, nodes: saved.doc.nodes.copy.children.map((id: string) => saved.doc.nodes[id]) };
}
const closeChat = (page: Page) => page.locator('.ai-head [aria-label="閉じる"]').click();
const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);

test("AI duplication has one Undo and the copied button controls only its own menu and fields in preview", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { before, saved, nodes: [button, menu, entry, readout, jump] } = await duplicate(page);
  await page.locator(".ai-msg-meta button").click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.evaluate(() => (window as any).aiCloneEditor.getState().redo());
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await closeChat(page);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await expect(byId(page, "menu")).toBeHidden();
  await expect(byId(page, menu.attrId)).toBeHidden();
  await byId(page, button.attrId).click();
  await expect(byId(page, menu.attrId)).toBeVisible();
  await expect(byId(page, "menu")).toBeHidden();
  await expect(byId(page, entry.attrId)).toHaveValue("Changed");
  await expect(byId(page, "entry")).toHaveValue("Initial");
  await expect(byId(page, readout.attrId)).toHaveText("Changed");
  await expect(byId(page, "readout")).toHaveText("Initial");
  expect(jump.link.url).toBe(`#${menu.attrId}`);
  await byId(page, button.attrId).click();
  await expect(byId(page, menu.attrId)).toBeHidden();
  await byId(page, "button").click();
  await expect(byId(page, "menu")).toBeVisible();
  await expect(byId(page, menu.attrId)).toBeHidden();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  expect(errors).toEqual([]);
});

test("editing a copied script block does not change the original and Undo/Redo preserves isolation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { saved, nodes: [button, , entry, readout] } = await duplicate(page);
  await closeChat(page);
  await page.getByRole("button", { name: "Edit copied script", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "スクリプト", exact: true });
  const stepId = button.scripts[0].steps[1].id;
  const input = dialog.locator(`.se-flow [data-step-id="${stepId}"] input.se-in`);
  await input.fill("Copy only");
  await input.blur();
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  const edited = await snapshot(page);
  expect(edited.doc.nodes[button.id].scripts[0].steps[1].value).toBe("Copy only");
  expect(edited.doc.nodes.button).toEqual(saved.doc.nodes.button);
  expect(edited.past).toBe(saved.past + 1);
  await page.evaluate(() => (window as any).aiCloneEditor.getState().undo());
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.evaluate(() => (window as any).aiCloneEditor.getState().redo());
  expect((await snapshot(page)).doc).toEqual(edited.doc);
  await page.getByRole("button", { name: "Toggle preview", exact: true }).click();
  await byId(page, button.attrId).click();
  await expect(byId(page, entry.attrId)).toHaveValue("Copy only");
  await expect(byId(page, readout.attrId)).toHaveText("Copy only");
  await expect(byId(page, "entry")).toHaveValue("Initial");
  await byId(page, "button").click();
  await expect(byId(page, "entry")).toHaveValue("Changed");
  await expect(byId(page, entry.attrId)).toHaveValue("Copy only");
  expect((await snapshot(page)).doc).toEqual(edited.doc);
  expect(errors).toEqual([]);
});
});
