import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { makeBox } from "../lib/presets";
import { generateProject } from "../lib/generator";
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
        transform: { kind: "filter", field: "price", operation: "gt", operand: "1" } },
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

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " runtime repeats using a variable count", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "", [
      { id: "count", kind: "set-var", into: "count", value: "3" },
      { id: "sum", kind: "set-var", into: "sum", value: "0" },
      { id: "parse-sum", kind: "transform", source: "sum", into: "sum", transform: { kind: "parse" } },
      { id: "repeat", kind: "repeat", times: "{count}", then: [
        { id: "increase", kind: "transform", source: "sum", into: "sum",
          transform: { kind: "math", operation: "add", operand: 1 } },
      ] },
      { id: "result", kind: "set-var", into: "items", value: "{sum}" },
    ]);
    await expect(answer).toHaveValue("3");
    expect(errors).toEqual([]);
  });
  test((exported ? "exported" : "preview") + " runtime waits for variable seconds", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "before", [
      { id: "delay", kind: "set-var", into: "delay", value: "0.01" },
      { id: "wait", kind: "wait", seconds: "{delay}" },
      { id: "result", kind: "set-var", into: "items", value: "after" },
    ]);
    await expect(answer).toHaveValue("after");
    expect(errors).toEqual([]);
  });
}

