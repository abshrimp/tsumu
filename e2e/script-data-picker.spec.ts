import { readEditorCss } from "../tests/helpers/editor-css";
import { expect, test, type Page } from "@playwright/test";
import { expectVariableMenuLayout } from "./helpers/variable-menu-layout";
import { scriptDataPickerBundle } from "../tests/helpers/script-data-picker";
let bundle: string;
test.beforeAll(async () => { bundle = await scriptDataPickerBundle(); });

test.describe("Japanese data picker and transform blocks", () => {
test.beforeEach(async ({ page }) => {
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addStyleTag({ content: readEditorCss() });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("dialog", { name: "スクリプト", exact: true })).toBeVisible();
});
const block = (page: Page, id: string) => page.locator(`[data-step-id="${id}"]`);
const picker = (page: Page) => page.getByRole("dialog", { name: "変数を探す", exact: true });
const row = (page: Page, token: string) => picker(page).locator(".vx-row").filter({ has: page.locator(".vx-tok").filter({ hasText: new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
async function snapshot(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).dataPickerStore.getState().doc)));
}
async function selected(page: Page) { return (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "value").value; }
async function openPicker(page: Page, id = "value", selectAll = true) {
  const input = block(page, id).locator("input:not(.se-in-name)").first();
  await input.focus(); if (selectAll) await input.selectText();
  await input.press("Control+/");
  await expect(picker(page)).toBeVisible();
}
async function pick(page: Page, name: string, id = "value") {
  await picker(page).getByPlaceholder("変数名・値で検索").fill(name);
  await row(page, `{${name}}`).click();
  await block(page, id).locator("input:not(.se-in-name)").first().blur();
}

test("Script value and variable-name suggestions close on outside click", async ({ page }) => {
  const input = block(page, "value").locator("input:not(.se-in-name)").first();
  await input.focus();
  await expect(page.locator(".var-comp")).toBeVisible();
  await page.locator(".se-header").click({ position: { x: 70, y: 12 } });
  await expect(page.locator(".var-comp")).toHaveCount(0);

  const name = block(page, "value").getByPlaceholder("名前", { exact: true });
  await name.focus();
  await name.fill("");
  await expect(page.locator(".var-comp")).toBeVisible();
  await page.locator(".se-header").click({ position: { x: 70, y: 12 } });
  await expect(page.locator(".var-comp")).toHaveCount(0);
});

test("value input supports raw lists, serialization and undo", async ({ page }) => {
  const b = block(page, "value"); const before = await snapshot(page);
  await openPicker(page); await pick(page, "data");
  expect(await selected(page)).toBe("{data}");
  await expect(b.locator(".se-value-info")).toContainText("リスト");
  const changed = await snapshot(page);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click(); expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click(); expect(await snapshot(page)).toEqual(changed);
  await page.evaluate((doc) => (window as any).dataPickerStore.getState().replaceDoc(JSON.parse(JSON.stringify(doc))), changed);
  expect(await snapshot(page)).toEqual(changed);
});

test("picked references retain their types and scalar values show one concise label", async ({ page }) => {
  for (const [reference, kind] of [
    ["data.price", "値"], ["data.available", "値"], ["data.name", "値"],
    ["data.tags", undefined], ["data.empty", undefined], ["later", undefined],
  ] as const) {
    await test.step(reference, async () => {
      await openPicker(page);
      await pick(page, reference);
      expect(await selected(page)).toBe(`{${reference}}`);
      if (kind) {
        const info = block(page, "value").locator(".se-value-info");
        await expect(info.locator(".vx-kind")).toHaveText(kind);
        await expect(info.locator(":scope > *")).toHaveCount(1);
      }
    });
  }
});

test("focus suggestions keep the footer divider clear and offer touch/click and keyboard exploration", async ({ page }) => {
  const input = block(page, "value").locator("input:not(.se-in-name)").first();
  await input.focus();
  const explore = page.locator(".var-comp-explore");
  const footer = page.locator(".var-comp-foot");
  await expect(explore).toBeVisible();
  await expect(footer).toBeVisible();
  const corners = await explore.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderBottomLeftRadius, style.borderBottomRightRadius];
  });
  expect(corners).toEqual(["0px", "0px"]);
  await expect(footer).toHaveCSS("border-top-width", "1px");
  await expect(footer).toContainText("変数を探す");
  await explore.click();
  await expect(picker(page)).toBeVisible();
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await input.fill("data.name"); await input.press("Control+/");
  await expect(picker(page).getByPlaceholder("変数名・値で検索")).toHaveValue("");
  await expect(row(page, "{data}")).toBeVisible();
});

