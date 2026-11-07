import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import { scriptDataPickerBundle } from "../tests/helpers/script-data-picker";
import type { ScriptStep, SiteDoc } from "../lib/types";

async function runChain(page: Page, exported: boolean, input: string, transforms: ScriptStep[]) {
  const steps: ScriptStep[] = [
    { id: "literal", kind: "set-var", into: "items", value: input },
    ...transforms,
    { id: "display", kind: "set-value", target: "answer", value: "{items}" },
  ];
  const node = {
    ...makeBox(), id: "button", attrId: "button", scripts: [{
      id: "s", trigger: "click" as const, pos: { x: 0, y: 0 }, steps,
    }],
  };
  const doc: SiteDoc = {
    siteName: "Block composition", assets: {}, nodes: { button: node }, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "",
      children: ["button"] } },
  };
  const compiled = compileScripts(node, () => "/");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent('<html><body><button id="button">Run</button><input id="answer" /></body></html>');
  await page.locator("#button").evaluate((element, scripts) =>
    element.setAttribute("data-scripts", JSON.stringify(scripts)), compiled);
  await page.addScriptTag({ content: exported ? scriptsFile(doc) : "(" + SCRIPT_RUNTIME + ")({}).install(document);" });
  await page.locator("#button").click();
  return { answer: page.locator("#answer"), errors };
}

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " runtime composes numeric value blocks in ordinary script order", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "12", [
      { id: "parse", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "math", kind: "transform", source: "items", into: "items", transform: { kind: "math", operation: "multiply", operand: 2 } },
      { id: "add", kind: "transform", source: "items", into: "items", transform: { kind: "math", operation: "add", operand: 3 } },
    ]);
    await expect(answer).toHaveValue("27");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " runtime filters, sorts and joins through connected blocks", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported,
      '[{"name":"C","price":1},{"name":"A","price":3},{"name":"B","price":2}]', [
      { id: "parse", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "filter", kind: "transform", source: "items", into: "items",
        transform: { kind: "filter", field: "price", operation: "gt", operandType: "number", operand: "1" } },
      { id: "sort", kind: "transform", source: "items", into: "items", transform: { kind: "sort", field: "name", direction: "asc" } },
      { id: "map", kind: "transform", source: "items", into: "items", transform: { kind: "map-field", field: "name" } },
      { id: "join", kind: "transform", source: "items", into: "items", transform: { kind: "join", separator: "、" } },
    ]);
    await expect(answer).toHaveValue("A、B");
    expect(errors).toEqual([]);
  });
}

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " runtime appends and removes list elements without mutation", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '["red","blue","red"]', [
      { id: "parse", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "remove", kind: "transform", source: "items", into: "items",
        transform: { kind: "remove", operandType: "text", operand: "red" } },
      { id: "append", kind: "transform", source: "items", into: "items",
        transform: { kind: "append", operandType: "text", operand: "green" } },
      { id: "join", kind: "transform", source: "items", into: "items",
        transform: { kind: "join", separator: "/" } },
    ]);
    await expect(answer).toHaveValue("blue/green");
    expect(errors).toEqual([]);
  });
}

let bundle: string;
test.beforeAll(async () => { bundle = await scriptDataPickerBundle(); });
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes("canvas")) return;
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readFileSync("app/globals.css", "utf8") });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});

test("canvas block settings update the document without a separate value-composer modal", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "native", kind: "transform", source: "data", into: "chosen",
        transform: { kind: "field", key: "name" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:native"]');
  await expect(box.getByRole("combobox", { name: "加工の種類" })).toBeVisible();
  await expect(page.getByRole("button", { name: "値を組み立てる" })).toHaveCount(0);
  await expect(box.getByRole("combobox", { name: "取り出す項目名" })).toHaveCSS("height", "24px");
  await box.getByRole("combobox", { name: "取り出す項目名" }).fill("tags");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "native").transform.key;
  })).toBe("tags");
  await box.getByRole("combobox", { name: "加工の種類" }).selectOption("length");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "native").transform.kind;
  })).toBe("length");
});

test("canvas list-display block switches filter, sort and clear without changing the step ID", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "display", kind: "list-display", mode: "filter", array: "data.tags",
        field: "", op: "eq", value: "", dir: "asc",
      });
    });
  });
  const box = page.locator('[data-sel-key="step:display"]');
  const mode = box.getByRole("combobox", { name: "リスト表示の操作" });
  await mode.selectOption("sort");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "display").mode;
  })).toBe("sort");
  await mode.selectOption("clear");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "display").mode;
  })).toBe("clear");
  await page.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "display").mode;
  })).toBe("sort");
});


test("canvas math supports selecting an existing variable as the arithmetic operand", async ({ page }) => {
  const box = page.locator('[data-sel-key="step:numeric"]');
  await box.getByRole("combobox", { name: "計算する値の種類" }).selectOption("variable");
  await box.getByRole("button", { name: "計算する変数" }).click();
  const menu = page.locator(".se-pm").last();
  await expect(menu).toBeVisible();
  await menu.locator(".se-pm-row").filter({ hasText: "data" }).first().locator(".dd-item").click();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "numeric").transform;
  })).toMatchObject({ kind: "math", operandType: "variable", operand: "data" });
});

test("canvas comparison offers existing variables and keeps the chosen reference", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "compare-native", kind: "transform", source: "data.price", into: "selected",
        transform: { kind: "compare", operation: "gt", operand: "", operandType: "text" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:compare-native"]');
  const type = box.getByRole("combobox", { name: "比較する値の種類" });
  await expect(type).toHaveCSS("height", "24px");
  await type.selectOption("variable");
  await box.getByRole("button", { name: "比較する変数" }).click();
  const menu = page.locator(".se-pm").last();
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("data");
  await menu.locator(".se-pm-row").filter({ hasText: "data" }).first().locator(".dd-item").click();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "compare-native").transform;
  })).toMatchObject({ kind: "compare", operandType: "variable", operand: "data" });
});
