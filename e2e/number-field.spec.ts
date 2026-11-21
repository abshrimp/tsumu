import { test, expect, type Page } from "@playwright/test";
import { inspectorNumberBundle, numberFieldBundle } from "../tests/helpers/number-field";
import { componentListBundle, publishedComponentList } from "../tests/helpers/component-list-export";
import { clientFieldDoc, fieldItems } from "../tests/helpers/client-field-scope";
import { clientImageDoc, imageItems } from "../tests/helpers/client-image-scope";
import { clientLiteralAttributesDoc, literalItems, literalText, literalSource, literalEmbed } from "../tests/helpers/client-literal-attributes";
import { scriptsFile } from "../lib/script-runtime";
import { createInitialDoc, makeField, makeText, makeBox, makeLink } from "../lib/presets";
import { fieldDefaults } from "../lib/fields";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { type SiteDoc } from "../lib/types";

test.describe("number-field", () => {
async function openSite(page: Page) {
  await page.addInitScript(() => localStorage.setItem("tsumu-help-seen-v1", "1"));
  const response = await page.request.post("/api/sites", { data: { name: "Numeric keyboard controls" } });
  expect(response.ok()).toBeTruthy();
  const { site } = await response.json();
  await page.goto(`/sites/${site.id}`);
  await expect(page.locator('[data-tutorial="canvas-width"] input')).toBeVisible();
}

test("Repeated breakpoint arrow-key input stays in sync with width at both limits", async ({ page }) => {
  await openSite(page);
  const input = page.locator('[data-tutorial="canvas-width"] input');
  const frame = page.locator(".canvas-frame");
  await input.fill("800");
  await page.keyboard.press("Enter");
  await input.focus();
  for (const value of [801, 802]) {
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveValue(String(value));
    await expect(input).toBeFocused();
    await expect(frame).toHaveCSS("width", `${value}px`);
  }
  await page.keyboard.press("Shift+ArrowDown");
  await expect(input).toHaveValue("792");
  await expect(input).toBeFocused();
  // ブレークポイントの幅は整数に丸める。フォーカスを失わずに、確定した値を表示する。
  await input.fill("800.5");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("802");
  await expect(input).toBeFocused();
  await expect(frame).toHaveCSS("width", "802px");

  for (const [limit, key, nextKey, next] of [
    [3000, "ArrowUp", "ArrowDown", 2999],
    [240, "ArrowDown", "ArrowUp", 241],
  ] as const) {
    await input.fill(String(limit));
    await page.keyboard.press("Enter");
    await input.focus();
    await page.keyboard.press(key);
    await expect(input).toHaveValue(String(limit));
    await expect(input).toBeFocused();
    await expect(frame).toHaveCSS("width", `${limit}px`);
    await page.keyboard.press(nextKey);
    await expect(input).toHaveValue(String(next));
    await expect(input).toBeFocused();
    await expect(frame).toHaveCSS("width", `${next}px`);
  }
});

test("Numeric style inputs follow Undo, Redo, and node/breakpoint target changes", async ({ page }) => {
  await openSite(page);
  const layers = page.locator('[data-tutorial="layers-panel"]');
  const heading = layers.locator(".layer-name").filter({ hasText: "見出しをここに" });
  await expect(heading).toHaveCount(1);
  await heading.click();
  await page.locator('[data-tutorial="right-tab-style"]').click();
  const font = page.locator('[data-tutorial="style-typography"] .grp')
    .filter({ has: page.locator(".grp-label", { hasText: /^サイズ$/ }) }).locator("input");
  await font.fill("40");
  await page.keyboard.press("Enter");
  await font.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(font).toHaveValue("42");
  await expect(font).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(font).toHaveValue("41");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(font).toHaveValue("42");
  // キャンバスを普通にクリックすると、編集の対象を切り替える前に、保留中の入力を確定する。
  await font.fill("43");
  await page.locator('[data-tutorial="canvas"]').getByText("はじめる", { exact: true }).click();
  await expect(font).not.toHaveValue("43");
  await heading.click();
  await expect(font).toHaveValue("43");
  await font.fill("42");
  await page.keyboard.press("Enter");
  await page.locator('[data-tutorial="breakpoint-sm"]').click();
  await font.fill("80");
  await page.keyboard.press("Enter");
  await page.locator('[data-tutorial="breakpoint-base"]').click();
  await expect(font).toHaveValue("42");
  await page.locator('[data-tutorial="breakpoint-sm"]').click();
  await expect(font).toHaveValue("80");
});

test.describe("Numeric field commits and external updates", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await numberFieldBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator("input")).toHaveValue("100");
  });

  test("Committed values remain visible after Enter, blur, clearing, and unit conversions", async ({ page }) => {
    const input = page.locator("input");
    const stored = page.locator("#stored");
    await input.fill("0012.50");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("12.5");
    await expect(stored).toHaveText("12.5px");
    await expect(input).not.toBeFocused();
    await input.fill("");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("100");
    await expect(stored).toHaveText("100px");
    // 保存された値が変わらない場合も、欄を空にした後に表示を元に戻す。
    await input.fill("");
    await page.locator("#outside").click();
    await expect(input).toHaveValue("100");
    await input.fill("200");
    await page.locator("#outside").click();
    await expect(stored).toHaveText("200px");
    await page.locator(".field-unit").click();
    await expect(input).toHaveValue("12.5");
    await expect(stored).toHaveText("12.5rem");
    await input.focus();
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveValue("13.5");
    await expect(stored).toHaveText("13.5rem");
    await expect(input).toBeFocused();
  });

  test("External changes preserve draft text, and IME arrow/Enter keys do not edit numbers", async ({ page }) => {
    const input = page.locator("input");
    const stored = page.locator("#stored");
    await input.focus();
    await page.evaluate(() => (window as any).setNumberFieldValue("600px"));
    await expect(input).toHaveValue("600");
    await input.fill("42");
    await page.evaluate(() => (window as any).setNumberFieldValue("700px"));
    await expect(input).toHaveValue("42");
    await expect(input).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(stored).toHaveText("42px");
    await input.fill("12");
    for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
      await input.dispatchEvent("keydown", { key: "ArrowUp", ...composing });
      await input.dispatchEvent("keydown", { key: "Enter", ...composing });
      await expect(input).toHaveValue("12");
      await expect(input).toBeFocused();
      await expect(stored).toHaveText("42px");
    }
    await page.keyboard.press("Enter");
    await expect(stored).toHaveText("12px");
  });
});


