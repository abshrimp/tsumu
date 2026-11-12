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
    schemaVersion: 1, siteName: "Block composition", assets: {}, nodes: { button: node }, pageOrder: ["p"],
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
      { id: "math", kind: "transform", source: "items", into: "items", transform: { kind: "math", operation: "multiply", operandType: "number", operand: 2 } },
      { id: "add", kind: "transform", source: "items", into: "items", transform: { kind: "math", operation: "add", operandType: "number", operand: 3 } },
    ]);
    await expect(answer).toHaveValue("27");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " text operations automatically convert numbers and booleans", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "12345", [
      { id: "split", kind: "transform", source: "items", into: "items",
        transform: { kind: "split", separator: "3" } },
      { id: "join", kind: "transform", source: "items", into: "items",
        transform: { kind: "join", separator: "-" } },
    ]);
    await expect(answer).toHaveValue("12-45");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " equality matches typed boolean and text variables", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "true", [
      { id: "as-text", kind: "set-var", into: "expected", value: '"true"' },
      { id: "compare", kind: "if",
        cond: { subject: "var", target: "", left: "{items}", op: "eq", value: "{expected}" },
        then: [{ id: "yes", kind: "set-var", into: "items", value: "matched" }],
        else: [{ id: "no", kind: "set-var", into: "items", value: "unmatched" }],
      },
    ]);
    await expect(answer).toHaveValue("matched");
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
          transform: { kind: "math", operation: "add", operandType: "number", operand: 1 } },
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
    schemaVersion: 1, siteName: "Named states", assets: {}, nodes: { trigger: button, reset, remote },
    pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home",
      description: "", children: ["trigger", "reset", "remote"] } },
  };
  const project = generateProject(doc);
  const css = project.files["styles/site.css"];
  const className = /\.([a-zA-Z0-9_-]+)\[data-site-state="selected"\]/.exec(css)?.[1];
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
  await expect(page.locator("#remote")).toHaveAttribute("data-site-state", "selected");
  await expect(page.locator("#remote")).toHaveCSS("background-color", "rgb(255, 0, 0)");
  await page.locator("#reset").click();
  await expect(page.locator("#remote")).not.toHaveAttribute("data-site-state");
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
      schemaVersion: 1, siteName: "Negated filter", assets: {}, nodes: { filterButton: button }, pageOrder: ["p"],
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
        transform: { kind: "fallback", when: "missing", text: "こんにちは、{name}さん" } },
    ]);
    await expect(answer).toHaveValue("こんにちは、田中さん");
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


}

