import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { createInitialDoc, makeText } from "../lib/presets";

test("同じ書き出し先のURLを検出し、URL修正後は両方のクエリページを書き出す", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Route aliases" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  const doc = createInitialDoc();
  doc.siteName = "Route aliases";
  for (const [id, slug, text] of [
    ["first", "about/team", "The original team page"],
    ["second", "about//team", "The other team page"],
  ]) {
    const node = makeText(text);
    doc.nodes[node.id] = node;
    doc.pages[id] = { id, name: id, slug, title: id, description: "", children: [node.id] };
    doc.pageOrder.push(id);
  }
  expect((await page.request.put(`/api/doc?site=${site.id}`, { data: doc })).ok()).toBeTruthy();
  await page.goto(`/sites/${site.id}`);
  await expect(page.getByText("サーバー保存済み")).toBeVisible();
  const openExport = async () => {
    await page.getByRole("button", { name: "メニュー（書き出し・履歴・設定）", exact: true }).click();
    await page.getByRole("button", { name: "zipでエクスポート", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Next.jsプロジェクトとして書き出し" })).toBeVisible();
  };
  await openExport();
  await expect(page.locator(".modal .check-list .is-error")).toContainText("重複");
  await expect(page.getByRole("button", { name: "zipをダウンロード", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();

  await page.locator(".hdr-page .dd").click();
  await page.locator(".dd-menu .dd-item").filter({ hasText: /^second/ }).click();
  await page.locator('[data-tutorial="left-tab-site"]').click();
  const slug = page.locator('[data-tutorial="tutorial-page-slug"]');
  await expect(slug).toHaveValue("about//team");
  await slug.fill("/about///team/?tab=other");
  await slug.press("Enter");
  await expect(slug).toHaveValue("about/team?tab=other");
  await expect.poll(async () => {
    const saved = await (await page.request.get(`/api/doc?site=${site.id}`)).json();
    return { slug: saved.doc.pages.second.slug, query: saved.doc.pages.second.query };
  }).toEqual({ slug: "about/team", query: "tab=other" });

  await openExport();
  await expect(page.locator(".modal .check-list .is-error")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "zipをダウンロード", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const zip = await JSZip.loadAsync(Buffer.concat(chunks));
  const path = Object.keys(zip.files).find((name) => name.endsWith("app/about/team/page.tsx"))!;
  expect(path).toBeTruthy();
  const prefix = path.slice(0, -"page.tsx".length);
  expect(await zip.file(`${prefix}_q/p0.tsx`)!.async("string")).toContain("The original team page");
  expect(await zip.file(`${prefix}_q/p1.tsx`)!.async("string")).toContain("The other team page");
  expect(await zip.file(path)!.async("string")).toContain('"tab":"other"');
  expect(errors).toEqual([]);
});