test.describe("Numeric field target changes", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await inspectorNumberBundle(); });
  for (const target of ["node", "same-value-node", "breakpoint", "state", "selection"] as const) {
    test(`Changing ${target} before blur never commits an unfinished number to a different target`, async ({ page }) => {
      await page.setContent('<html><body><div id="app"></div></body></html>');
      await page.addScriptTag({ content: bundle });
      const font = page.locator('[data-tutorial="style-typography"] .grp')
        .filter({ has: page.locator(".grp-label", { hasText: /^サイズ$/ }) }).locator("input");
      await expect(font).toHaveValue("40");
      if (target === "same-value-node") {
        await page.evaluate(() => (window as any).numericInspector.getState().setStyleProps("b", { fontSize: "40px" }));
      }
      const before = await page.evaluate(() => (window as any).numericInspector.getState().doc.nodes);
      await font.fill("77");
      await font.evaluate((input) => { (window as any).oldNumericInput = input; });
      // pointerdown や blur 無しで状態が変わっても、下書きをその対象に結び付けたまま保つ。
      await page.evaluate((target) => {
        const state = (window as any).numericInspector.getState();
        if (target === "node" || target === "same-value-node") state.select("b");
        else if (target === "breakpoint") state.setBreakpoint("sm");
        else if (target === "state") state.setStyleState("hover");
        else state.selectMany(["a", "b"], "a");
      }, target);
      const shown = target === "node" || target === "breakpoint" ? "20" : target === "state" ? "30" : "40";
      await expect(font).toHaveValue(shown);
      expect(await page.evaluate(() => (window as any).oldNumericInput.isConnected)).toBe(false);
      await font.focus();
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => (window as any).numericInspector.getState().doc.nodes)).toEqual(before);
      // 対象を切り替えた後も、同じ欄で数値を続けて入力できる。
      await font.focus();
      await page.keyboard.press("ArrowUp");
      await expect(font).toHaveValue(String(Number(shown) + 1));
      await expect(font).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(font).toHaveValue(String(Number(shown) + 2));
      await expect(font).toBeFocused();
    });
  }
});
});

test.describe("client-field-scope", () => {
const snapshot = (page: Page) => page.evaluate(() => {
  const { doc, past, future } = (window as any).componentListStore.getState(); return { doc, past, future };
});
const fields = (page: Page, id: string) => page.locator('#' + id).filter({ visible: true });
async function checkFields(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    for (const id of ['entry', 'memo', 'choice']) {
      await expect(fields(page, id)).toHaveCount(2);
      await expect(fields(page, id).nth(0)).toHaveValue('Edit First');
      await expect(fields(page, id).nth(1)).toHaveValue('Edit Second');
    }
    await expect(fields(page, 'entry').nth(1)).toHaveAttribute('placeholder', 'Find Second');
  }
}

test(`component field edits retain row defaults through preview, undo, save and generated navigation`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: fieldItems } }));
  await page.goto('/robots.txt'); await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  const doc = clientFieldDoc(true); doc.nodes.entry.field!.defaultValue = 'Before';
  await page.addScriptTag({ content: await componentListBundle(doc, 'entry') });
  const input = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^初期値$/ }) }).locator('input');
  const before = await snapshot(page); await expect(input).toHaveValue('Before');
  await input.fill('Edit {name}'); await input.press('Tab'); const saved = await snapshot(page);
  expect(saved.doc.nodes.entry.field.defaultValue).toBe('Edit {name}');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click(); const reloaded = await snapshot(page);
  await page.getByRole('button', { name: 'Toggle preview', exact: true }).click(); await checkFields(page); expect(await snapshot(page)).toEqual(reloaded);
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', fieldItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) }); await checkFields(page);
  const reset = await fields(page, 'memo').nth(1).evaluate((el: HTMLTextAreaElement) => {
    const value = el.value, initial = el.defaultValue, form = document.createElement('form');
    const clone = el.cloneNode(true) as HTMLTextAreaElement; form.append(clone); clone.value = 'Typed'; form.reset();
    return { value, initial, reset: clone.value };
  });
  expect(reset).toEqual({ value: 'Edit Second', initial: 'Edit Second', reset: 'Edit Second' });
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await page.evaluate(content => { document.body.innerHTML = content; }, html); await checkFields(page); expect(errors).toEqual([]);
});