for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " JSON keys cannot pollute script variables", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '{"polluted":"unsafe"}', [
      { id: "parse-object", kind: "transform", source: "items", into: "items", transform: { kind: "parse" } },
      { id: "store-prototype", kind: "set-var", into: "__proto__", value: "{items}" },
      { id: "safe-fallback", kind: "transform", source: "polluted", into: "items",
        transform: { kind: "fallback", when: "missing", text: "safe" } },
    ]);
    await expect(answer).toHaveValue("safe");
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => ({} as Record<string, unknown>).polluted)).toBeUndefined();
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " evaluates AND before OR in multi-clause if blocks", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "", [
      { id: "first", kind: "set-var", into: "first", value: "yes" },
      { id: "second", kind: "set-var", into: "second", value: "no" },
      { id: "third", kind: "set-var", into: "third", value: "blue" },
      { id: "if-combined", kind: "if",
        cond: { subject: "var", target: "", left: "{first}", op: "eq", value: "yes" },
        conditions: [
          { subject: "var", target: "", left: "{second}", op: "eq", value: "yes", and: true },
          { subject: "var", target: "", left: "{third}", op: "eq", value: "red", not: true, and: false },
        ],
        then: [{ id: "pass", kind: "set-var", into: "items", value: "accepted" }],
        else: [{ id: "fail", kind: "set-var", into: "items", value: "rejected" }],
      },
    ]);
    await expect(answer).toHaveValue("accepted");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " retains variable predicates when the first if clause reads an element", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "", [
      { id: "status", kind: "set-var", into: "status", value: "ready" },
      { id: "mixed-if", kind: "if",
        cond: { subject: "value", target: "answer", op: "eq", value: "absent" },
        conditions: [
          { subject: "var", target: "", left: "{status}", op: "eq", value: "ready", and: false },
        ],
        then: [{ id: "pass", kind: "set-var", into: "items", value: "accepted" }],
        else: [{ id: "fail", kind: "set-var", into: "items", value: "rejected" }],
      },
    ]);
    await expect(answer).toHaveValue("accepted");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " ignores unfinished AND/OR if conditions", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "", [
      { id: "status", kind: "set-var", into: "status", value: "waiting" },
      { id: "if-unfinished", kind: "if",
        cond: { subject: "var", target: "", left: "{status}", op: "eq", value: "ready" },
        conditions: [
          { subject: "var", target: "", left: "", op: "eq", value: "", and: true },
          { subject: "var", target: "", left: "", op: "eq", value: "", and: false },
        ],
        then: [{ id: "accept", kind: "set-var", into: "items", value: "accepted" }],
        else: [{ id: "reject", kind: "set-var", into: "items", value: "rejected" }],
      },
    ]);
    await expect(answer).toHaveValue("rejected");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " reads form fields in arithmetic operands", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "4", [
      { id: "rate-field", kind: "set-value", target: "answer", value: "3" },
      { id: "math", kind: "transform", source: "items", into: "items",
        transform: { kind: "math", operation: "multiply", operandType: "variable", operand: "answer" } },
    ]);
    await expect(answer).toHaveValue("12");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " interpolates form values in transform parameters", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "", [
      { id: "input-value", kind: "set-value", target: "answer", value: "東京" },
      { id: "fallback", kind: "transform", source: "absent", into: "items",
        transform: { kind: "fallback", when: "missing", text: "行き先: {answer}" } },
    ]);
    await expect(answer).toHaveValue("行き先: 東京");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  for (const [label, condition] of [
    ["unconfigured", { subject: "value" as const, target: "", op: "eq" as const, value: "" }],
    ["deleted", { subject: "value" as const, target: "deleted-element", op: "eq" as const, value: "", not: true }],
    ["negated-visibility", { subject: "visible" as const, target: "deleted-element", not: true }],
  ] as const) {
    test((exported ? "exported" : "preview") + " rejects " + label + " if element targets", async ({ page }) => {
      const { answer, errors } = await runChain(page, exported, "", [
        { id: "target-if", kind: "if", cond: condition,
          then: [{ id: "accepted", kind: "set-var", into: "items", value: "accepted" }],
          else: [{ id: "rejected", kind: "set-var", into: "items", value: "rejected" }],
        },
      ]);
      await expect(answer).toHaveValue("rejected");
      expect(errors).toEqual([]);
    });
  }
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " preserves OR grouping around incomplete if clauses", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "", [
      { id: "left-value", kind: "set-var", into: "left", value: "no" },
      { id: "right-value", kind: "set-var", into: "right", value: "yes" },
      { id: "or-with-gap", kind: "if",
        cond: { subject: "var", target: "", left: "{left}", op: "eq", value: "yes" },
        conditions: [
          { subject: "var", target: "", left: "", op: "eq", value: "", and: false },
          { subject: "var", target: "", left: "{right}", op: "eq", value: "yes", and: true },
        ],
        then: [{ id: "pass", kind: "set-var", into: "items", value: "accepted" }],
        else: [{ id: "fail", kind: "set-var", into: "items", value: "rejected" }],
      },
    ]);
    await expect(answer).toHaveValue("accepted");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " keeps OR logic across unfinished list filter clauses", async ({ page }) => {
    const filter = {
      ...makeBox(), id: "filterButton", attrId: "filterButton",
      scripts: [{ id: "filterScript", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [{
        id: "filterWithGap", kind: "list-display" as const, mode: "filter" as const,
        array: "results", field: "name", op: "eq" as const, value: "red", dir: "asc" as const,
        or: [
          { field: "", op: "eq" as const, value: "", and: false },
          { field: "active", op: "eq" as const, value: "yes", and: true },
        ],
      }] }],
    };
    const doc: SiteDoc = {
      schemaVersion: 1, siteName: "Filter gap", assets: {}, nodes: { filterButton: filter }, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "",
        children: ["filterButton"] } },
    };
    await page.setContent('<html><body><button id="filterButton">Run</button><section data-array="results">' +
      '<div data-item=\'{"name":"red","active":"no"}\' id="red">red</div>' +
      '<div data-item=\'{"name":"blue","active":"yes"}\' id="blue">blue</div>' +
      '<div data-item=\'{"name":"blue","active":"no"}\' id="other">other</div>' +
      '</section></body></html>');
    await page.locator("#filterButton").evaluate((el, script) =>
      el.setAttribute("data-scripts", JSON.stringify(script)), compileScripts(filter, () => "/"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addScriptTag({ content: exported ? scriptsFile(doc) : "(" + SCRIPT_RUNTIME + ")({}).install(document);" });
    await page.locator("#filterButton").click();
    await expect(page.locator("#red")).toHaveCSS("display", "contents");
    await expect(page.locator("#blue")).toHaveCSS("display", "contents");
    await expect(page.locator("#other")).toHaveCSS("display", "none");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " safely filters object-valued fields from JSON", async ({ page }) => {
    const filter = {
      ...makeBox(), id: "filterButton", attrId: "filterButton",
      scripts: [{ id: "filterScript", trigger: "click" as const, pos: { x: 0, y: 0 }, steps: [{
        id: "filterObjectField", kind: "list-display" as const, mode: "filter" as const,
        array: "results", field: "meta", op: "has-key" as const,
        value: "toString", dir: "asc" as const,
      }] }],
    };
    const doc: SiteDoc = {
      schemaVersion: 1, siteName: "Safe JSON filter", assets: {}, nodes: { filterButton: filter }, pageOrder: ["p"],
      pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "",
        children: ["filterButton"] } },
    };
    await page.setContent('<html><body><button id="filterButton">Run</button><section data-array="results">' +
      '<div data-item=\'{"meta":{"toString":"broken"}}\' id="obj">object</div>' +
      '<div data-item=\'{"meta":"other"}\' id="other">other</div>' +
      '</section></body></html>');
    await page.locator("#filterButton").evaluate((el, script) =>
      el.setAttribute("data-scripts", JSON.stringify(script)), compileScripts(filter, () => "/"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addScriptTag({ content: exported ? scriptsFile(doc) : "(" + SCRIPT_RUNTIME + ")({}).install(document);" });
    await page.locator("#filterButton").click();
    await expect(page.locator("#obj")).toHaveCSS("display", "contents");
    await expect(page.locator("#other")).toHaveCSS("display", "none");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " nested list item fields shadow global variables in transforms", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '[{"profile":{}}]', [
      { id: "global-profile", kind: "set-var", into: "profile", value: '{"age":20}' },
      { id: "parse-global", kind: "transform", source: "profile", into: "profile",
        transform: { kind: "parse" } },
      { id: "parse-rows", kind: "transform", source: "items", into: "items",
        transform: { kind: "parse" } },
      { id: "each-row", kind: "for-each", array: "items", then: [
        { id: "local-age", kind: "transform", source: "profile.age", into: "picked",
          transform: { kind: "fallback", when: "missing", text: "missing" } },
        { id: "display-picked", kind: "set-var", into: "items", value: "{picked}" },
      ] },
    ]);
    await expect(answer).toHaveValue("missing");
    expect(errors).toEqual([]);
  });
}