test("text picker expands object rows and keyboard chooses a scalar leaf without inserting the object", async ({ page }) => {
  const b = block(page, "copy"); await openPicker(page, "copy");
  const data = row(page, "{data}"); await data.focus(); await data.press("Enter");
  await expect(picker(page)).toBeVisible();
  const title = row(page, "{data.name}");
  await expect(title.locator(".vx-kind")).toHaveText("値");
  await title.focus(); await title.press("Enter");
  await expect(picker(page)).toHaveCount(0);
  await expect(b.locator("input:not(.se-in-name)").first()).toHaveValue("{data.name}");
  await b.locator("input:not(.se-in-name)").first().blur();
  expect((await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "copy").value).toBe("{data.name}");
});

test("mixed templates and generated code survive exploring, cancelling and save/load unchanged", async ({ page }) => {
  const before = await snapshot(page);
  const original = await page.evaluate(() => (window as any).dataPickerProject());
  await openPicker(page);
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await expect(block(page, "value").locator("input:not(.se-in-name)").first()).toHaveValue("Value {data.name}");
  await block(page, "value").locator("input:not(.se-in-name)").first().blur();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => { const store = (window as any).dataPickerStore; store.getState().replaceDoc(JSON.parse(JSON.stringify(store.getState().doc))); });
  expect(await page.evaluate(() => (window as any).dataPickerProject())).toEqual(original);
});

test("filter field dropdown marks nested Japanese category arrays as lists", async ({ page }) => {
  const filter = block(page, "category-filter");
  // リストの出どころの操作部品も se-pm-btn を使う。項目の位置の操作部品だけを選ぶ。
  const fieldPicker = filter.locator(".se-pm-btn:not(.se-list-choice)");
  await fieldPicker.click();
  const menu = page.locator(".se-pm");
  const title = menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^title$/ }),
  });
  await expect(title.locator(".vx-kind")).toHaveCount(0);
  const categories = menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^categories$/ }),
  });
  await expect(categories.locator(".vx-kind")).toHaveText("リスト");
  await categories.locator(".se-pm-enter").click();

  for (const [name, value] of [
    ["出展カテゴリ", "物販"], ["投票カテゴリ", "物販"], ["大分類", "かう"],
  ]) {
    const option = menu.locator(".se-pm-row").filter({
      has: page.locator(".se-pm-key").filter({ hasText: new RegExp("^" + name + "$") }),
    });
    await expect(option.locator(".vx-kind")).toHaveText("リスト");
    await expect(option.locator(".se-pm-val")).toContainText(value);
  }

  await menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^出展カテゴリ$/ }),
  }).locator(".dd-item").click();
  await expect(fieldPicker).toHaveText("categories › 出展カテゴリ");
  const doc = await snapshot(page);
  const savedFilter = doc.pages.p.pageScripts[0].steps.find((s: any) => s.id === "category-filter");
  expect(savedFilter.field).toBe("categories.出展カテゴリ");
  expect(doc.pages.p.pageScripts[0].steps[0].preview.sample.rows[0].categories["出展カテゴリ"]).toEqual(["物販"]);
});

