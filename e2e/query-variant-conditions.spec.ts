import { expect, test } from "@playwright/test";
import { makeText } from "../lib/presets";
import { previewQueryDoc } from "../tests/helpers/preview-query-navigation";

for (const slug of ["results", "posts/[slug]"]) {
  test(`repeated query conditions keep ordinary links on their intended ${slug} page`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
    const response = await page.request.post("/api/sites", { data: { name: "Repeated query conditions" } });
    expect(response.ok()).toBeTruthy();
    const { site } = await response.json();
    const endpoint = `/api/doc?site=${site.id}`;
    const doc = previewQueryDoc(slug, ["", "category=books&category=music", "category=music&category=books", "%71=hello+world&q=later"]);
    const path = `/${slug.replace("[slug]", "article")}`;
    for (const target of Object.values(doc.pages)) {
      for (const [label, suffix] of [
        ["Books URL", "?category=books&category=music"],
        ["Music URL", "?category=music&category=books"],
        ["Encoded URL", "?%71=hello%20world&q=later"],
        ["Default URL", "?category=other"],
      ]) {
        const node = { ...makeText(label), id: `${target.id}-${label.toLowerCase().replaceAll(" ", "-")}`, link: { kind: "url" as const, url: `${path}${suffix}` } };
        doc.nodes[node.id] = node;
        target.children.push(node.id);
      }
      const node = { ...makeText("Books page"), id: `${target.id}-books-page`, link: { kind: "page" as const, pageId: "variant1" } };
      doc.nodes[node.id] = node;
      target.children.push(node.id);
    }
    expect((await page.request.put(endpoint, { data: doc })).ok()).toBeTruthy();
    await page.goto(`/sites/${site.id}`);
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    const saved = (await (await page.request.get(endpoint)).json()).doc;
    await page.reload();
    await expect(page.getByText("サーバー保存済み")).toBeVisible();
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    const canvas = page.locator('[data-tutorial="canvas"]');
    for (const [label, destination] of [
      ["Books URL", "variant1"],
      ["Music URL", "variant2"],
      ["Encoded URL", "variant3"],
      ["Books page", "variant1"],
      ["Default URL", "variant0"],
      ["Books URL", "variant1"],
    ]) {
      await canvas.getByText(label, { exact: true }).click();
      await expect(canvas.getByText(`Page ${destination}`, { exact: true })).toBeVisible();
    }
    expect((await (await page.request.get(endpoint)).json()).doc).toEqual(saved);
    expect(errors).toEqual([]);
  });
}