for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " extracts nested JSON keys and final array positions", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported,
      '{"meta":{"scores":[3,7],"city":"Kyoto"}}', [
      { id: "parse-object", kind: "transform", source: "items", into: "items",
        transform: { kind: "parse" } },
      { id: "nested-final", kind: "transform", source: "items", into: "items",
        transform: { kind: "field", key: "meta.scores.-1" } },
    ]);
    await expect(answer).toHaveValue("7");
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

test("canvas reads dictionary fields by key", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push(
        { id: "dictionary-key", kind: "transform", source: "data", into: "value",
          transform: { kind: "field", key: "" } },
      );
    });
  });
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

test("canvas processing settings persist changes directly", async ({ page }) => {
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

test("canvas arithmetic options size to the widest label", async ({ page }) => {
  // 最初の読み込みの間のフォントの寸法の変化を、選択による大きさの変化と取り違えてはならない。
  await page.evaluate(async () => { await document.fonts.ready; });
  const box = page.locator('[data-sel-key="step:numeric"]');
  const method = box.getByRole("combobox", { name: "計算方法" });
  await expect(box.getByPlaceholder("計算する値 / {変数}")).toBeVisible();
  await expect(method).toHaveCSS("width", /\d+px/);
  const dimensions = await Promise.all([method].map(el => el.evaluate((node) => {
    const styles = getComputedStyle(node);
    return { width: node.getBoundingClientRect().width, intrinsic: styles.width, flex: styles.flexGrow };
  })));
  for (const dimension of dimensions) {
    expect(dimension.width).toBeLessThan(120);
    expect(dimension.flex).toBe("0");
  }
  for (const control of [method]) {
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
    // ラベルが切れているものも、必要以上に幅の広い枠も、どちらも不合格にする。
    expect(measurements.actual).toBeGreaterThanOrEqual(measurements.required - 2);
    expect(measurements.actual).toBeLessThanOrEqual(measurements.required + 3);
    const initialWidth = measurements.actual;
    await control.selectOption({ index: 1 });
    await control.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const selectedWidth = await control.evaluate((element) => element.getBoundingClientRect().width);
    // 丸め方はブラウザによって違うが、別の選択肢を選んでも、ドロップダウンの幅が
    // 大きく変わったり、最も長いラベルが切れたりしてはならない。
    expect(selectedWidth).toBeGreaterThanOrEqual(measurements.required - 2);
    expect(selectedWidth).toBeLessThanOrEqual(measurements.required + 3);
    expect(Math.abs(selectedWidth - initialWidth)).toBeLessThanOrEqual(2);
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


test("canvas wait/repeat accept numbers and variables in one field", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push(
        { id: "repeat-count", kind: "repeat", times: 3, then: [] },
        { id: "wait-seconds", kind: "wait", seconds: 0.2 },
      );
    });
  });
  const repeat = page.locator('[data-sel-key="step:repeat-count"]');
  const repeatValue = repeat.getByPlaceholder("数値 / {変数}");
  await expect(repeat.getByRole("combobox", { name: "値の指定方法" })).toHaveCount(0);
  await repeatValue.fill("4");
  await repeatValue.blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "repeat-count").times)).toBe(4);

  await repeatValue.fill("{data.price}");
  await repeatValue.blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "repeat-count").times)).toBe("{data.price}");

  const wait = page.locator('[data-sel-key="step:wait-seconds"]');
  await wait.getByPlaceholder("数値 / {変数}").fill("{data.price}");
  await wait.getByPlaceholder("数値 / {変数}").blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "wait-seconds").seconds)).toBe("{data.price}");
});