test("filter can target the categories record and suggest key and list membership conditions", async ({ page }) => {
  const filter = block(page, "category-filter");
  const fieldPicker = filter.locator(".se-pm-btn:not(.se-list-choice)");
  await fieldPicker.click();
  const menu = page.locator(".se-pm");
  const categories = menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^categories$/ }),
  });
  await expect(categories.locator(".dd-item")).toBeEnabled();
  await categories.locator(".dd-item").click();

  const op = filter.locator("select.se-in").filter({
    has: page.locator('option[value="eq"]'),
  });
  await expect(op).toHaveValue("has-key");
  await expect(op.locator('option[value="starts-with"]')).toHaveCount(0);
  await expect(fieldPicker).toHaveText("categories");

  const value = filter.locator("input.se-in").first();
  await value.fill("出展カテゴリ");
  await value.blur();
  let stored = (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "category-filter");
  expect({ field: stored.field, op: stored.op, value: stored.value }).toEqual({
    field: "categories", op: "has-key", value: "出展カテゴリ",
  });

  await fieldPicker.click();
  await menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^categories$/ }),
  }).locator(".se-pm-enter").click();
  await menu.locator(".se-pm-row").filter({
    has: page.locator(".se-pm-key").filter({ hasText: /^出展カテゴリ$/ }),
  }).locator(".dd-item").click();

  await expect(op).toHaveValue("contains");
  await expect(op.locator('option[value="has-key"]')).toHaveCount(0);
  await expect(fieldPicker).toHaveText("categories › 出展カテゴリ");
  stored = (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "category-filter");
  expect({ field: stored.field, op: stored.op, value: stored.value }).toEqual({
    field: "categories.出展カテゴリ", op: "contains", value: "",
  });
});

test("if conditions allow nested list variables and choose meaningful operators", async ({ page }) => {
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps.push({
      id: "if-categories", kind: "if",
      cond: { subject: "var", target: "", left: "", op: "eq", value: "" },
      then: [],
    });
  }));
  const b = block(page, "if-categories");
  await expect(b).toBeVisible();
  const source = b.locator(".se-pm-btn");
  await source.click();
  await page.locator(".se-path-direct input").fill("data.rows.0.categories");
  await page.locator(".se-path-direct button").click();
  const operation = b.locator("select.se-in").filter({ has: page.locator('option[value="eq"]') });
  await expect(operation).toHaveValue("has-key");
  await expect(operation.locator('option[value="starts-with"]')).toHaveCount(0);
  let cond = (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "if-categories").cond;
  expect(cond.left).toBe("{data.rows.0.categories}");
  expect(cond.op).toBe("has-key");

  await source.click();
  await page.locator(".se-path-direct input").fill("data.rows.0.categories.出展カテゴリ");
  await page.locator(".se-path-direct button").click();
  await expect(operation).toHaveValue("contains");
  await expect(operation.locator('option[value="has-key"]')).toHaveCount(0);
  cond = (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "if-categories").cond;
  expect(cond.left).toBe("{data.rows.0.categories.出展カテゴリ}");

  // 比べる値には、深い比較のため、生のリストの参照も入れられる。
  await operation.selectOption("eq");
  const input = b.locator("input").last();
  await input.focus();
  await input.selectText();
  await input.press("Control+/");
  await expect(picker(page)).toBeVisible();
  await pick(page, "data.rows.0.categories.投票カテゴリ", "if-categories");
  await input.blur();
  cond = (await snapshot(page)).pages.p.pageScripts[0].steps.find((s: any) => s.id === "if-categories").cond;
  expect(cond.op).toBe("eq");
  expect(cond.value).toBe("{data.rows.0.categories.投票カテゴリ}");
});

test("keyboard exploration preserves uncommitted literal and escaped text on cancellation", async ({ page }) => {
  const input = block(page, "value").locator("input:not(.se-in-name)").first();
  await input.fill("001 false \\{literal} {data.name}"); await input.press("Control+/");
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
  await expect(input).toHaveValue("001 false \\{literal} {data.name}"); await input.blur();
  expect(await selected(page)).toBe("001 false \\{literal} {data.name}");
});