test("scripted named state changes a distant element and reset restores its default style", async ({ page }) => {
  const button = { ...makeBox(), id: "trigger", attrId: "trigger", scripts: [{
    id: "script-trigger", trigger: "click" as const, pos: { x: 0, y: 0 },
    steps: [{ id: "activate", kind: "set-state" as const, target: "remote", state: "selected" }],
  }] };
  const reset = { ...makeBox(), id: "reset", attrId: "reset", scripts: [{
    id: "script-reset", trigger: "click" as const, pos: { x: 0, y: 0 },
    steps: [{ id: "restore", kind: "set-state" as const, target: "remote", state: "default" }],
  }] };
  const remote = { ...makeBox(), id: "remote", attrId: "remote",
    styles: { base: { default: { backgroundColor: "#eeeeee" },
      "custom:selected": { backgroundColor: "#ff0000" } } } };
  const doc: SiteDoc = {
    siteName: "Named states", assets: {}, nodes: { trigger: button, reset, remote },
    pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home",
      description: "", children: ["trigger", "reset", "remote"] } },
  };
  const project = generateProject(doc);
  const css = project.files["styles/site.css"];
  const className = /\.([a-zA-Z0-9_-]+)\[data-tsumu-state="selected"\]/.exec(css)?.[1];
  expect(className).toBeTruthy();
  await page.setContent('<html><body><button id="trigger">Activate</button><button id="reset">Reset</button><div id="remote">Target</div></body></html>');
  await page.addStyleTag({ content: css });
  await page.locator("#remote").evaluate((el, cls) => el.classList.add(cls), className!);
  await page.locator("#trigger").evaluate((el, steps) =>
    el.setAttribute("data-scripts", JSON.stringify(steps)), compileScripts(button, () => "/"));
  await page.locator("#reset").evaluate((el, steps) =>
    el.setAttribute("data-scripts", JSON.stringify(steps)), compileScripts(reset, () => "/"));
  await page.addScriptTag({ content: scriptsFile(doc) });
  await expect(page.locator("#remote")).toHaveCSS("background-color", "rgb(238, 238, 238)");
  await page.locator("#trigger").click();
  await expect(page.locator("#remote")).toHaveAttribute("data-tsumu-state", "selected");
  await expect(page.locator("#remote")).toHaveCSS("background-color", "rgb(255, 0, 0)");
  await page.locator("#reset").click();
  await expect(page.locator("#remote")).not.toHaveAttribute("data-tsumu-state");
  await expect(page.locator("#remote")).toHaveCSS("background-color", "rgb(238, 238, 238)");
});

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " runtime branches on the negation of a positive comparison", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "initial", [
      { id: "flag", kind: "set-var", into: "flag", value: "blue" },
      { id: "branch", kind: "if",
        cond: { subject: "var", target: "", left: "{flag}", op: "contains", value: "red", not: true },
        then: [{ id: "pass", kind: "set-var", into: "items", value: "accepted" }],
        else: [{ id: "fail", kind: "set-var", into: "items", value: "rejected" }],
      },
    ]);
    await expect(answer).toHaveValue("accepted");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " runtime displays only entries matching an inverted list condition", async ({ page }) => {
    const button = { ...makeBox(), id: "filterButton", attrId: "filterButton", scripts: [{
      id: "on-click", trigger: "click" as const, pos: { x: 0, y: 0 },
      steps: [{ id: "filter", kind: "list-display" as const, mode: "filter" as const,
        array: "results", field: "name", op: "contains" as const,
        value: "red", not: true, dir: "asc" as const }],
    }] };
    const doc: SiteDoc = {
      siteName: "Negated filter", assets: {}, nodes: { filterButton: button }, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: ["filterButton"] } },
    };
    await page.setContent('<html><body><button id="filterButton">Filter</button><section data-array="results"><div data-item=\'{"name":"red"}\' id="red">red</div><div data-item=\'{"name":"blue"}\' id="blue">blue</div></section></body></html>');
    await page.locator("#filterButton").evaluate((element, scripts) =>
      element.setAttribute("data-scripts", JSON.stringify(scripts)), compileScripts(button, () => "/"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addScriptTag({ content: exported ? scriptsFile(doc) : "(" + SCRIPT_RUNTIME + ")({}).install(document);" });
    await page.locator("#filterButton").click();
    await expect(page.locator("#red")).toHaveCSS("display", "none");
    await expect(page.locator("#blue")).toHaveCSS("display", "contents");
    expect(errors).toEqual([]);
  });
}

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " interpolates mixed text in fallback blocks", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "unused", [
      { id: "name", kind: "set-var", into: "name", value: "田中" },
      { id: "fallback", kind: "transform", source: "missing", into: "items",
        transform: { kind: "fallback", text: "こんにちは、{name}さん" } },
    ]);
    await expect(answer).toHaveValue("こんにちは、田中さん");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " resolves inline variables in list operations", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '["red","blue","green"]', [
      { id: "color", kind: "set-var", into: "color", value: "red" },
      { id: "separator", kind: "set-var", into: "separator", value: " / " },
      { id: "parse", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "remove", kind: "transform", source: "items", into: "items",
        transform: { kind: "remove", operand: "{color}", operandType: "text" } },
      { id: "join", kind: "transform", source: "items", into: "items",
        transform: { kind: "join", separator: "{separator}" } },
    ]);
    await expect(answer).toHaveValue("blue / green");
    expect(errors).toEqual([]);
  });
}

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " value compare supports grouped AND/OR and not", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "15", [
      { id: "parse-number", kind: "transform", source: "items", into: "items",
        transform: { kind: "parse" } },
      { id: "grouped", kind: "transform", source: "items", into: "items",
        transform: { kind: "compare", operation: "gte", operand: "10",
          conditions: [
            { field: "", operation: "lte", operand: "20", and: true },
            { field: "", operation: "eq", operand: "40", and: false },
          ] } },
    ]);
    await expect(answer).toHaveValue("true");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " filters records through OR groups and negative conditions", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported,
      '[{"name":"Alpha","score":12},{"name":"Beta","score":18},{"name":"Gamma","score":25},{"name":"Delta","score":40}]', [
        { id: "parse-items", kind: "transform", source: "items", into: "items",
          transform: { kind: "parse" } },
        { id: "filter", kind: "transform", source: "items", into: "items",
          transform: { kind: "filter", field: "score", operation: "gte", operand: "10",
            conditions: [
              { field: "score", operation: "lte", operand: "20", and: true },
              { field: "name", operation: "contains", operand: "Del", and: false },
            ] } },
        { id: "names", kind: "transform", source: "items", into: "items",
          transform: { kind: "map-field", field: "name" } },
        { id: "join", kind: "transform", source: "items", into: "items",
          transform: { kind: "join", separator: "," } },
      ]);
    await expect(answer).toHaveValue("Alpha,Beta,Delta");
    expect(errors).toEqual([]);
  });
}

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " reads a holiday dictionary using a variable date key", async ({ page }) => {
    const data = JSON.stringify({ "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日" });
    const { answer, errors } = await runChain(page, exported, data, [
      { id: "date", kind: "set-var", into: "selectedDate", value: "2026-11-23" },
      { id: "parse-holidays", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "read-holiday", kind: "transform", source: "items", into: "items", transform: { kind: "field", key: "{selectedDate}" } },
    ]);
    await expect(answer).toHaveValue("勤労感謝の日");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " converts a holiday dictionary into filterable list rows", async ({ page }) => {
    const data = JSON.stringify({
      "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日", "2027-01-01": "元日",
    });
    const { answer, errors } = await runChain(page, exported, data, [
      { id: "parse-holidays", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "rows", kind: "transform", source: "items", into: "items",
        transform: { kind: "object-entries", keyField: "日付", valueField: "祝日名" } },
      { id: "filter-days", kind: "transform", source: "items", into: "items",
        transform: { kind: "filter", field: "祝日名", operation: "contains", operand: "の日" } },
      { id: "sort-days", kind: "transform", source: "items", into: "items",
        transform: { kind: "sort", field: "日付", direction: "desc" } },
      { id: "names", kind: "transform", source: "items", into: "items",
        transform: { kind: "map-field", field: "祝日名" } },
      { id: "join", kind: "transform", source: "items", into: "items",
        transform: { kind: "join", separator: " / " } },
    ]);
    await expect(answer).toHaveValue("勤労感謝の日 / 文化の日");
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

test("canvas supports object-to-list field names and dynamic dictionary key input", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push(
        { id: "dictionary-rows", kind: "transform", source: "data", into: "rows",
          transform: { kind: "field", key: "" } },
        { id: "dictionary-key", kind: "transform", source: "data", into: "value",
          transform: { kind: "field", key: "" } },
      );
    });
  });
  const rows = page.locator('[data-sel-key="step:dictionary-rows"]');
  await rows.getByRole("combobox", { name: "加工の種類" }).selectOption("object-entries");
  await expect(rows.getByPlaceholder("キーの項目名")).toHaveValue("キー");
  await expect(rows.getByPlaceholder("値の項目名")).toHaveValue("値");
  await rows.getByPlaceholder("キーの項目名").fill("日付");
  await rows.getByPlaceholder("キーの項目名").blur();
  await rows.getByPlaceholder("値の項目名").fill("祝日名");
  await rows.getByPlaceholder("値の項目名").blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "dictionary-rows").transform;
  })).toMatchObject({ kind: "object-entries", keyField: "日付", valueField: "祝日名" });
  const lookup = page.locator('[data-sel-key="step:dictionary-key"]');
  const key = lookup.getByRole("combobox", { name: "取り出す項目名" });
  await expect(key).toHaveAttribute("placeholder", "項目名 / {変数}");
  await key.fill("{selectedDate}");
  await key.blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "dictionary-key").transform.key;
  })).toBe("{selectedDate}");
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