test("canvas arithmetic accepts values and variables in one field", async ({ page }) => {
  const box = page.locator('[data-sel-key="step:numeric"]');
  const operand = box.getByPlaceholder("計算する値 / {変数}");
  await operand.fill("{data.price}");
  await operand.blur();
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "numeric").transform;
  })).toMatchObject({ kind: "math", operandType: "variable", operand: "data.price" });
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
        transform: { kind: "fallback", when: "missing", text: "" },
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

test("canvas if blocks add, edit and remove AND/OR conditions on separate rows", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "joined-if", kind: "if",
        cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
        then: [], else: [],
      });
    });
  });
  const box = page.locator('[data-sel-key="step:joined-if"]');
  const actions = box.locator(".se-composer-condition-actions");
  await expect(actions.getByRole("button", { name: "かつ", exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "かつ", exact: true }).click();
  const connectors = box.getByRole("combobox", { name: "条件のつなぎ方" });
  await expect(connectors).toHaveCount(1);
  await expect(connectors).toHaveValue("and");
  await connectors.selectOption("or");
  await actions.getByRole("button", { name: "または", exact: true }).click();
  await expect(connectors).toHaveCount(2);
  await connectors.nth(1).selectOption("and");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((step: any) => step.id === "joined-if").conditions.map((condition: any) => condition.and);
  })).toEqual([false, true]);
  const actionBounds = await actions.boundingBox();
  const clauseBounds = await box.locator(".se-if-condition-line").last().boundingBox();
  expect(actionBounds).not.toBeNull();
  expect(clauseBounds).not.toBeNull();
  expect(actionBounds!.y).toBeGreaterThan(clauseBounds!.y);
  await box.getByRole("button", { name: "この条件を削除" }).first().click();
  await expect(connectors).toHaveCount(1);
  await expect(connectors).toHaveValue("and");
  await expect(box.locator(".se-if-condition-line")).toHaveCount(2);
});