test("a newly defined output cannot suggest itself, but a prior producer remains available to update", async ({ page }) => {
  const input = block(page, "value").locator("input:not(.se-in-name)").first();
  await input.fill(""); await input.focus();
  await expect(page.locator(".var-chip").filter({ hasText: /^chosen$/ })).toHaveCount(0);
  await input.press("Control+/");
  await picker(page).getByPlaceholder("変数名・値で検索").fill("chosen");
  await expect(picker(page).locator(".vx-row")).toHaveCount(0);
  await picker(page).getByPlaceholder("変数名・値で検索").press("Escape"); await input.blur();
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps.splice(1, 0, { id: "prior", kind: "set-var", value: "{data.name}", into: "chosen" });
  }));
  await input.focus(); await expect(page.locator(".var-chip").filter({ hasText: /^chosen$/ })).toBeVisible();
  await openPicker(page); await picker(page).getByPlaceholder("変数名・値で検索").fill("chosen");
  await expect(row(page, "{chosen}")).toContainText("Product"); await pick(page, "chosen");
  expect(await selected(page)).toBe("{chosen}");
});

test("raw picker retains a loop object with the same name as its output and shadows the page value", async ({ page }) => {
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    const fetch = doc.pages.p.pageScripts[0].steps[0]; fetch.preview.sample.rows = [{ details: { id: "LOCAL" }, empty: {} }];
    doc.pages.p.pageScripts[0].steps = [fetch,
      { id: "global", kind: "set-var", value: "{data.detail}", into: "details" },
      { id: "each", kind: "for-each", array: "data.rows", then: [{ id: "local-value", kind: "set-var", value: "{details}", into: "details" }] },
    ];
  }));
  await expect(block(page, "local-value").locator(".se-value-info")).toHaveCount(0);
  await expect(block(page, "local-value").locator(".vx-kind")).toHaveCount(0);
  await openPicker(page, "local-value");
  await picker(page).getByPlaceholder("変数名・値で検索").fill("details");
  await expect(row(page, "{details}")).toBeVisible(); await expect(row(page, "{details}")).not.toContainText("Nested");
  await pick(page, "details", "local-value");
  expect((await snapshot(page)).pages.p.pageScripts[0].steps[2].then[0].value).toBe("{details}");
  await openPicker(page, "local-value"); await picker(page).getByPlaceholder("変数名・値で検索").fill("empty");
  await expect(row(page, "{empty}")).toBeVisible();
});


test("inline dropdown selection replaces an existing raw object reference with a raw array reference", async ({ page }) => {
  await openPicker(page); await pick(page, "data");
  const input = block(page, "value").locator("input:not(.se-in-name)").first();
  await input.focus(); await input.press("End"); await input.press("Control+Space");
  await page.locator(".var-comp-list button").filter({ has: page.locator(".var-chip").filter({ hasText: /^data.tags$/ }) }).click();
  await expect(input).toHaveValue("{data.tags}"); await input.blur();
  expect(await selected(page)).toBe("{data.tags}");
  await expect(block(page, "value").locator(".se-value-info")).toContainText("リスト");
});

test("All three script editor hint actions remain on one line at desktop and mobile widths", async ({ page }) => {
  const input = block(page, "value").locator("input:not(.se-in-name)").first();
  for (const width of [1440, 375, 320]) {
    await test.step(`${width}px`, async () => {
      await input.blur();
      await page.setViewportSize({ width, height: 900 });
      await input.focus();
      await expectVariableMenuLayout(page, width, 3);
      await input.press("Escape");
      await expect(page.locator(".var-comp")).toHaveCount(0);
      await input.blur();
      await input.focus();
      await expectVariableMenuLayout(page, width, 3);
      await page.locator(".var-comp-explore").click();
      await expect(picker(page)).toBeVisible();
      await picker(page).getByPlaceholder("変数名・値で検索").press("Escape");
      await expect(picker(page)).toHaveCount(0);
      await expect(input).toHaveValue("Value {data.name}");
    });
  }
});


