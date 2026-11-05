import { expect, test, type Page } from "@playwright/test";
import { commitFieldsBundle, commitFieldsDoc, commitPageFieldsBundle } from "../tests/helpers/commit-fields";

const seoField = (page: Page, field: "title" | "description") => page.locator(`[data-tutorial="page-seo"] ${field === "title" ? ".row > input.input" : "textarea"}`);

for (const field of ["title", "description"] as const) {
  for (const editing of ["fresh", "previously-committed", "pending"] as const) {
    test(`${field}: 共同編集の受信後、${editing} の欄は利用者が入力したときだけ確定する`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
      const response = await page.request.post("/api/sites", { data: { name: "Idle field collaboration" } });
      expect(response.ok()).toBeTruthy();
      const { site } = await response.json();
      const endpoint = `/api/doc?site=${site.id}`;
      expect((await page.request.put(endpoint, { data: commitFieldsDoc() })).ok()).toBeTruthy();
      await page.goto(`/sites/${site.id}`);
      await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
      await page.getByRole("button", { name: "検索・シェア（SEO）", exact: true }).click();
      const input = seoField(page, field);
      await expect(input).toHaveValue(`Original ${field}`);
      if (editing === "previously-committed") {
        // native の dirty-value flag が立った欄を再利用し、再フォーカスでは何も入力しない。
        await input.fill("Earlier local edit");
        await input.blur();
        await expect.poll(async () => (await (await page.request.get(endpoint)).json()).doc.pages.p[field]).toBe("Earlier local edit");
        await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
      }
      await input.focus();
      if (editing === "pending") await input.fill("Deliberate local draft");
      await input.evaluate(el => { (window as any).focusedCommitField = el; });
      const current = await (await page.request.get(endpoint)).json();
      const remote = structuredClone(current.doc);
      remote.pages.p[field] = "Collaborator value";
      remote.pages.p.name = "Collaborator page";
      expect((await page.request.put(`${endpoint}&base=${current.rev}`, { data: remote })).ok()).toBeTruthy();
      // 実際の Editor が共同編集を受信した証拠。テストからストアを書き換えない。
      await expect(page.locator('[data-tutorial="tutorial-page-name"]')).toHaveValue("Collaborator page");
      await expect(input).toBeFocused();
      expect(await input.evaluate(el => el === (window as any).focusedCommitField)).toBe(true);
      if (editing === "pending") await expect(input).toHaveValue("Deliberate local draft");
      if (field === "title") await input.press("Enter");
      else await input.blur();
      console.info("commit-field native result", JSON.stringify({ field, editing, value: await input.inputValue(), stored: (await (await page.request.get(endpoint)).json()).doc.pages.p[field] }));
      const expected = structuredClone(remote);
      if (editing === "pending") expected.pages.p[field] = "Deliberate local draft";
      await expect(input).toHaveValue(expected.pages.p[field]);
      await expect.poll(async () => (await (await page.request.get(endpoint)).json()).doc).toEqual(expected);
      if (editing === "pending") {
        await page.getByRole("button", { name: "元に戻す", exact: true }).click();
        await expect(input).toHaveValue("Collaborator value");
        await page.getByRole("button", { name: "やり直す", exact: true }).click();
        await expect(input).toHaveValue("Deliberate local draft");
        await expect.poll(async () => (await (await page.request.get(endpoint)).json()).doc).toEqual(expected);
      }
      // blur の後に遅れて保存される旧値も検出してから、保存内容を読み直す。
      await page.waitForTimeout(1200);
      expect((await (await page.request.get(endpoint)).json()).doc).toEqual(expected);
      await page.reload();
      await expect(page.locator('[data-tutorial="tutorial-page-name"]')).toHaveValue("Collaborator page");
      const seo = page.getByRole("button", { name: "検索・シェア（SEO）", exact: true });
      if (await seo.getAttribute("aria-expanded") === "false") await seo.click();
      await expect(seoField(page, field)).toHaveValue(expected.pages.p[field]);
    });
  }
}