test("canvas cross-filter connector only appears when another filter uses the same list", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push(
        { id: "filter-a", kind: "list-display", mode: "filter", array: "data.tags",
          field: "値", op: "eq", value: "A", dir: "asc", no: 1 },
        { id: "filter-b", kind: "list-display", mode: "filter", array: "data.rows",
          field: "name", op: "eq", value: "B", dir: "asc", no: 1 },
      );
    });
  });
  const first = page.locator('[data-sel-key="step:filter-a"]');
  const connector = first.getByRole("combobox", { name: "ほかの絞り込みとのつなぎ方" });
  const buttons = first.locator(".se-composer-condition-actions");
  await expect(connector).toHaveCount(0);
  await expect(buttons.getByRole("button", { name: "かつ", exact: true })).toBeVisible();
  await expect(buttons.getByRole("button", { name: "または", exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.find((st: any) => st.id === "filter-b").array = "data.tags";
      doc.pages.p.pageScripts[0].steps.find((st: any) => st.id === "filter-b").no = 2;
    });
  });
  await expect(connector).toBeVisible();
  await connector.selectOption("or");
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((st: any) => st.id === "filter-a").join;
  })).toBe("or");
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.find((st: any) => st.id === "filter-b").array = "data.rows";
    });
  });
  await expect(connector).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
    return steps.find((st: any) => st.id === "filter-a").join;
  })).toBe("or");
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



for (const exported of [false, true]) {
  test((exported ? "exported" : "preview") + " list loops select matching entries with values, keys and early exit", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported,
      '{"apple":100,"banana":200,"orange":300}', [
        { id: "result", kind: "set-var", into: "chosen", value: "none" },
        { id: "each", kind: "for-each", array: "items", then: [
          { id: "check", kind: "if",
            cond: { subject: "var", target: "", left: "{ループ.値}", op: "gte", value: "200" },
            then: [
              { id: "save", kind: "set-var", into: "chosen", value: "{ループ.キー}" },
              { id: "stop", kind: "break-loop" },
            ] },
        ] },
        { id: "display-result", kind: "set-var", into: "items", value: "{chosen}" },
      ]);
    await expect(answer).toHaveValue("banana");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " removes all equal list items with typed values", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '["red","blue","red","green"]', [
      { id: "delete-red", kind: "remove-list-item", list: "items", mode: "value", value: '"red"' },
      { id: "join", kind: "transform", source: "items", into: "items", transform: { kind: "join", separator: "|" } },
    ]);
    await expect(answer).toHaveValue("blue|green");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " removes a single positional item and keeps list order", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '["a","b","c","d"]', [
      { id: "delete-second", kind: "remove-list-item", list: "items", mode: "key", value: "1" },
      { id: "join", kind: "transform", source: "items", into: "items", transform: { kind: "join", separator: "|" } },
    ]);
    await expect(answer).toHaveValue("a|c|d");
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " removes dictionary entries by value and key", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, '{"a":1,"b":2,"c":"2","d":3}', [
      { id: "delete-twos", kind: "remove-list-item", list: "items", mode: "value", value: "2" },
      { id: "delete-first", kind: "remove-list-item", list: "items", mode: "key", value: "a" },
      { id: "stringify", kind: "transform", source: "items", into: "items", transform: { kind: "stringify" } },
    ]);
    await expect(answer).toHaveValue('{"d":3}');
    expect(errors).toEqual([]);
  });

  test((exported ? "exported" : "preview") + " list construction uses keyed assignments and keeps typed values", async ({ page }) => {
    const { answer, errors } = await runChain(page, exported, "unused", [
      { id: "empty", kind: "set-var", into: "basket", value: "[]" },
      { id: "first", kind: "set-list-item", list: "basket", key: "", value: "10" },
      { id: "second", kind: "set-list-item", list: "basket", key: "", value: "20" },
      { id: "total", kind: "transform", source: "basket", into: "count", transform: { kind: "length" } },
      { id: "result", kind: "set-var", into: "items", value: "{count}" },
    ]);
    await expect(answer).toHaveValue("2");
    expect(errors).toEqual([]);
  });
}

