import { expect, test } from "@playwright/test";
import { aiChatBundle } from "../tests/helpers/ai-chat";

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