test('native generated fields preserve typed values and normalize row-specific ranges', async ({ page }) => {
  const doc = clientFieldDoc();
  const items = [{ name: 'First', lower: '1', upper: '9', step: '2', number: '7', largeMin: '100', largeMax: '200', tags: [{}] }, { name: 'Second', lower: '2', upper: '8', step: '2', number: '6', largeMin: '200', largeMax: '400', tags: [{}] }];
  (doc.pages.p.pageScripts![0].steps[0] as any).sample = items;
  doc.nodes.memo.field!.defaultValue = '{name}: {live}'; doc.nodes.memo.field!.placeholder = '{name}: {live}';
  doc.nodes.entry.field = { kind: 'input', inputType: 'range', min: '{lower}', max: '{upper}', step: '{step}', defaultValue: '{number}' };
  for (const [id, value] of [['staticRange', '150'], ['emptyRange', undefined]]) {
    doc.nodes[id!] = { ...makeText(''), id: id!, attrId: id!, type: 'field', text: null, field: {
      kind: 'input', inputType: 'range', min: '{largeMin}', max: '{largeMax}', step: '10', defaultValue: value,
    } }; doc.nodes.row.children.push(id!);
  }
  doc.nodes.change = { ...makeText('Change live'), id: 'change', attrId: 'change', semantic: 'button', scripts: [{ id: 'change-script', trigger: 'click', steps: [
    { id: 'change-live', kind: 'set-var', into: 'live', value: 'Later \\{name}' },
  ] }] }; doc.pages.p.children.unshift('change');
  await page.goto('/robots.txt');
  await page.setContent(await publishedComponentList(doc, 'app/page.tsx', items)); await page.addScriptTag({ content: scriptsFile(doc) });
  await page.getByRole('button', { name: 'Load items', exact: true }).click();
  await expect(fields(page, 'entry').nth(0)).toHaveValue('7'); await expect(fields(page, 'entry').nth(1)).toHaveValue('6');
  await expect(fields(page, 'staticRange').nth(0)).toHaveValue('150'); await expect(fields(page, 'staticRange').nth(1)).toHaveValue('200');
  await expect(fields(page, 'emptyRange').nth(0)).toHaveValue('150'); await expect(fields(page, 'emptyRange').nth(1)).toHaveValue('300');
  await fields(page, 'memo').nth(1).fill('Typed');
  await page.getByRole('button', { name: 'Change live', exact: true }).click();
  await expect(fields(page, 'memo').nth(0)).toHaveValue('First: Later {name}');
  await expect(fields(page, 'memo').nth(1)).toHaveValue('Typed');
  await expect(fields(page, 'memo').nth(1)).toHaveAttribute('placeholder', 'Second: Later {name}');
});

test('radio preview defaults match the browser last checked selection', async ({ page }) => {
  const doc = createInitialDoc();
  const radioFields = [
    { id: 'first', label: 'First', checked: true },
    { id: 'second', label: 'Second', checked: true },
    { id: 'third', label: 'Unchecked', checked: false },
  ].map(({ id, label, checked }) => ({
    ...makeField('radio'), id, attrId: id,
    field: { kind: 'radio' as const, group: 'choice', label, checked },
  }));
  doc.nodes = Object.fromEntries(radioFields.map(node => [node.id, node]));
  doc.pages[doc.pageOrder[0]].children = radioFields.map(node => node.id);
  const expected = fieldDefaults(radioFields).choice;
  expect(expected).toBe('Second');
  await page.setContent(await publishedComponentList(doc));
  const radios = page.locator('input[type="radio"][name="choice"]');
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).not.toBeChecked();
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(2)).not.toBeChecked();
  await expect(page.locator('input[name="choice"]:checked')).toHaveValue(expected);
});

