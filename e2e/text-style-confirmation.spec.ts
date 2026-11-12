import { expect, test, type Page } from "@playwright/test";
import { textStyleConfirmationBundle, textStyleConfirmationDoc } from "../tests/helpers/text-style-confirmation";

async function selectSecondOccurrence(page: Page, replacement?: string, start = 5, end = 9) {
  await page.locator('[data-node="a"]').dblclick();
  const editable = page.locator('[data-node="a"][data-editing="true"]');
  await expect(editable).toBeFocused();
  if (replacement !== undefined) await editable.fill(replacement);
  await editable.evaluate((el, { start, end }) => {
    const point = (offset: number): [Node, number] => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (offset <= length) return [node, offset];
        offset -= length;
      }
      throw new Error("Text selection exceeds the editor content");
    };
    const range = document.createRange();
    range.setStart(...point(start));
    range.setEnd(...point(end));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { start, end });
  await page.locator('[data-tip="斜体"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

for (const split of [true, false]) test(`After remote text changes, stale partial-range ${split ? "split" : "whole-style"} confirmation is cancelled`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Text selection collaboration" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const endpoint = `/api/doc?site=${site.id}`;
  expect((await page.request.put(endpoint, { data: textStyleConfirmationDoc() })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="save-status"]')).toContainText("サーバー保存済み");
  await page.locator('[data-node="a"]').click();
  await page.locator('[data-tutorial="right-tab-style"]').click();
  await selectSecondOccurrence(page);
  const current = await (await page.request.get(endpoint)).json();
  const remote = structuredClone(current.doc);
  remote.nodes.a.text.content = "echo gone";
  remote.nodes.b.name = "Collaborator kept this";
  expect((await page.request.put(`${endpoint}&base=${current.rev}`, { data: remote })).ok()).toBeTruthy();
  // 古いダイアログを受け入れる前に、共同編集の変更が実際の Canvas に届くのを待つ。
  await expect.poll(() => page.locator('[data-node="a"]').textContent()).toBe("echo gone");
  await page.getByRole("dialog").getByRole("button", { name: split ? "分割して適用" : "全体に適用", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-node="a"] [data-node]')).toHaveCount(0);
  await expect(page.locator('[data-node="a"]')).toHaveCSS("font-style", "normal");
  await expect.poll(async () => (await (await page.request.get(endpoint)).json()).doc).toEqual(remote);
  await page.reload();
  await expect.poll(() => page.locator('[data-node="a"]').textContent()).toBe("echo gone");
  await expect(page.locator('[data-node="a"]')).toHaveCSS("font-style", "normal");
});

test.describe("Partial text styling confirmation target and lifetime", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await textStyleConfirmationBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) }));
    await page.goto("/robots.txt");
    await page.setContent('<div id="app"></div>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator('[data-node="a"]')).toBeVisible();
  });
  const snapshot = (page: Page) => page.evaluate(() => {
    const { doc, past, future, selection, selectedIds, textSel } = (window as any).textStyleEditor.getState();
    return { doc, past, future, selection, selectedIds, textSel };
  });

  for (const interruption of ["undo-redo", "breakpoint-return", "state-return", "page-return", "selection-return", "new-range", "unmount"]) {
    test(`After ${interruption}, a stale confirmation never writes into the original range`, async ({ page }) => {
      await page.evaluate(() => (window as any).textStyleEditor.getState().updateNode("a", { name: "Undo this" }));
      await selectSecondOccurrence(page);
      await page.evaluate(interruption => {
        const s = (window as any).textStyleEditor.getState();
        if (interruption === "undo-redo") { s.undo(); s.redo(); }
        if (interruption === "breakpoint-return") s.setBreakpoint("sm");
        if (interruption === "state-return") s.setStyleState("hover");
        if (interruption === "page-return") s.setActivePage("q");
        if (interruption === "selection-return") s.select("b");
        if (interruption === "new-range") s.setTextSel({ nodeId: "a", start: 0, end: 4, text: "echo" });
        if (interruption === "unmount") (window as any).hideTextStylePanel();
      }, interruption);
      if (interruption.endsWith("return")) {
        // 同じ対象に戻る前に、途中の画面を描画する。元の要求が復活してはならない。
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        await page.evaluate(interruption => {
          const s = (window as any).textStyleEditor.getState();
          if (interruption === "breakpoint-return") s.setBreakpoint("base");
          if (interruption === "state-return") s.setStyleState("default");
          if (interruption === "page-return") { s.setActivePage("p"); s.select("a"); }
          if (interruption === "selection-return") s.select("a");
        }, interruption);
      }
      if (interruption === "unmount") await expect(page.locator(".panel-r")).toHaveCount(0);
      const before = await snapshot(page);
      await page.getByRole("dialog").getByRole("button", { name: "分割して適用", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await snapshot(page)).toEqual(before);
    });
  }

  for (const action of ["split", "whole", "escape"]) test(`Valid ${action} actions preserve unrelated edits and support Undo/Redo`, async ({ page }) => {
    await selectSecondOccurrence(page);
    await page.evaluate(() => (window as any).textStyleEditor.getState().updateDoc((d: any) => {
      d.nodes.a.name = "Renamed while waiting";
      d.nodes.a.styles.base.default.padding = "8px";
      d.nodes.b.text.content = "Other updated text";
    }));
    const before = await snapshot(page);
    if (action === "escape") await page.keyboard.press("Escape");
    else await page.getByRole("dialog").getByRole("button", { name: action === "split" ? "分割して適用" : "全体に適用", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const after = await snapshot(page);
    if (action === "split") {
      const parts = after.doc.nodes.a.children.map((id: string) => after.doc.nodes[id]);
      expect(parts.map((n: any) => n.text.content)).toEqual(["echo ", "echo"]);
      expect(parts.map((n: any) => n.styles.base?.default?.fontStyle)).toEqual([undefined, "italic"]);
    } else {
      expect(after.doc.nodes.a.text.content).toBe("echo echo");
      expect(after.doc.nodes.a.children).toEqual([]);
      expect(after.doc.nodes.a.styles.base.default.fontStyle).toBe("italic");
    }
    expect(after.doc.nodes.a.name).toBe(before.doc.nodes.a.name);
    expect(after.doc.nodes.a.styles.base.default.padding).toBe("8px");
    expect(after.doc.nodes.b).toEqual(before.doc.nodes.b);
    expect(after.past.length).toBe(before.past.length + 1);
    await page.evaluate(() => (window as any).textStyleEditor.getState().undo());
    expect((await snapshot(page)).doc).toEqual(before.doc);
    await page.evaluate(() => (window as any).textStyleEditor.getState().redo());
    expect((await snapshot(page)).doc).toEqual(after.doc);
  });

  for (const content of ["new echo echo", "Hello {name} world"]) test(`Commit freshly entered ${content} before styling only the selected range`, async ({ page }) => {
    const start = content.startsWith("Hello") ? 6 : 9;
    await selectSecondOccurrence(page, content, start, content.length);
    // blur でテキストを保存した後に、変わっていない選択を知らせ直しても、その確認を無効にしてはならない。
    await page.evaluate(() => {
      const s = (window as any).textStyleEditor.getState();
      s.setTextSel({ ...s.textSel });
    });
    const before = await snapshot(page);
    expect(before.doc.nodes.a.text.content).toBe(content);
    await page.getByRole("dialog").getByRole("button", { name: "分割して適用", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const after = await snapshot(page);
    const parts = after.doc.nodes.a.children.map((id: string) => after.doc.nodes[id]);
    expect(parts.map((n: any) => n.text.content)).toEqual([content.slice(0, start), content.slice(start)]);
    expect(parts.map((n: any) => n.styles.base?.default?.fontStyle)).toEqual([undefined, "italic"]);
    await page.evaluate(() => (window as any).textStyleEditor.getState().undo());
    expect((await snapshot(page)).doc).toEqual(before.doc);
  });
});