test.describe("確定入力欄のイベントと正規化", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await commitFieldsBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<div id="app"></div>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator("#single")).toHaveValue("Original value");
  });
  for (const selector of ["#single", "#multi"]) {
    test(`${selector}: 外部変更は未入力の欄だけに反映し、正規化と空欄取消し後も使える`, async ({ page }) => {
      const input = page.locator(selector);
      await input.focus();
      await page.evaluate(() => (window as any).commitFields.setValue("Remote value"));
      await expect(input).toHaveValue("Remote value");
      await input.fill("  Local draft  ");
      await page.evaluate(() => (window as any).commitFields.setValue("New remote value"));
      await expect(input).toHaveValue("  Local draft  ");
      await page.locator("#outside").click();
      await expect(input).toHaveValue("Local draft");
      await expect(page.locator("#stored")).toHaveText("Local draft");
      for (let attempt = 0; attempt < 2; attempt++) {
        await input.fill("");
        await page.locator("#outside").click();
        await expect(input).toHaveValue("Original value");
      }
      const before = await page.evaluate(() => (window as any).commitFields.writes);
      await input.focus(); await input.blur();
      expect(await page.evaluate(() => (window as any).commitFields.writes)).toEqual(before);
      const events = await page.evaluate(() => (window as any).commitFields.events);
      expect(events).toContain("focus");
      expect(events).toContain("input");
      expect(events).toContain("change");
    });

    test(`${selector}: IMEとEnterの振る舞いと呼び出し側ハンドラーを保つ`, async ({ page }) => {
      const input = page.locator(selector);
      await input.focus();
      await input.dispatchEvent("compositionstart");
      await input.fill("変換中");
      await page.evaluate(() => (window as any).commitFields.setValue("Remote value"));
      for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
        await input.dispatchEvent("keydown", { key: "Enter", ...composing });
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("変換中");
        expect(await page.evaluate(() => (window as any).commitFields.writes)).toEqual([]);
      }
      await input.dispatchEvent("compositionend", { data: "変換中" });
      await input.press("End");
      await input.press("Enter");
      if (selector === "#multi") {
        await expect(input).toBeFocused();
        await expect(input).toHaveValue("変換中\n");
        await input.blur();
      } else await expect(input).not.toBeFocused();
      await expect(page.locator("#stored")).toHaveText("変換中");
      const events = await page.evaluate(() => (window as any).commitFields.events);
      expect(events).toContain("compositionstart");
      expect(events).toContain("compositionend");
      expect(await page.evaluate(() => (window as any).commitFields.writes)).toHaveLength(1);
    });

    for (const flag of ["disabled", "readOnly"]) test(`${selector}: ${flag} を保ち、利用者の入力なしに確定しない`, async ({ page }) => {
      const input = page.locator(selector);
      await page.evaluate(flag => (window as any).commitFields.setFlags({ [flag]: true }), flag);
      if (flag === "disabled") await expect(input).toBeDisabled();
      else { await expect(input).toHaveAttribute("readonly", ""); await input.focus(); }
      await page.evaluate(() => (window as any).commitFields.setValue("Remote value"));
      await expect(input).toHaveValue("Remote value");
      await page.locator("#outside").click();
      expect(await page.evaluate(() => (window as any).commitFields.writes)).toEqual([]);
    });
  }
});

test.describe("ページ設定のフォーカス中の履歴", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await commitPageFieldsBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) }));
    await page.goto("/robots.txt");
    await page.setContent('<div id="app"></div>');
    await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: "検索・シェア（SEO）", exact: true }).click();
  });
  const snapshot = (page: Page) => page.evaluate(() => {
    const { doc, past, future } = (window as any).commitPageEditor.getState();
    return { doc, past, future };
  });
  for (const field of ["title", "description"] as const) {
    for (const operation of ["undo", "redo", "remote"] as const) {
      test(`${field}: 再フォーカス後の ${operation} をblurで上書きせず、履歴も変えない`, async ({ page }) => {
        const input = seoField(page, field);
        await input.fill("Earlier local edit"); await input.blur();
        if (operation === "redo") {
          await page.evaluate(() => (window as any).commitPageEditor.getState().undo());
          await expect(input).toHaveValue(`Original ${field}`);
        }
        await input.focus();
        await page.evaluate(({ operation, field }) => {
          const s = (window as any).commitPageEditor.getState();
          if (operation === "remote") {
            const remote = structuredClone(s.doc);
            remote.pages.p[field] = "Collaborator value";
            s.applyRemoteDoc(remote);
          } else s[operation]();
        }, { operation, field });
        await expect(input).toBeFocused();
        const before = await snapshot(page);
        await input.blur();
        await expect(input).toHaveValue(before.doc.pages.p[field]);
        expect(await snapshot(page)).toEqual(before);
      });
    }
  }
});
