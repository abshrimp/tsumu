import { expect, test } from "@playwright/test";
import { pageKindBundle } from "../tests/helpers/page-kind-confirmation";

let bundle: string;
test.beforeAll(async () => { bundle = await pageKindBundle(); });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: null }) }));
  await page.goto("/robots.txt");
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: bundle });
  // 通常ページでは閉じている欄を、利用者と同じ手順で開く。
  await page.getByRole("button", { name: "カスタムコード", exact: true }).click();
  await expect(page.getByRole("button", { name: "HTML", exact: true })).toBeVisible();
});

for (const kind of ["html", "redirect"]) {
  for (const interruption of ["rawHtml", "redirectTo", "rewriteTo", "undo", "undo-redo", "restore", "delete", "page", "page-return", "unmount", "cancel", "unrelated"]) {
    test(`${kind} の確認待ち中の変更: ${interruption}`, async ({ page }) => {
      await page.evaluate(() => (window as any).pageKindEditor.getState().updatePage("p", { title: "Undo this" }));
      await page.getByRole("button", { name: kind === "html" ? "HTML" : "リダイレクト", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.evaluate(interruption => {
        const state = () => (window as any).pageKindEditor.getState();
        if (["rawHtml", "redirectTo", "rewriteTo", "delete", "unrelated"].includes(interruption)) {
          const remote = structuredClone(state().doc);
          if (interruption === "rawHtml") remote.pages.p.rawHtml = "<p>Collaborator content</p>";
          if (interruption === "redirectTo") remote.pages.p.redirectTo = "/remote-redirect";
          if (interruption === "rewriteTo") remote.pages.p.rewriteTo = "/remote-rewrite";
          if (interruption === "delete") { delete remote.pages.p; remote.pageOrder = ["q"]; }
          if (interruption === "unrelated") {
            Object.assign(remote.pages.p, { name: "Renamed", title: "SEO update", description: "Description update" });
            remote.nodes.a.text.content = "Collaborator element edit";
            remote.pages.q.name = "Other page";
          }
          state().applyRemoteDoc(remote);
        }
        if (interruption.startsWith("undo")) state().undo();
        if (interruption === "undo-redo") state().redo();
        if (interruption === "restore") state().restoreDoc({ ...structuredClone(state().doc), siteName: "Restored" });
        if (interruption.startsWith("page")) state().setActivePage("q");
        if (interruption === "unmount") (window as any).hidePagePanel();
      }, interruption);
      if (interruption === "page-return") {
        await expect(page.locator('[data-tutorial="tutorial-page-name"]')).toHaveValue("Q");
        await page.evaluate(() => (window as any).pageKindEditor.getState().setActivePage("p"));
        await expect(page.locator('[data-tutorial="tutorial-page-name"]')).toHaveValue("P");
      }
      if (interruption === "unmount") await expect(page.locator(".panel-r")).toHaveCount(0);
      const before = await page.evaluate(() => { const { doc, past, future } = (window as any).pageKindEditor.getState(); return { doc, past, future }; });
      await page.getByRole("dialog").getByRole("button", { name: interruption === "cancel" ? "キャンセル" : "切り替える", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const after = await page.evaluate(() => { const { doc, past, future } = (window as any).pageKindEditor.getState(); return { doc, past, future }; });
      if (interruption === "unrelated") {
        expect(after.doc.pages.p).toEqual({ ...before.doc.pages.p, rawHtml: kind === "html" ? "" : null, redirectTo: kind === "redirect" ? "" : undefined, rewriteTo: undefined });
        expect(after.doc.nodes).toEqual(before.doc.nodes);
        expect(after.doc.pages.q).toEqual(before.doc.pages.q);
        expect(after.past.length).toBe(before.past.length + 1);
        await page.evaluate(() => (window as any).pageKindEditor.getState().undo());
        expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(before.doc);
        await page.evaluate(() => (window as any).pageKindEditor.getState().redo());
        expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(after.doc);
      } else expect(after).toEqual(before);
    });
  }
}

for (const from of ["normal", "html", "redirect", "rewrite"]) for (const to of ["normal", "html", "redirect"]) {
  if ((from === "rewrite" ? "redirect" : from) === to) continue;
  test(`承認した ${from} → ${to} は実行する`, async ({ page }) => {
    await page.evaluate(from => {
      const s = (window as any).pageKindEditor.getState();
      const doc = structuredClone(s.doc);
      Object.assign(doc.pages.p, from === "html" ? { rawHtml: "<p>Approved old HTML</p>" } : from === "redirect" ? { redirectTo: "/old" } : from === "rewrite" ? { rewriteTo: "/old" } : {});
      s.replaceDoc(doc);
    }, from);
    const before = await page.evaluate(() => (window as any).pageKindEditor.getState().doc);
    await page.getByRole("button", { name: to === "normal" ? "通常" : to === "html" ? "HTML" : "リダイレクト", exact: true }).click();
    if (to !== "normal") await page.getByRole("dialog").getByRole("button", { name: "切り替える", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const after = await page.evaluate(() => (window as any).pageKindEditor.getState().doc);
    expect(after.pages.p.rawHtml).toBe(to === "html" ? "" : null);
    expect(after.pages.p.redirectTo).toBe(to === "redirect" ? "" : undefined);
    expect(after.pages.p.rewriteTo).toBeUndefined();
    expect(after.pages.p.children).toEqual(before.pages.p.children);
    expect(after.nodes).toEqual(before.nodes);
    await page.evaluate(() => (window as any).pageKindEditor.getState().undo());
    expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(before);
    await page.evaluate(() => (window as any).pageKindEditor.getState().redo());
    expect(await page.evaluate(() => (window as any).pageKindEditor.getState().doc)).toEqual(after);
  });
}
