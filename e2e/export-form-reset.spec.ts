import { expect, test } from "@playwright/test";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import { scriptsFile } from "../lib/script-runtime";
import type { FieldContent, SiteDoc } from "../lib/types";
import { publishedSelectDefault } from "../tests/helpers/select-default";

function formDoc(): SiteDoc {
  const fields: Record<string, FieldContent> = {
    source: { kind: "input", defaultValue: "cobalt" },
    entry: { kind: "input", defaultValue: "{source}" },
    memo: { kind: "textarea", defaultValue: "{source}" },
    plain: { kind: "textarea", defaultValue: "\nFirst   word\n   last\n" },
    choice: { kind: "select", defaultValue: "{source}", options: ["other", "cobalt", "moss"].map(value => ({value, label: value})) },
    check: { kind: "checkbox", checked: true, label: "Check" },
    blue: { kind: "radio", group: "color", checked: true, label: "Blue" },
    red: { kind: "radio", group: "color", label: "Red" },
  };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Form", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", slug: "", description: "", children: ["sample", "outside", "out"] } },
    nodes: {},
  };
  for (const [id, field] of Object.entries(fields)) doc.nodes[id] = { ...makeBox(), id, attrId: id, type: "field", field };
  doc.nodes.sample = { ...makeBox(), id: "sample", attrId: "sample", semantic: "form", htmlAttrs: { method: "post" }, children: [...Object.keys(fields), "choose", "clear"] };
  doc.nodes.choose = { ...makeText("Choose other"), id: "choose", semantic: "button", htmlAttrs: { type: "button" },
    scripts: [{ id: "choose-click", trigger: "click", steps: [{ id: "set-choice", kind: "set-value", target: "choice", value: "other" }] }],
  };
  doc.nodes.clear = { ...makeText("Reset"), id: "clear", semantic: "button", htmlAttrs: { type: "reset" } };
  doc.nodes.outside = { ...makeBox(), id: "outside", attrId: "outside", type: "field", htmlAttrs: { form: "sample" }, field: { kind: "input", defaultValue: "{source}" } };
  doc.nodes.out = { ...makeText("{source}|{choice}|{check}|{color}"), id: "out", attrId: "out" };
  return doc;
}

for (const framework of ["html", "single-html", "nextjs"] as const) {
  test(framework + " restores resolved form defaults and live output after a reset", async ({ page }) => {
    const doc = formDoc();
    if (framework === "nextjs") {
      await page.setContent((await publishedSelectDefault(doc)).html);
      await page.addScriptTag({ content: scriptsFile(doc) });
    } else {
      const files = framework === "html" ? generateExportProject(doc, "html").files :
        (await prepareExportProject(doc, { framework, scope: "page", pageId: "home", language: "javascript", style: "css" })).files;
      await page.route("https://form.test/**", route => {
        const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
        if (!(path in files)) return route.abort();
        const contentType = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html";
        return route.fulfill({ contentType, body: files[path] });
      });
      await page.goto("https://form.test/");
    }
    const form = page.locator("#sample");
    const submitted = () => form.evaluate(el => Object.fromEntries(new FormData(el as HTMLFormElement)));
    const original = { source: "cobalt", entry: "cobalt", memo: "cobalt", plain: "\nFirst   word\n   last\n", choice: "cobalt", check: "true", color: "Blue", outside: "cobalt" };
    await expect(page.locator("#out")).toHaveText("cobalt|cobalt|true|Blue");
    expect(await submitted()).toEqual(original);
    await page.locator("#source").fill("moss");
    await page.locator("#entry").fill("typed");
    await page.locator("#memo").fill("typed memo");
    await page.locator("#outside").fill("external");
    await page.getByRole("button", { name: "Choose other" }).click();
    expect((await submitted()).choice).toBe("other");
    await page.locator("#check input").uncheck();
    await page.locator("#red input").check();
    await expect(page.locator("#out")).toHaveText("moss|other|false|Red");
    const edited = await submitted();
    await form.evaluate(el => el.addEventListener("reset", ev => ev.preventDefault(), { once: true }));
    await page.getByRole("button", { name: "Reset" }).click();
    expect(await submitted()).toEqual(edited);
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.locator("#out")).toHaveText("cobalt|cobalt|true|Blue");
    expect(await submitted()).toEqual(original);
    await page.locator("#source").fill("moss");
    await expect(page.locator("#outside")).toHaveValue("moss");
    await expect(page.locator("#choice")).toHaveValue("moss");
  });
}