test("canvas native select and picker button share the same dropdown appearance", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "dropdown-style", kind: "transform", source: "data", into: "chosen",
        transform: { kind: "field", key: "name" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:dropdown-style"]');
  const picker = box.getByRole("button", { name: "加工する元の変数" });
  const select = box.getByRole("combobox", { name: "加工の種類" });
  await expect(picker).toBeVisible();
  await expect(select).toBeVisible();

  const styles = await Promise.all([picker, select].map((control) =>
    control.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: style.height,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        borderRadius: style.borderRadius,
        borderWidth: style.borderTopWidth,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        backgroundPosition: style.backgroundPosition,
        backgroundSize: style.backgroundSize,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        appearance: style.appearance,
      };
    })));
  expect(styles[0]).toEqual(styles[1]);
  expect(styles[0].height).toBe("24px");
  expect(styles[0].appearance).toBe("none");
  expect(styles[0].backgroundImage).toContain("svg");

  await picker.focus();
  const focusedPicker = await picker.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderTopColor, backgroundColor: style.backgroundColor };
  });
  await select.focus();
  const focusedSelect = await select.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderTopColor, backgroundColor: style.backgroundColor };
  });
  expect(focusedPicker).toEqual(focusedSelect);
});

test("canvas fixed-option dropdowns shrink to their widest choice", async ({ page }) => {
  const box = page.locator('[data-sel-key="step:numeric"]');
  const method = box.getByRole("combobox", { name: "計算方法" });
  const kind = box.getByRole("combobox", { name: "計算する値の種類" });
  await expect(method).toHaveCSS("width", /\\d+px/);
  const dimensions = await Promise.all([method, kind].map(el => el.evaluate((node) => {
    const styles = getComputedStyle(node);
    return { width: node.getBoundingClientRect().width, intrinsic: styles.width, flex: styles.flexGrow };
  })));
  for (const dimension of dimensions) {
    expect(dimension.width).toBeLessThan(120);
    expect(dimension.flex).toBe("0");
  }
  for (const control of [method, kind]) {
    const measurements = await control.evaluate((node) => {
      const select = node as HTMLSelectElement;
      const style = getComputedStyle(select);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const longest = Math.max(...Array.from(select.options, (option) => ctx.measureText(option.textContent ?? "").width));
      const left = parseFloat(style.paddingLeft);
      const right = parseFloat(style.paddingRight);
      const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      return { actual: select.getBoundingClientRect().width, required: longest + left + right + borders, right };
    });
    expect(measurements.right).toBe(30);
    // Reject both clipped labels and unnecessarily wide boxes.
    expect(measurements.actual).toBeGreaterThanOrEqual(measurements.required - 2);
    expect(measurements.actual).toBeLessThanOrEqual(measurements.required + 3);
    const initialWidth = measurements.actual;
    await control.selectOption({ index: 1 });
    await expect.poll(async () => control.evaluate((element) =>
      element.getBoundingClientRect().width)).toBeCloseTo(initialWidth, 1);
  }
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


test("canvas repeat number arrows increment by one and wait/repeat can use variables", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push(
        { id: "repeat-count", kind: "repeat", times: 3, then: [] },
        { id: "wait-seconds", kind: "wait", seconds: 0.2 },
      );
    });
  });
  const repeat = page.locator('[data-sel-key="step:repeat-count"]');
  const number = repeat.getByRole("spinbutton");
  await expect(number).toHaveAttribute("step", "1");
  await number.fill("3");
  await number.press("ArrowUp");
  await number.blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "repeat-count").times)).toBe(4);

  await repeat.getByRole("combobox", { name: "値の指定方法" }).selectOption("variable");
  await repeat.getByPlaceholder("{変数}").fill("data.price");
  await repeat.getByPlaceholder("{変数}").blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "repeat-count").times)).toBe("{data.price}");

  const wait = page.locator('[data-sel-key="step:wait-seconds"]');
  await wait.getByRole("combobox", { name: "値の指定方法" }).selectOption("variable");
  await wait.getByPlaceholder("{変数}").fill("data.price");
  await wait.getByPlaceholder("{変数}").blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "wait-seconds").seconds)).toBe("{data.price}");
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


