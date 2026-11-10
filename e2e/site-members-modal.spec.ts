import { expect, test } from "@playwright/test";
import { build } from "../tests/helpers/bundle";
import { readEditorCss } from "../tests/helpers/editor-css";

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import SiteMembers from "./components/SiteMembers";
        createRoot(document.getElementById("app")!).render(
          <SiteMembers siteId="demo" siteName="Demo site" onClose={() => {}} />
        );
      `,
      sourcefile: "site-members-test.tsx",
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    jsx: "automatic",
  });
  bundle = result.outputFiles[0].text;
});

test("site membership dialog supports changes and remains usable on narrow screens", async ({ page }) => {
  const members = [
    { email: "owner@example.test", role: "owner" },
    { email: "editor@example.test", role: "editor" },
  ];
  const fixed = ["admin@example.test"];
  await page.route("http://tsumu-members.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/sites/demo/members") {
      await route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
      return;
    }
    const method = route.request().method();
    if (method === "PUT") {
      const { email, role } = route.request().postDataJSON() as { email: string; role: string };
      const index = members.findIndex((item) => item.email === email);
      if (index < 0) members.push({ email, role });
      else members[index].role = role;
    } else if (method === "DELETE") {
      const email = url.searchParams.get("email");
      const index = members.findIndex((item) => item.email === email);
      if (index >= 0) members.splice(index, 1);
    }
    await route.fulfill({ json: { members, fixed } });
  });

  await page.setViewportSize({ width: 390, height: 670 });
  await page.goto("http://tsumu-members.test/");
  await page.addStyleTag({ content: readEditorCss() });
  await page.addScriptTag({ content: bundle });

  const dialog = page.getByRole("dialog", { name: "Members and permissions" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Demo site")).toBeVisible();
  await expect(dialog.getByText("admin@example.test")).toBeVisible();
  await expect(dialog.locator(".site-members-row")).toHaveCount(3);

  const role = dialog.getByRole("combobox", { name: "Role for editor@example.test" });
  await role.selectOption("viewer");
  await expect(role).toHaveValue("viewer");

  await dialog.getByRole("textbox", { name: "Email address" }).fill("new@example.test");
  await dialog.getByRole("button", { name: "Add member" }).click();
  await expect(dialog.getByText("new@example.test")).toBeVisible();

  await dialog.getByRole("button", { name: "Remove editor@example.test" }).click();
  await expect(dialog.getByText("editor@example.test")).toHaveCount(0);

  expect(await dialog.evaluate((element) => ({
    fitsViewport: element.getBoundingClientRect().width <= window.innerWidth,
    withinHeight: element.getBoundingClientRect().height <= window.innerHeight,
    scrollable: getComputedStyle(element.querySelector(".site-members-body")!).overflowY === "auto",
    noHorizontalOverflow: element.querySelector(".site-members-body")!.scrollWidth <= element.querySelector(".site-members-body")!.clientWidth,
  }))).toEqual({ fitsViewport: true, withinHeight: true, scrollable: true, noHorizontalOverflow: true });
});