const pictures = (page: Page) => page.locator('img[alt="Row image"]').filter({ visible: true });
async function checkImages(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    await expect(pictures(page)).toHaveCount(2);
    await expect(pictures(page).nth(0)).toHaveAttribute('src', '/images/First.png');
    await expect(pictures(page).nth(1)).toHaveAttribute('src', '/images/Second.png');
  }
}

test(`component image URL edits preserve row scope through preview, save and export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: imageItems } }));
  await page.route('**/images/*.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(clientImageDoc(true, '/images/before.png'), 'picture') });
  const input = page.locator('aside [data-tutorial="settings-image"] .row').filter({ has: page.locator('label', { hasText: /^URL$/ }) }).locator('input');
  await expect(input).toHaveValue('/images/before.png');
  const before = await snapshot(page);
  await input.fill('/images/{name}.png'); await input.press('Tab');
  const saved = await snapshot(page);
  expect(saved.doc.nodes.picture.image.src).toBe('/images/{name}.png');
  expect(saved.past.length).toBeGreaterThan(before.past.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  const reloaded = await snapshot(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
    await checkImages(page); expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  }
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', imageItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await checkImages(page);
  await expect(pictures(page).nth(0)).not.toHaveAttribute('srcset');
  await expect(pictures(page).nth(1)).not.toHaveAttribute('srcset');
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(pictures(page)).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await checkImages(page); expect(errors).toEqual([]);
});

async function checkLiterals(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Load items', exact: true }).click();
    for (const [selector, attribute, value] of [
      ['img#picture', 'alt', literalText], ['#audio', 'src', literalSource],
      ['#video', 'src', literalSource], ['#frame iframe', 'src', literalEmbed],
    ]) {
      const nodes = page.locator(selector).filter({ visible: true });
      await expect(nodes).toHaveCount(3);
      for (const node of await nodes.all()) await expect(node).toHaveAttribute(attribute, value);
    }
  }
}

test(`component literal attributes persist through editor save, preview and export`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/fetch-json', route => route.fulfill({ json: { json: literalItems } }));
  await page.route('https://example.com/**', route => route.fulfill({ body: '' }));
  const doc = clientLiteralAttributesDoc(true); doc.nodes.picture.image!.alt = 'Before';
  await page.goto('/robots.txt');
  await page.setContent('<html><body><div id="app" style="width:1000px;height:800px"></div></body></html>');
  await page.addScriptTag({ content: await componentListBundle(doc, 'picture') });
  // 変更は、実際の設定のパネルから行う。
  const altInput = page.locator('aside .row').filter({ has: page.locator('label', { hasText: /^(代替テキスト|Alt text)$/ }) }).locator('input');
  await expect(altInput).toHaveValue('Before');
  const before = await snapshot(page);
  await altInput.fill(literalText); await altInput.press('Tab');
  const saved = await snapshot(page);
  expect(saved.doc.nodes.picture.image.alt).toBe(literalText);
  expect(saved.past.length).toBeGreaterThan(before.past.length);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(before.doc);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await snapshot(page)).doc).toEqual(saved.doc);
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  const reloaded = await snapshot(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
    await checkLiterals(page); expect(await snapshot(page)).toEqual(reloaded);
    await page.getByRole('button', { name: 'Toggle preview', exact: true }).click();
  }
  const html = await publishedComponentList(saved.doc, 'app/page.tsx', literalItems);
  await page.setContent(html); await page.addScriptTag({ content: scriptsFile(saved.doc) });
  await checkLiterals(page);
  const svgs = page.locator('#svg img').filter({ visible: true });
  await expect(svgs).toHaveCount(3);
  for (const svg of await svgs.all()) await expect(svg).toHaveAttribute('alt', literalText);
  await page.evaluate(() => { document.body.innerHTML = '<span data-page-body="other"></span>'; });
  await expect(page.locator('#picture')).toHaveCount(0);
  await page.evaluate(content => { document.body.innerHTML = content; }, html);
  await checkLiterals(page); expect(errors).toEqual([]);
});
});

test.describe("html-data-export", () => {
test("standalone HTML query variants display the default page without JavaScript", async ({ browser }) => {
  const fallback = { ...makeBox(), id: "nojs-default",
    text: { content: "Default content without JavaScript", heading: 1 } };
  const alternate = { ...makeBox(), id: "nojs-alternate",
    text: { content: "JavaScript-only variant", heading: 1 } };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "No-script fallback", assets: {},
    pageOrder: ["alternate", "default"],
    pages: {
      alternate: { id: "alternate", name: "Alternate", title: "Alternate",
        description: "", slug: "", query: "view=alternate", children: ["nojs-alternate"] },
      default: { id: "default", name: "Default", title: "Default",
        description: "", slug: "", children: ["nojs-default"] },
    },
    nodes: { "nojs-default": fallback, "nojs-alternate": alternate },
  };
  const { files } = generateExportProject(doc, "html");
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noScriptPage = await context.newPage();
    await noScriptPage.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/+/, "") || "index.html";
      const source = files[path];
      await route.fulfill({
        status: source === undefined ? 404 : 200,
        contentType: path.endsWith(".html") ? "text/html" :
          path.endsWith(".css") ? "text/css" : "text/javascript",
        body: source ?? "",
      });
    });
    await noScriptPage.goto("http://nojs.export.test/?view=alternate");
    await expect(noScriptPage.getByRole("heading", { name: "Default content without JavaScript" })).toBeVisible();
    await expect(noScriptPage.getByText("JavaScript-only variant")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("standalone HTML selects query-variant pages before loading their data", async ({ page }) => {
  const defaultNode = { ...makeBox(), id: "default-heading", text: { content: "Default page", heading: 1 } };
  const specialNode = { ...makeBox(), id: "special-heading", text: { content: "Query-specific page", heading: 1 } };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Query variants",
    pages: {
      default: { id: "default", name: "Default", slug: "", title: "Default", description: "",
        children: ["default-heading"] },
      special: { id: "special", name: "Special", slug: "", title: "Special", description: "Details for this view", noindex: true,
        query: "tab=2", children: ["special-heading"],
        pageScripts: [{
          id: "load", trigger: "load", steps: [
            { id: "fetch", kind: "fetch", url: "/__query_probe__/items.json?tab={tab}", as: "items" },
            { id: "count", kind: "transform", source: "items", into: "count", transform: { kind: "length" } },
          ],
        }],
      },
    },
    pageOrder: ["default", "special"],
    nodes: { "default-heading": defaultNode, "special-heading": specialNode },
    assets: {},
  };
  const output = generateExportProject(doc, "html");
  await page.route("**/__query_probe__/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace("/__query_probe__/", "");
    if (pathname === "items.json") {
      await route.fulfill({ contentType: "application/json", body: '[{"id":1},{"id":2}]' });
      return;
    }
    const data = output.files[pathname];
    await route.fulfill({
      status: data ? 200 : 404,
      contentType: pathname.endsWith(".html") ? "text/html" :
        pathname.endsWith(".js") ? "text/javascript" : "text/css",
      body: data ?? "",
    });
  });
  await page.goto("/__query_probe__/index.html?tab=2");
  await expect(page.locator("[data-variant-root]")).toContainText("Query-specific page");
  await expect(page.locator("[data-page-body]")).toHaveAttribute("data-page-body", "special");
  await expect(page).toHaveTitle("Special");
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", "Details for this view");
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.goto("/__query_probe__/index.html?tab=3");
  await expect(page.locator("[data-variant-root]")).toContainText("Default page");
  await expect(page.locator("[data-page-body]")).toHaveAttribute("data-page-body", "default");
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
});

/** 生成した HTML・JSON の読み込み・DOM のランタイムを、実際の Chromium で動かす。 */
test("standalone HTML fetches JSON, executes transform and condition blocks, and renders live text and list rows", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Composable HTML data",
    pageOrder: ["home"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Composable", description: "",
        children: ["count", "list"],
        pageScripts: [{
          id: "load", trigger: "load", steps: [
            { id: "fetch", kind: "fetch", url: "/__transform_probe__/items.json", as: "items" },
            { id: "length", kind: "transform", source: "items", into: "total",
              transform: { kind: "length" } },
            { id: "condition", kind: "if",
              cond: { subject: "var", left: "{total}", op: "gte", value: "2" },
              then: [{ id: "yes", kind: "set-var", into: "state", value: "ready" }],
              else: [{ id: "no", kind: "set-var", into: "state", value: "missing" }],
            },
          ],
        }] as unknown as NonNullable<SiteDoc["pages"][string]["pageScripts"]>,
      },
    },
    nodes: {
      count: { ...makeBox(), id: "count", attrId: "data-status",
        text: { heading: 1, content: "Found {total} items: {state}" } },
      list: { ...makeBox(), id: "list", type: "list", list: { from: "items" }, children: ["item"] },
      item: { ...makeBox(), id: "item", text: { heading: 0, content: "{name}" } },
    },
    assets: {},
  };
  const output = generateExportProject(doc, "html");
  const prefix = "/__transform_probe__/";
  await page.route("**/__transform_probe__/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.slice(prefix.length);
    if (pathname === "items.json") {
      await route.fulfill({ contentType: "application/json",
        body: JSON.stringify([{ name: "Alpha" }, { name: "Beta" }]) });
      return;
    }
    const content = output.files[pathname];
    await route.fulfill({ status: content === undefined ? 404 : 200,
      contentType: pathname.endsWith(".html") ? "text/html" :
        pathname.endsWith(".css") ? "text/css" : "text/javascript",
      body: content ?? "Not Found" });
  });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/__transform_probe__/index.html");
  await expect(page.locator("#data-status")).toHaveText("Found 2 items: ready");
  await expect(page.locator("[data-client-list] [data-row]")).toHaveCount(2);
  await expect(page.locator("[data-client-list] [data-row]").first()).toContainText("Alpha");
  await expect(page.locator("[data-client-list] [data-row]").last()).toContainText("Beta");
  // HTML のページに、バンドラーのソースやエディタの署名を含めてはならない。
  expect(output.files["package.json"]).toBeUndefined();
  expect(output.files["index.html"]).not.toMatch(/tsumu/i);
  expect(errors).toEqual([]);
});

test("standalone HTML uses form and query operands and clears missing transform output", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Dynamic operands", pageOrder: ["home"],
    pages: { home: {
      id: "home", name: "Home", slug: "", title: "Home", description: "",
      children: ["rate", "shadow", "button", "result"],
      pageScripts: [{
        id: "load", trigger: "load", steps: [{ id: "records", kind: "fetch", as: "records",
          url: "/__operand_probe__/records.json" }],
      }],
    }},
    nodes: {
      rate: { ...makeBox(), id: "rate", type: "field", attrId: "rate",
        field: { kind: "input", inputType: "number", defaultValue: "7", placeholder: "Rate" } },
      shadow: { ...makeBox(), id: "shadow", type: "field", attrId: "chosen",
        field: { kind: "input", inputType: "text", defaultValue: "field-shadow", placeholder: "Shadow" } },
      button: { ...makeBox(), id: "button", semantic: "button",
        text: { content: "Calculate", heading: 0 },
        scripts: [{ id: "calculate", trigger: "click", steps: [
          { id: "base", kind: "set-var", into: "base", value: "4" },
          { id: "mul", kind: "transform", source: "base", into: "scaled",
            transform: { kind: "math", operation: "multiply",
              operand: "rate", operandType: "variable" } },
          { id: "add", kind: "transform", source: "scaled", into: "total",
            transform: { kind: "math", operation: "add",
              operand: "extra", operandType: "variable" } },
          { id: "old", kind: "set-var", into: "chosen", value: "stale" },
          { id: "missing", kind: "transform", source: "records.0", into: "chosen",
            transform: { kind: "field", key: "absent" } },
          { id: "fallback", kind: "transform", source: "chosen", into: "chosen",
            transform: { kind: "fallback", when: "missing", text: "not found" } },
          { id: "conditional", kind: "if",
            cond: { subject: "var", left: "{total}", op: "gte", value: "31" },
            conditions: [{ subject: "var", left: "", op: "eq", value: "", not: true, and: true }],
            then: [{ id: "pass", kind: "set-var", into: "check", value: "pass" }],
            else: [{ id: "fail", kind: "set-var", into: "check", value: "fail" }] },
          { id: "missing-target-if", kind: "if",
            cond: { subject: "visible", target: "no-such-element", not: true },
            then: [{ id: "incorrect", kind: "set-var", into: "visibility", value: "incorrect" }],
            else: [{ id: "correct", kind: "set-var", into: "visibility", value: "safe" }] },
          { id: "or-with-empty", kind: "if",
            cond: { subject: "var", left: "{total}", op: "gte", value: "100" },
            conditions: [
              { subject: "var", left: "", op: "eq", value: "", and: false },
              { subject: "var", left: "{total}", op: "eq", value: "31", and: true },
            ],
            then: [{ id: "or-ok", kind: "set-var", into: "joined", value: "accepted" }],
            else: [{ id: "or-no", kind: "set-var", into: "joined", value: "rejected" }] },
        ] }] as unknown as NonNullable<SiteDoc["nodes"][string]["scripts"]>,
      },
      result: { ...makeBox(), id: "result", attrId: "result",
        text: { content: "Total: {total} / {chosen} / {check} / {visibility} / {joined}", heading: 0 } },
    },
    assets: {},
  };
  const files = generateExportProject(doc, "html").files;
  await page.route("**/__operand_probe__/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice("/__operand_probe__/".length);
    if (path === "records.json") {
      await route.fulfill({ contentType: "application/json", body: '[{"name":"first"}]' });
      return;
    }
    const text = files[path];
    await route.fulfill({ status: text === undefined ? 404 : 200,
      contentType: path.endsWith(".html") ? "text/html" :
        path.endsWith(".css") ? "text/css" : "text/javascript", body: text ?? "Not Found" });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/__operand_probe__/index.html?extra=3&chosen=query-shadow");
  await page.locator("#rate").fill("7");
  const compiled = await page.getByRole("button", { name: "Calculate" }).getAttribute("data-scripts");
  const steps = (JSON.parse(compiled || "[]") as { steps: { kind: string; cond?: unknown; conditions?: unknown[] }[] }[])
    .flatMap((script) => script.steps);
  const grouped = steps.filter((step) => step.kind === "if" && step.conditions?.length === 2);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].conditions).toMatchObject([
    { subject: "var", left: "", and: false },
    { subject: "var", op: "eq", value: "31", and: true },
  ]);
  const secondCondition = grouped[0].conditions![1] as { left: { inputRef: string } };
  expect(secondCondition.left.inputRef).toMatch(/^[a-zA-Z0-9_]+$/);
  expect(grouped[0].cond).toMatchObject({ left: secondCondition.left });
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.locator("#result")).toHaveText("Total: 31 / not found / pass / safe / accepted");
  expect(errors).toEqual([]);
});

/** 監査 F: 実際の単一ファイルの HTML の書き出し全体を、Chromium で動かす。 */
test("single HTML executes page-load scripts and renders dynamic variables without external files", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Standalone runtime",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", slug: "", name: "Home", title: "Standalone", description: "",
        children: ["status"],
        pageScripts: [{
          id: "load", trigger: "load", steps: [{ id: "assign", kind: "set-var", into: "status", value: "ready" }],
        }],
      },
    },
    nodes: {
      status: { ...makeBox(), id: "status", text: { heading: 1, content: "Status: {status}" } },
    },
    assets: {},
  };
  const project = await prepareExportProject(doc, {
    framework: "single-html", language: "javascript", style: "css", scope: "project",
  });
  expect(Object.keys(project.files)).toEqual(["index.html"]);
  expect(Object.keys(project.binaries)).toEqual([]);
  expect(Object.keys(project.remoteAssets)).toEqual([]);
  const html = project.files["index.html"];
  expect(html).toContain("Status:");

  const errors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "single.export.test" && url.pathname === "/") {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    unexpectedRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto("http://single.export.test/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Status: ready" })).toBeVisible();
  const initialized = await page.evaluate(async () =>
    typeof (await (window as any).__pageDataReady) === "object");
  expect(initialized).toBe(true);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("standalone HTML query variants preserve authored async and defer script timing", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Async/defer variant", assets: {}, pageOrder: ["base", "special"],
    pages: {
      base: { id: "base", name: "Base", slug: "", title: "Base",
        description: "", children: [] },
      special: { id: "special", name: "Special", slug: "", query: "variant=timing",
        title: "Special", description: "", children: [],
        customTopHtml: '<script>window.__variantOrder = [];</script>' +
          '<script defer src="/timing/defer.js"></script>' +
          '<script>window.__variantOrder.push("inline-after-defer");</script>' +
          '<script async src="/timing/async.js"></script>' +
          '<script>window.__variantOrder.push("inline-after-async");</script>',
      },
    },
    nodes: {},
  };
  const files = generateExportProject(doc, "html").files;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/+/, "") || "index.html";
    if (path === "timing/defer.js" || path === "timing/async.js") {
      await new Promise(resolve => setTimeout(resolve, path === "timing/async.js" ? 100 : 40));
      await route.fulfill({ contentType: "application/javascript",
        body: 'window.__variantOrder.push("' + (path === "timing/defer.js" ? "defer" : "async") + '");' });
      return;
    }
    const source = files[path];
    await route.fulfill({ status: source === undefined ? 404 : 200,
      contentType: path.endsWith(".html") ? "text/html" :
        path.endsWith(".css") ? "text/css" : "application/javascript",
      body: source ?? "" });
  });
  await page.goto("http://timing.export.test/?variant=timing", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Array.isArray((window as any).__variantOrder) &&
    (window as any).__variantOrder.includes("async"));
  const order = await page.evaluate(() => (window as any).__variantOrder as string[]);
  expect(order).toEqual(["inline-after-defer", "inline-after-async", "defer", "async"]);
  expect(errors).toEqual([]);
});

test("generated HTML query variants execute authored scripts and initialize page data in order", async ({ page }) => {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Static variant",
    pageOrder: ["default", "selected"],
    pages: {
      default: { id: "default", slug: "", name: "Default", title: "Default",
        description: "", children: ["defaultText"] },
      selected: {
        id: "selected", slug: "", query: "tab=2&tab=ignored", name: "Selected", title: "Selected",
        description: "", children: ["selectedText"],
        customTopHtml: '<script src="https://assets.export.test/first.js"></script>' +
          '<script>window.__authorOrder = window.__externalReady ? "correct" : "early";</script>',
        customEndHtml: '<script>window.__endScriptRan = true;</script>',
        pageScripts: [{
          id: "load", trigger: "load", steps: [{ id: "assign", kind: "set-var", into: "status", value: "ready" }],
        }],
      },
    },
    nodes: {
      defaultText: { ...makeBox(), id: "defaultText", text: { content: "Fallback page", heading: 1 } },
      selectedText: { ...makeBox(), id: "selectedText", text: { content: "State: {status}", heading: 1 } },
    },
    assets: {},
  };
  const { files } = generateExportProject(doc, "html");
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "assets.export.test" && url.pathname === "/first.js") {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await route.fulfill({ status: 200, contentType: "application/javascript",
        body: "window.__externalReady = true;" });
      return;
    }
    if (url.hostname !== "static.export.test") {
      await route.fulfill({ status: 404, body: "Unexpected domain" });
      return;
    }
    const path = url.pathname.replace(/^\/+/, "") || "index.html";
    const source = files[path];
    await route.fulfill(source === undefined
      ? { status: 404, body: "Not found: " + path }
      : { status: 200, contentType: path.endsWith(".js")
        ? "application/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
        body: source });
  });
  await page.goto("http://static.export.test/?tab=2&tab=ignored", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "State: ready" })).toBeVisible();
  const results = await page.evaluate(async () => ({
    order: (window as any).__authorOrder,
    end: (window as any).__endScriptRan,
    pageDataInitialized: typeof (await (window as any).__pageDataReady) === "object",
    activePlanCount: document.querySelectorAll("script[data-page-plan]").length,
  }));
  expect(results).toEqual({ order: "correct", end: true, pageDataInitialized: true, activePlanCount: 1 });
  expect(failures).toEqual([]);
});

// 応答は信頼できない。生成したサイトがページのデータを読み込むとき、取り込んだ文字やリンクが
// 動作する HTML や JavaScript になってはならない。
const securityPrefix = "/__external_json_security__/";
const hostilePayload = [
  {
    name: '<img src=x onerror="globalThis.externalPayloadExecuted=1">',
    link: 'javascript:globalThis.externalPayloadExecuted=2',
  },
  {
    name: '</script><svg onload="globalThis.externalPayloadExecuted=3">',
    link: 'data:text/html,<script>globalThis.externalPayloadExecuted=4</script>',
  },
  {
    name: 'Safe <&> "quoted" 日本語',
    link: 'https://example.com/path?q=1',
  },
  {
    name: "{constructor} {__proto__} should remain literal text",
    link: '//malicious.example/landing',
  },
];

function securityFixture(): SiteDoc {
  const text = { ...makeText("{name}"), id: "row-title", attrId: "row-title" };
  const link = {
    ...makeLink("Open {name}"), id: "row-link", attrId: "row-link",
    link: { kind: "url" as const, url: "{link}" },
  };
  const list = {
    ...makeText(""), id: "rows", type: "list" as const,
    text: null, list: { from: "items" }, children: ["row-title", "row-link"],
  };
  return {
    schemaVersion: 1, siteName: "External JSON security fixture",
    pageOrder: ["home"],
    pages: { home: {
      id: "home", name: "Home", title: "Home", slug: "",
      description: "", children: ["rows"],
      pageScripts: [{
        id: "fetch-items", trigger: "load", steps: [{ id: "fetch", kind: "fetch", url: securityPrefix + "items.json", as: "items" }],
      }],
    }},
    nodes: { "row-title": text, "row-link": link, rows: list },
    assets: {},
  };
}

for (const format of ["html", "single-html"] as const) {
  test(`${format} treats hostile external JSON as text and prevents active link injection`, async ({ page }) => {
    const doc = securityFixture();
    const original = generateExportProject(doc, "html");
    const project = format === "single-html" ? await toSingleHtmlProject(original) : original;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const requests: string[] = [];
    await page.route("**/__external_json_security__/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.slice(securityPrefix.length);
      requests.push(path);
      if (path === "items.json") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(hostilePayload) });
      }
      const data = project.files[path];
      if (data === undefined) return route.fulfill({ status: 404, body: "Not Found" });
      const mime = path.endsWith(".html") ? "text/html" :
        path.endsWith(".css") ? "text/css" :
        path.endsWith(".js") ? "text/javascript" : "text/plain";
      return route.fulfill({ contentType: mime, body: data });
    });
    await page.goto(securityPrefix + "index.html?__proto__=inert&constructor=inert");
    const rows = page.locator("[data-client-list] [data-row]");
    await expect(rows).toHaveCount(hostilePayload.length);
    for (let i = 0; i < hostilePayload.length; i++) {
      await expect(rows.nth(i).locator("#row-title")).toHaveText(hostilePayload[i].name);
      await expect(rows.nth(i).locator("#row-link")).toHaveText("Open " + hostilePayload[i].name);
      const href = await rows.nth(i).locator("#row-link").getAttribute("href");
      expect(href).toBeTruthy();
      if (i === 2) {
        expect(href).toBe("https://example.com/path?q=1");
      } else {
        expect(href).not.toMatch(/^(?:javascript|vbscript|data):/i);
        expect(new URL(href!, page.url()).origin).toBe(new URL(page.url()).origin);
      }
      await expect(rows.nth(i).locator("#row-title img, #row-title svg")).toHaveCount(0);
    }
    expect(await page.evaluate(() => (window as any).externalPayloadExecuted)).toBeUndefined();
    expect(await page.evaluate(() => ({} as Record<string, unknown>).inert)).toBeUndefined();
    await rows.nth(0).locator("#row-link").click();
    expect(await page.evaluate(() => (window as any).externalPayloadExecuted)).toBeUndefined();
    expect(requests.filter(path => path === "items.json")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
});