test("canvas list value transforms use one input without literal type dropdowns", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push(
        { id: "append-value", kind: "transform", source: "data.tags", into: "added",
          transform: { kind: "append", operand: "", operandType: "text" } },
        { id: "remove-value", kind: "transform", source: "data.tags", into: "removed",
          transform: { kind: "remove", operand: "", operandType: "text" } },
        { id: "map-value", kind: "transform", source: "data.rows", into: "mapped",
          transform: { kind: "map-set", field: "selected", operand: "", operandType: "text" } },
      );
    });
  });
  for (const id of ["append-value", "remove-value", "map-value"]) {
    const box = page.locator(`[data-sel-key="step:${id}"]`);
    await expect(box.getByRole("combobox", { name: "操作する値の種類" })).toHaveCount(0);
    await expect(box.getByRole("combobox", { name: "比較する値の種類" })).toHaveCount(0);
    await expect(box.locator(".se-composer-operand input")).toHaveCount(1);
  }
  const append = page.locator('[data-sel-key="step:append-value"]');
  const appendValue = append.getByPlaceholder("追加・削除する値 / {変数}");
  await appendValue.fill("42");
  await appendValue.blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "append-value").transform;
  })).toMatchObject({ operand: "42", operandType: "number" });
  await appendValue.fill("{data.price}");
  await appendValue.blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "append-value").transform;
  })).toMatchObject({ operand: "{data.price}", operandType: "text" });
  const remove = page.locator('[data-sel-key="step:remove-value"]');
  await remove.getByPlaceholder("追加・削除する値 / {変数}").fill('"true"');
  await remove.locator(".se-composer-operand input").blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "remove-value").transform;
  })).toMatchObject({ operand: "true", operandType: "text" });
  const map = page.locator('[data-sel-key="step:map-value"]');
  await map.getByPlaceholder("設定する値 / {変数}").fill("null");
  await map.locator(".se-composer-operand input").blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "map-value").transform;
  })).toMatchObject({ operand: "", operandType: "null" });
});