test("array paths show only their first element but accept the zero-based fourth index", async ({ page }) => {
  await page.evaluate(() => (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
    doc.pages.p.pageScripts[0].steps.push({
      id: "index-path", kind: "transform", source: "data.tags.0", into: "indexed",
      transform: { kind: "field", key: "name" },
    });
  }));
  const blockPicker = block(page, "index-path").getByRole("button", { name: "加工する元の変数" });
  await blockPicker.click();
  const menu = page.locator(".se-pm").filter({ has: page.locator(".se-path-direct") });
  await expect(menu.getByText("1番目", { exact: true })).toBeVisible();
  await expect(menu.getByText("2番目", { exact: true })).toHaveCount(0);
  const manual = menu.locator(".se-path-direct input");
  await expect(manual).toHaveAttribute("placeholder", "添字（0始まり）または位置");
  await manual.fill("3");
  await manual.press("Enter");
  await expect(menu).toBeHidden();
  const doc = await snapshot(page);
  expect(doc.pages.p.pageScripts[0].steps.find((step: any) => step.id === "index-path").source)
    .toBe("data.tags.3");

  await openPicker(page);
  const data = row(page, "{data}");
  await data.locator(".vx-chev").click();
  const tags = row(page, "{data.tags}");
  await tags.locator(".vx-chev").click();
  await expect(row(page, "{data.tags.0}")).toBeVisible();
  await expect(row(page, "{data.tags.1}")).toHaveCount(0);
  await picker(page).getByPlaceholder("変数名・値で検索").fill("data.tags.1");
  await expect(picker(page).locator(".vx-row")).toHaveCount(0);
});