test("canvas transform menu exposes four groups without explicit text conversion", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "transform-groups", kind: "transform", source: "data.tags", into: "result",
        transform: { kind: "field", key: "" },
      });
    });
  });
  const menu = page.locator('[data-sel-key="step:transform-groups"] select[aria-label="加工の種類"]');
  await expect(menu).toHaveValue("field");
  expect(await menu.locator("optgroup").evaluateAll((groups) =>
    groups.map((group) => ({
      label: (group as HTMLOptGroupElement).label,
      values: [...group.querySelectorAll("option")].map((option) => option.value),
    })))).toEqual([
    { label: "値の取得・補完", values: ["field", "fallback"] },
    { label: "数値・文字列の加工", values: ["math", "split", "replace", "join"] },
    { label: "リストの操作", values: ["length", "sort", "append"] },
    { label: "JSONの変換", values: ["stringify", "parse"] },
  ]);
});

test.describe("English transform menu", () => {
  test.use({ locale: "en-US" });

  test("operation groups, list operations and arithmetic choices use English", async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    const block = page.locator('[data-sel-key="step:numeric"]');
    const operations = block.getByRole("combobox", { name: "Operation", exact: true });
    await expect(operations).toHaveValue("math");
    expect(await operations.locator("optgroup").evaluateAll((groups) =>
      groups.map((group) => (group as HTMLOptGroupElement).label)
    )).toEqual(["Extract and fallback", "Number and text operations", "List operations", "JSON conversion"]);
    await expect(operations.locator("option")).toHaveText([
      "Get an item from a list", "Use another value if missing",
      "Calculate a number", "Split text", "Replace text", "Join a list as text",
      "Count list items", "Sort a list", "Append to list", "Convert to JSON text", "Parse JSON text",
    ]);
    await expect(block.getByRole("combobox", { name: "Arithmetic operation" }).locator("option"))
      .toHaveText(["Add", "Subtract", "Multiply", "Divide", "Remainder"]);
  });
});

test("canvas removal block switches between value and position/key", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "remove-entry", kind: "remove-list-item", list: "data.tags",
        mode: "value", value: "",
      });
    });
  });
  const block = page.locator('[data-sel-key="step:remove-entry"]');
  const method = block.getByRole("combobox", { name: "削除方法" });
  await expect(method).toHaveValue("value");
  await method.selectOption("key");
  const input = block.getByPlaceholder("値 / {変数}");
  await input.fill("1");
  await input.blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "remove-entry")
  )).toMatchObject({ kind: "remove-list-item", list: "data.tags", mode: "key", value: "1" });
});

test("canvas append values use one typed input", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      doc.pages.p.pageScripts[0].steps.push({
        id: "append-value", kind: "transform", source: "data.tags", into: "added",
        transform: { kind: "append", operand: "", operandType: "text" },
      });
    });
  });
  const box = page.locator('[data-sel-key="step:append-value"]');
  const input = box.getByPlaceholder("追加・削除する値 / {変数}");
  await input.fill("42");
  await input.blur();
  await expect.poll(() => page.evaluate(() =>
    (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
      .find((step: any) => step.id === "append-value").transform
  )).toMatchObject({ kind: "append", operand: "42", operandType: "number" });
});

test("canvas field picker leaves Japanese composition keys to the IME", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
      const steps = doc.pages.p.pageScripts[0].steps;
      steps[0].preview.sample = { 商品名: "りんご", 商品番号: "001" };
      steps.push({ id: "ime-field", kind: "transform", source: "data", into: "picked",
        transform: { kind: "field", key: "" } });
    });
  });
  const key = page.locator('[data-sel-key="step:ime-field"]')
    .getByRole("combobox", { name: "取り出す項目名" });
  await key.fill("商品");
  await expect(key).toHaveAttribute("aria-expanded", "true");
  const active = await key.getAttribute("aria-activedescendant");
  const before = await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc));
  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const composingKey of ["Enter", "ArrowDown", "ArrowUp", "Escape"]) {
      await key.dispatchEvent("keydown", { key: composingKey, bubbles: true, cancelable: true, ...nativeEvent });
      await expect(key).toHaveValue("商品");
      await expect(key).toHaveAttribute("aria-expanded", "true");
      await expect(key).toHaveAttribute("aria-activedescendant", active!);
      expect(await page.evaluate(() => JSON.stringify((window as any).dataPickerStore.getState().doc))).toBe(before);
    }
  }
  await key.press("Enter");
  await expect(key).toHaveValue("商品名");
  await expect(key).toHaveAttribute("aria-expanded", "false");
});