test("canvas list sort uses ascending and descending labels", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "sort-labels", kind: "list-display", mode: "sort", array: "data.rows",
        field: "title", op: "eq", value: "", dir: "asc",
      });
    });
  });
  const box = page.locator('[data-sel-key="step:sort-labels"]');
  const direction = box.locator('select:has(option[value="asc"])');
  await expect(direction.locator('option[value="asc"]')).toHaveText("昇順");
  await expect(direction.locator('option[value="desc"]')).toHaveText("降順");
  await direction.selectOption("desc");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "sort-labels").dir;
  })).toBe("desc");
});

test("canvas fallback uses one text field for text mixed with variables", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "fallback-inline", kind: "transform", source: "data.name", into: "chosen",
        transform: { kind: "fallback", text: "" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:fallback-inline"]');
  const value = box.getByPlaceholder("代わりに使う値 / {変数}");
  await expect(value).toBeVisible();
  await value.fill("こんにちは、{data.name}さん");
  await value.blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "fallback-inline").transform.text;
  })).toBe("こんにちは、{data.name}さん");
});

test("canvas value comparisons use the same predicates and joined clauses as list filters", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "compound", kind: "transform", source: "data.price", into: "eligible",
        transform: { kind: "compare", operation: "eq", operand: "12" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:compound"]');
  const orderIsNatural = async () => box.locator(".se-composer-condition-line").first().evaluate((line) => {
    const value = line.querySelector('input');
    const operator = line.querySelector('select[aria-label="比較方法"]');
    const polarity = line.querySelector('select[aria-label="条件の判定"]');
    return !!value && !!operator && !!polarity &&
      !!(value.compareDocumentPosition(operator) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      !!(operator.compareDocumentPosition(polarity) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  await expect.poll(orderIsNatural).toBe(true);
  await box.getByRole("combobox", { name: "比較方法" }).first().selectOption("gte");
  await box.getByRole("combobox", { name: "条件の判定" }).first().selectOption("not");
  await box.getByRole("button", { name: /かつ/ }).last().click();
  await expect(box.getByRole("combobox", { name: "条件のつなぎ方" })).toHaveValue("and");
  await box.getByRole("combobox", { name: "比較方法" }).nth(1).selectOption("lte");
  await box.getByRole("button", { name: /または/ }).last().click();
  await box.getByRole("combobox", { name: "条件のつなぎ方" }).nth(1).selectOption("or");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "compound")?.transform;
  })).toMatchObject({ kind: "compare", operation: "gte", not: true,
    conditions: [{ operation: "lte", and: true }, { and: false }] });
});

test("canvas comparison offers existing variables and keeps the chosen reference", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "compare-native", kind: "transform", source: "data.price", into: "selected",
        transform: { kind: "compare", operation: "gt", operand: "" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:compare-native"]');
  await expect(box.getByRole("combobox", { name: "比較する値の種類" })).toHaveCount(0);
  const operand = box.getByPlaceholder("値 / {変数}");
  await expect(operand).toBeVisible();
  await operand.fill("{data.price}");
  await operand.blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "compare-native").transform;
  })).toMatchObject({ kind: "compare", operand: "{data.price}" });
});


test("canvas list filter keeps condition actions on a separate row and lets each connector change", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "filter-conditions", kind: "list-display", mode: "filter",
        array: "data.tags", field: "", op: "eq", value: "red", dir: "asc",
      });
    });
  });
  const box = page.locator('[data-sel-key="step:filter-conditions"]');
  const actions = box.locator(".se-composer-condition-actions");
  await expect(actions).toBeVisible();
  await expect(actions.getByRole("button", { name: "かつ" })).toBeVisible();
  await actions.getByRole("button", { name: "かつ" }).click();
  const connectors = box.getByRole("combobox", { name: "条件のつなぎ方" });
  await expect(connectors).toHaveCount(1);
  await expect(connectors.first()).toHaveValue("and");
  await connectors.first().selectOption("or");
  await actions.getByRole("button", { name: "または" }).click();
  await expect(connectors).toHaveCount(2);
  await expect(connectors.nth(1)).toHaveValue("or");
  await connectors.nth(1).selectOption("and");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "filter-conditions").or.map((c: any) => c.and);
  })).toEqual([false, true]);
  const buttonBottom = await actions.boundingBox();
  const conditionBottom = await connectors.last().boundingBox();
  expect(buttonBottom).not.toBeNull();
  expect(conditionBottom).not.toBeNull();
  expect(buttonBottom!.y).toBeGreaterThan(conditionBottom!.y);
  await box.getByRole("button", { name: "この条件を削除" }).first().click();
  await expect(connectors).toHaveCount(1);
  await expect(connectors).toHaveValue("and");
});
