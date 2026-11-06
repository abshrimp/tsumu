import { expect, test, type Page } from "@playwright/test";
import { aiCloneBundle } from "../tests/helpers/ai-clone";

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
  const input = dialog.locator(`.se-ws [data-sel-key="step:${stepId}"] input.se-in`);
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