test("canvas transform, condition, and list blocks edit and persist settings", async ({ page }) => {
  const initialDoc = await snapshot(page);
  const reset = async () => {
    await page.evaluate((doc) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      (window as any).dataPickerStore.getState().replaceDoc(structuredClone(doc));
    }, initialDoc);
  };

  await test.step("canvas reads dictionary fields by key", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push(
          { id: "dictionary-key", kind: "transform", source: "data", into: "value",
            transform: { kind: "field", key: "" } },
        );
      });
    });
    const lookup = page.locator('[data-step-id="dictionary-key"]');
    const key = lookup.getByRole("combobox", { name: "取り出す項目名" });
    await expect(key).toHaveAttribute("placeholder", "項目名 / {変数}");
    await key.fill("{selectedDate}");
    await key.blur();
    await expect.poll(() => page.evaluate(() => {
      const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
      return steps.find((step: any) => step.id === "dictionary-key").transform.key;
    })).toBe("{selectedDate}");
  });

  await test.step("canvas processing settings persist changes directly", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "native", kind: "transform", source: "data", into: "chosen",
          transform: { kind: "field", key: "name" },
        });
      });
    });
    const box = page.locator('[data-step-id="native"]');
    await expect(box.getByRole("combobox", { name: "加工の種類" })).toBeVisible();
    await expect(box.getByRole("combobox", { name: "取り出す項目名" })).toHaveCSS("height", "28px");
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

  await test.step("canvas native select and picker button share the same dropdown appearance", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "dropdown-style", kind: "transform", source: "data", into: "chosen",
          transform: { kind: "field", key: "name" },
        });
      });
    });
    const box = page.locator('[data-step-id="dropdown-style"]');
    const pickerButton = box.getByRole("button", { name: "加工する元の変数" });
    const select = box.getByRole("combobox", { name: "加工の種類" });
    await expect(pickerButton).toBeVisible();
    await expect(select).toBeVisible();

    const styles = await Promise.all([pickerButton, select].map((control) =>
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
    expect(styles[0].height).toBe("28px");
    expect(styles[0].appearance).toBe("none");
    expect(styles[0].backgroundImage).toContain("svg");

    const focusedStyle = async (control: typeof pickerButton) => {
      await control.focus();
      return control.evaluate((element) => {
        for (const animation of element.getAnimations()) animation.finish();
        const style = getComputedStyle(element);
        return { borderColor: style.borderTopColor, backgroundColor: style.backgroundColor };
      });
    };
    const focusedPicker = await focusedStyle(pickerButton);
    expect(focusedPicker).toEqual(await focusedStyle(select));
  });

  await test.step("canvas list-display block switches filter, sort and clear without changing the step ID", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "display", kind: "list-display", mode: "filter", array: "data.tags",
          field: "", op: "eq", value: "", dir: "asc",
        });
      });
    });
    const box = page.locator('[data-step-id="display"]');
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
    await page.getByRole("button", { name: "元に戻す", exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
      return steps.find((step: any) => step.id === "display").mode;
    })).toBe("sort");
  });

  await test.step("canvas wait/repeat accept numbers and variables in one field", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push(
          { id: "repeat-count", kind: "repeat", times: 3, then: [] },
          { id: "wait-seconds", kind: "wait", seconds: 0.2 },
        );
      });
    });
    const repeat = page.locator('[data-step-id="repeat-count"]');
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

    const wait = page.locator('[data-step-id="wait-seconds"]');
    await wait.getByPlaceholder("数値 / {変数}").fill("{data.price}");
    await wait.getByPlaceholder("数値 / {変数}").blur();
    await expect.poll(() => page.evaluate(() =>
      (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
        .find((step: any) => step.id === "wait-seconds").seconds)).toBe("{data.price}");
  });

  await test.step("canvas arithmetic accepts values and variables in one field", async () => {
    await reset();
    const box = page.locator('[data-step-id="numeric"]');
    const operand = box.getByPlaceholder("計算する値 / {変数}");
    await operand.fill("{data.price}");
    await operand.blur();
    await expect.poll(() => page.evaluate(() => {
      const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
      return steps.find((step: any) => step.id === "numeric").transform;
    })).toMatchObject({ kind: "math", operandType: "variable", operand: "data.price" });
  });

  await test.step("canvas list sort uses ascending and descending labels", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "sort-labels", kind: "list-display", mode: "sort", array: "data.rows",
          field: "title", op: "eq", value: "", dir: "asc",
        });
      });
    });
    const box = page.locator('[data-step-id="sort-labels"]');
    const direction = box.locator('select:has(option[value="asc"])');
    await expect(direction.locator('option[value="asc"]')).toHaveText("昇順");
    await expect(direction.locator('option[value="desc"]')).toHaveText("降順");
    await direction.selectOption("desc");
    await expect.poll(() => page.evaluate(() => {
      const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
      return steps.find((step: any) => step.id === "sort-labels").dir;
    })).toBe("desc");
  });

  await test.step("canvas fallback uses one text field for text mixed with variables", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "fallback-inline", kind: "transform", source: "data.name", into: "chosen",
          transform: { kind: "fallback", when: "missing", text: "" },
        });
      });
    });
    const box = page.locator('[data-step-id="fallback-inline"]');
    const value = box.getByPlaceholder("代わりに使う値 / {変数}");
    await expect(value).toBeVisible();
    await value.fill("こんにちは、{data.name}さん");
    await value.blur();
    await expect.poll(() => page.evaluate(() => {
      const steps = (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps;
      return steps.find((step: any) => step.id === "fallback-inline").transform.text;
    })).toBe("こんにちは、{data.name}さん");
  });

  await test.step("canvas if blocks add, edit and remove AND/OR conditions on separate rows", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "joined-if", kind: "if",
          cond: { subject: "var", target: "", left: "{data.price}", op: "gte", value: "10" },
          then: [], else: [],
        });
      });
    });
    const box = page.locator('[data-step-id="joined-if"]');
    const actions = box.locator(".se-cond-actions");
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
    const clauseBounds = await box.locator(".se-cond-line").last().boundingBox();
    expect(actionBounds).not.toBeNull();
    expect(clauseBounds).not.toBeNull();
    expect(actionBounds!.y).toBeGreaterThan(clauseBounds!.y);
    await box.getByRole("button", { name: "この条件を削除" }).first().click();
    await expect(connectors).toHaveCount(1);
    await expect(connectors).toHaveValue("and");
    await expect(box.locator(".se-cond-line")).toHaveCount(2);
  });

  await test.step("canvas cross-filter connector only appears when another filter uses the same list", async () => {
    await reset();
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
    const first = page.locator('[data-step-id="filter-a"]');
    const connector = first.getByRole("combobox", { name: "ほかの絞り込みとのつなぎ方" });
    const buttons = first.locator(".se-cond-actions");
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

  await test.step("canvas list filter keeps condition actions on a separate row and lets each connector change", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "filter-conditions", kind: "list-display", mode: "filter",
          array: "data.tags", field: "", op: "eq", value: "red", dir: "asc",
        });
      });
    });
    const box = page.locator('[data-step-id="filter-conditions"]');
    const actions = box.locator(".se-cond-actions");
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

  await test.step("canvas transform menu exposes four groups without explicit text conversion", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "transform-groups", kind: "transform", source: "data.tags", into: "result",
          transform: { kind: "field", key: "" },
        });
      });
    });
    const menu = page.locator('[data-step-id="transform-groups"] select[aria-label="加工の種類"]');
    await expect(menu).toHaveValue("field");
    expect(await menu.locator("optgroup").evaluateAll((groups) =>
      groups.map((group) => ({
        label: (group as HTMLOptGroupElement).label,
        values: [...group.querySelectorAll("option")].map((option) => option.value),
      })))).toEqual([
      { label: "値の取得・補完", values: ["field", "fallback"] },
      { label: "数値・文字列の加工", values: ["math", "split", "replace", "join"] },
      { label: "リストの操作", values: ["length", "sort"] },
      { label: "JSONの変換", values: ["stringify", "parse"] },
    ]);
  });

  await test.step("canvas removal block switches between value and position/key", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        doc.pages.p.pageScripts[0].steps.push({
          id: "remove-entry", kind: "remove-list-item", list: "data.tags",
          mode: "value", value: "",
        });
      });
    });
    const box = page.locator('[data-step-id="remove-entry"]');
    const method = box.getByRole("combobox", { name: "削除方法" });
    await expect(method).toHaveValue("value");
    await method.selectOption("key");
    const input = box.getByPlaceholder("値を入力");
    await input.fill("1");
    await input.blur();
    await expect.poll(() => page.evaluate(() =>
      (window as any).dataPickerStore.getState().doc.pages.p.pageScripts[0].steps
        .find((step: any) => step.id === "remove-entry")
    )).toMatchObject({ kind: "remove-list-item", list: "data.tags", mode: "key", value: "1" });
  });

  await test.step("canvas field picker leaves Japanese composition keys to the IME", async () => {
    await reset();
    await page.evaluate(() => {
      (window as any).dataPickerStore.getState().updateDoc((doc: any) => {
        const steps = doc.pages.p.pageScripts[0].steps;
        steps[0].preview.sample = { 商品名: "りんご", 商品番号: "001" };
        steps.push({ id: "ime-field", kind: "transform", source: "data", into: "picked",
          transform: { kind: "field", key: "" } });
      });
    });
    const key = page.locator('[data-step-id="ime-field"]')
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
});
});

test.describe("English transform menu", () => {
  test.use({ locale: "en-US" });

  test("operation groups, list operations and arithmetic choices use English", async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    const numericBlock = page.locator('[data-step-id="numeric"]');
    const operations = numericBlock.getByRole("combobox", { name: "Operation", exact: true });
    await expect(operations).toHaveValue("math");
    expect(await operations.locator("optgroup").evaluateAll((groups) =>
      groups.map((group) => (group as HTMLOptGroupElement).label)
    )).toEqual(["Extract and fallback", "Number and text operations", "List operations", "JSON conversion"]);
    await expect(operations.locator("option")).toHaveText([
      "Get an item from a list", "Use another value if missing",
      "Calculate a number", "Split text", "Replace text", "Join a list as text",
      "Count list items", "Sort a list", "Convert to JSON text", "Parse JSON text",
    ]);
    await expect(numericBlock.getByRole("combobox", { name: "Arithmetic operation" }).locator("option"))
      .toHaveText(["Add", "Subtract", "Multiply", "Divide", "Remainder"]);
  });
});
