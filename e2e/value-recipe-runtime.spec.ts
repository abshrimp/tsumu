import { expect, test, type Page } from "@playwright/test";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import type { ValueTransform } from "../lib/script-model/compose";
import type { ScriptStep, SiteDoc } from "../lib/types";

async function verifyRecipe(page: Page, published: boolean, raw: string, transforms: readonly ValueTransform[]) {
  const steps: ScriptStep[] = [
    { id: "source", kind: "set-var", value: raw, into: "source" },
    { id: "composed", kind: "set-var", value: "{source}", into: "result",
      recipe: { source: "source", steps: transforms } },
    { id: "display", kind: "set-value", target: "value", value: "{result}" },
  ];
  const script = {
    id: "click", trigger: "click" as const, pos: { x: 0, y: 0 }, steps,
  };
  const node = { ...makeBox(), id: "action", attrId: "action", scripts: [script] };
  const doc: SiteDoc = {
    siteName: "Value recipe", assets: {}, nodes: { action: node },
    pageOrder: ["p"], pages: { p: {
      id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["action"],
    } },
  };
  const compiled = compileScripts(node, () => "/");
  await page.setContent('<html><body><button id="action">Run</button><input id="value" /></body></html>');
  await page.locator("#action").evaluate((button, scripts) => {
    button.setAttribute("data-scripts", JSON.stringify(scripts));
  }, compiled);
  await page.addScriptTag({ content: published
    ? scriptsFile(doc)
    : "(" + SCRIPT_RUNTIME + ")({}).install(document);" });
  await page.locator("#action").click();
  return page.locator("#value");
}

for (const published of [false, true]) {
  test((published ? "exported" : "preview") + " runtime composes and applies arithmetic to an input", async ({ page }) => {
    const input = await verifyRecipe(page, published, "12", [
      { kind: "parse" },
      { kind: "math", operation: "multiply", operand: 2 },
      { kind: "math", operation: "add", operand: 3 },
      { kind: "format" },
    ]);
    await expect(input).toHaveValue("27");
  });

  test((published ? "exported" : "preview") + " runtime filters, sorts and joins a JSON list", async ({ page }) => {
    const input = await verifyRecipe(page, published,
      '[{"name":"C","price":1},{"name":"A","price":3},{"name":"B","price":2}]', [
        { kind: "parse" },
        { kind: "filter", field: "price", operation: "gt", operandType: "number", operand: "1" },
        { kind: "sort", field: "name", direction: "asc" },
        { kind: "map-field", field: "name" },
        { kind: "join", separator: "," },
      ]);
    await expect(input).toHaveValue("A,B");
  });
}
