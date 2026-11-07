import { expect, test, type Page } from "@playwright/test";
import { build } from "../tests/helpers/bundle";
import { resolve } from "node:path";
import { parseColor } from "../components/controls";
import { aspectRatioBundle } from "../tests/helpers/aspect-ratio";
import { transformOriginBundle } from "../tests/helpers/transform-origin";

test.describe("color and fill controls", () => {
  let compiledColorBundle: Promise<string> | undefined;

  async function colorControlBundle(initialColor: string) {
    compiledColorBundle ??= build({
      stdin: { contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { FillControl } from "./components/controls";
        function Fixture() {
          const [value, setValue] = useState(window.__initialColor);
          return <><FillControl value={value} onChange={setValue} /><output>{value}</output></>;
        }
        createRoot(document.getElementById("app")).render(<Fixture />);
      `, resolveDir: resolve("."), loader: "tsx" },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    }).then(result => result.outputFiles[0].text);
    return `window.__initialColor = ${JSON.stringify(initialColor)};\n` + await compiledColorBundle;
  }

  for (const color of ["#1234", "#12345678"]) test(`opacity-only edit preserves ${color} RGB`, async ({ page }) => {
    await page.route("http://color-control.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
    await page.goto("http://color-control.test/");
    await page.addScriptTag({ content: await colorControlBundle(color) });
    const hex = page.locator(".fill-main input");
    await expect(hex).toHaveValue(color.length === 5 ? "112233" : "123456");
    await hex.focus(); await hex.blur();
    await expect(page.locator("output")).toHaveText(color);
    const opacity = page.locator(".fill-alpha input");
    await opacity.fill("50"); await opacity.blur();
    await expect(page.locator("output")).toHaveText(color.length === 5 ? "rgba(17, 34, 51, 0.5)" : "rgba(18, 52, 86, 0.5)");
  });

  test("color picker preserves native CSS named and modern hsl colors", async ({ page }) => {
    for (const [value, hex, alpha] of [
      ["red", "#ff0000", 1],
      ["hsl(120 100% 50% / 0.5)", "#00ff00", 0.5],
    ] as const) {
      expect(await page.evaluate(parseColor, value)).toEqual({ hex, alpha });
    }
  });
});

test.describe("shadow and stacking controls", () => {
  let compiledStylePanelBundle: Promise<string> | undefined;

  async function stylePanelBundle(mode: "shadow" | "z-index") {
    compiledStylePanelBundle ??= build({
      stdin: { contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import StylePanel from "./components/StylePanel";
        import { makeBox, makeSwitch, createInitialDoc } from "./lib/presets";
        import { useEditor } from "./lib/store";
        if (window.__stylePanelMode === "shadow") {
          const preset = makeSwitch();
          const thumb = Object.values(preset.nodes).find(n => n.styles.base?.default?.boxShadow);
          const doc = createInitialDoc(); doc.nodes = { [thumb.id]: thumb };
          doc.pages[doc.pageOrder[0]].children = [thumb.id];
          useEditor.getState().replaceDoc(doc); useEditor.getState().select(thumb.id);
          window.shadowEditor = useEditor; window.thumbId = thumb.id;
          createRoot(document.getElementById("app")).render(<StylePanel nodeId={thumb.id} />);
        } else {
          const node = makeBox(); node.id = "a";
          node.styles = {base:{default:{display:"block",position:"static",width:"100px",height:"100px",backgroundColor:"red"}}};
          const doc = createInitialDoc(); doc.nodes = { a: node };
          doc.pages[doc.pageOrder[0]].children = ["a"];
          useEditor.getState().replaceDoc(doc); useEditor.getState().select("a");
          window.positionEditor = useEditor;
          function Fixture() {
            const style = useEditor(s => s.doc.nodes.a.styles.base.default);
            return <><div id="front" style={style}/><div id="back" style={{position:"relative",zIndex:0,width:100,height:100,marginTop:-100,backgroundColor:"blue"}}/><StylePanel nodeId="a" /></>;
          }
          createRoot(document.getElementById("app")).render(<Fixture />);
        }
      `, resolveDir: resolve("."), loader: "tsx" },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    }).then(result => result.outputFiles[0].text);
    return `window.__stylePanelMode = ${JSON.stringify(mode)};\n` + await compiledStylePanelBundle;
  }

  test("editing the switch thumb shadow preserves its geometry and supports undo", async ({ page }) => {
    await page.route("http://shadow-control.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }));
    await page.goto("http://shadow-control.test/");
    await page.addScriptTag({ content: await stylePanelBundle("shadow") });
    const geometry = page.locator(".fx-card .grid4 input");
    for (const [i, value] of ["0", "1", "2", "0"].entries()) await expect(geometry.nth(i)).toHaveValue(value);
    const color = page.locator(".fx-card .fill-main input");
    await color.fill("123456"); await color.blur();
    const shadow = () => page.evaluate(() => (window as any).shadowEditor.getState().doc.nodes[(window as any).thumbId].styles.base.default.boxShadow);
    await expect.poll(shadow).toBe("0px 1px 2px 0px rgba(18, 52, 86, 0.25)");
    await page.evaluate(() => (window as any).shadowEditor.getState().undo());
    await expect.poll(shadow).toBe("0 1px 2px rgba(0, 0, 0, 0.25)");
  });

  test("front/back controls affect a static block's actual stacking and undo restores it", async ({ page }) => {
    await page.route("http://position-control.test/", route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><div id="app"></div></body>' }));
    await page.goto("http://position-control.test/");
    await page.addScriptTag({ content: await stylePanelBundle("z-index") });
    const top = () => page.evaluate(() => document.elementFromPoint(50, 50)?.id);
    await expect.poll(top).toBe("back");
    await page.locator(".z-ctl button").last().click();
    await expect.poll(top).toBe("front");
    await expect(page.locator("#front")).toHaveCSS("position", "relative");
    await page.evaluate(() => (window as any).positionEditor.getState().undo());
    await expect.poll(top).toBe("back");
    await expect(page.locator("#front")).toHaveCSS("position", "static");
  });
});

test.describe("transform origin", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await transformOriginBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await expect(page.locator('.origin-grid [data-tip="左上"]')).toHaveAttribute("aria-checked", "true");
  });

  const node = (page: Page, id = "a") => page.locator(`.cv-root [data-node="${id}"]`);
  const center = (page: Page) => page.locator('.origin-grid [data-tip="中央"]');
  const reset = (page: Page) => page.locator(".grp-label").filter({ hasText: /^基準点$/ }).click({ button: "right" });

  for (const [bp, state, inherited, resetValue] of [
    ["sm", "default", "0px 0px", "0px 0px"],
    ["base", "hover", "0px 100px", "0px 0px"],
    ["sm", "hover", "0px 100px", "0px 100px"],
  ] as const) {
    test(`${bp}/${state}: the center origin survives reset, Undo, Redo, and inheritance`, async ({ page }) => {
      await page.evaluate(({ bp, state }) => {
        const s = (window as any).originEditor.getState();
        s.setBreakpoint(bp); s.setStyleState(state);
      }, { bp, state });
      await expect(node(page)).toHaveCSS("transform-origin", inherited);
      const before = await page.evaluate(() => (window as any).originEditor.getState().doc);
      await center(page).click();
      await expect(center(page)).toHaveAttribute("aria-checked", "true");
      await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
      expect(await page.evaluate(({ bp, state }) => (window as any).originEditor.getState().doc.nodes.a.styles[bp][state].transformOrigin, { bp, state })).toBe("center");
      const changed = await page.evaluate(() => (window as any).originEditor.getState().doc);
      await page.evaluate(() => (window as any).originEditor.getState().undo());
      await expect(node(page)).toHaveCSS("transform-origin", inherited);
      expect(await page.evaluate(() => (window as any).originEditor.getState().doc)).toEqual(before);
      await page.evaluate(() => (window as any).originEditor.getState().redo());
      await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
      expect(await page.evaluate(() => (window as any).originEditor.getState().doc)).toEqual(changed);
      // 同じマスをもう一度選んでも、原点は解除されず、そのまま残る。
      const history = await page.evaluate(() => (window as any).originEditor.getState().past.length);
      await center(page).click();
      await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
      expect(await page.evaluate(() => (window as any).originEditor.getState().past.length)).toBe(history);
      await reset(page);
      await expect(node(page)).toHaveCSS("transform-origin", resetValue);
      expect(await page.evaluate(({ bp, state }) => (window as any).originEditor.getState().doc.nodes.a.styles[bp][state].transformOrigin, { bp, state })).toBeUndefined();
      await page.evaluate(() => (window as any).originEditor.getState().undo());
      await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
      await page.evaluate(() => (window as any).originEditor.getState().redo());
      await expect(node(page)).toHaveCSS("transform-origin", resetValue);
    });
  }

  test("Setting center origin for multiple nodes preserves their individually inherited larger-breakpoint values", async ({ page }) => {
    await page.evaluate(() => {
      const s = (window as any).originEditor.getState();
      s.setBreakpoint("sm"); s.selectMany(["a", "b"], "a");
    });
    const before = await page.evaluate(() => (window as any).originEditor.getState().doc);
    await center(page).click();
    for (const id of ["a", "b"]) await expect(node(page, id)).toHaveCSS("transform-origin", "100px 50px");
    await page.evaluate(() => (window as any).originEditor.getState().undo());
    expect(await page.evaluate(() => (window as any).originEditor.getState().doc)).toEqual(before);
    await page.evaluate(() => (window as any).originEditor.getState().redo());
    await reset(page);
    await expect(node(page)).toHaveCSS("transform-origin", "0px 0px");
    await expect(node(page, "b")).toHaveCSS("transform-origin", "200px 100px");
    // 別のページへ移動した後の操作で、前の複数選択を使い回してはならない。
    await page.evaluate(() => {
      const s = (window as any).originEditor.getState(); s.setActivePage("q"); s.select("c");
    });
    await center(page).click();
    await expect(node(page, "c")).toHaveCSS("transform-origin", "100px 50px");
    expect(await page.evaluate(() => {
      const { nodes } = (window as any).originEditor.getState().doc;
      return [nodes.a.styles.sm.default.transformOrigin, nodes.b.styles.sm.default.transformOrigin];
    })).toEqual([undefined, undefined]);
  });

  test("Center origin in normal mode does not block other origins or right-click reset", async ({ page }) => {
    await center(page).click();
    await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
    await page.locator('.origin-grid [data-tip="右下"]').click();
    await expect(node(page)).toHaveCSS("transform-origin", "200px 100px");
    await reset(page);
    await expect(node(page)).toHaveCSS("transform-origin", "100px 50px");
    expect(await page.evaluate(() => (window as any).originEditor.getState().doc.nodes.a.styles.base.default.transformOrigin)).toBeUndefined();
  });
});

test.describe("aspect ratio target", () => {
  let bundle: string;
  test.beforeAll(async () => { bundle = await aspectRatioBundle(); });
  test.beforeEach(async ({ page }) => {
    await page.setContent('<html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: bundle });
    await page.locator('[data-tip="最小・最大サイズと縦横比"]').click();
    await expect(ratio(page)).toHaveValue("16 / 9");
  });

  const ratio = (page: Page) => page.locator('input[placeholder="例: 16 / 9"]');
  const doc = (page: Page) => page.evaluate(() => (window as any).ratioEditor.getState().doc);
  const history = (page: Page) => page.evaluate(() => (window as any).ratioEditor.getState().past.length);
  const renderedRatio = (page: Page) => page.locator('.cv-root [data-node="a"]');

  async function draft(page: Page) {
    await ratio(page).fill("4 / 3");
    await ratio(page).evaluate((input) => { (window as any).previousRatioInput = input; });
  }

  async function expectDiscarded(page: Page, before: unknown, past: number) {
    await expect(ratio(page)).toHaveValue("16 / 9");
    expect(await page.evaluate(() => (window as any).previousRatioInput.isConnected)).toBe(false);
    await ratio(page).focus();
    await page.keyboard.press("Enter");
    expect(await doc(page)).toEqual(before);
    expect(await history(page)).toBe(past);
  }

  test("Removing the edited breakpoint remotely does not commit an unfinished aspect ratio to the desktop breakpoint", async ({ page }) => {
    await draft(page);
    // 編集中のブレークポイントが共同編集で消えたときは、pointerdown や blur が無くても base のブレークポイントに切り替わる。
    await page.evaluate(() => (window as any).removeRemoteBreakpoint());
    expect(await page.evaluate(() => (window as any).ratioEditor.getState().breakpoint)).toBe("base");
    await expectDiscarded(page, await doc(page), await history(page));
    await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "16 / 9");
    // 中断された編集の後も、新しい入力と、その「元に戻す」の履歴が使える。
    const before = await doc(page);
    await ratio(page).fill("3 / 2");
    await page.keyboard.press("Enter");
    await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "3 / 2");
    const changed = await doc(page);
    await page.evaluate(() => (window as any).ratioEditor.getState().undo());
    expect(await doc(page)).toEqual(before);
    await expect(ratio(page)).toHaveValue("16 / 9");
    await page.evaluate(() => (window as any).ratioEditor.getState().redo());
    expect(await doc(page)).toEqual(changed);
    await expect(ratio(page)).toHaveValue("3 / 2");
  });

  for (const target of ["node", "breakpoint", "state", "selection", "page"] as const) {
    test(`Changing the ${target} does not carry uncommitted text to an aspect ratio with the same value`, async ({ page }) => {
      const before = await doc(page);
      const past = await history(page);
      await draft(page);
      await page.evaluate((target) => {
        const s = (window as any).ratioEditor.getState();
        if (target === "node") s.select("b");
        else if (target === "breakpoint") s.setBreakpoint("base");
        else if (target === "state") s.setStyleState("hover");
        else if (target === "selection") s.selectMany(["a", "b"], "a");
        else { s.setActivePage("q"); s.select("c"); }
      }, target);
      if (target === "page") {
        await expect(page.locator('.cv-root [data-node="c"]')).toBeVisible();
        if (!(await ratio(page).count())) await page.locator('[data-tip="最小・最大サイズと縦横比"]').click();
      }
      await expectDiscarded(page, before, past);
    });
  }

  test("Unrelated remote edits preserve an input on the same target, which can still commit via Enter, blur, or clearing", async ({ page }) => {
    await draft(page);
    await page.evaluate(() => {
      const s = (window as any).ratioEditor.getState();
      const remote = structuredClone(s.doc); remote.nodes.b.name = "Remote name";
      s.applyRemoteDoc(remote);
    });
    await expect(ratio(page)).toHaveValue("4 / 3");
    await expect(ratio(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "4 / 3");
    await ratio(page).fill("3 / 2");
    await page.locator('.state-bar .grp-label').click();
    await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "3 / 2");
    await ratio(page).fill("");
    await page.keyboard.press("Enter");
    await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "auto");
    // 右クリックで、受け継いだ値に戻す操作も引き続き使える。
    await page.locator('.grp-label').filter({ hasText: /^縦横比$/ }).click({ button: "right" });
    await expect(ratio(page)).toHaveValue("16 / 9");
    await expect(renderedRatio(page)).toHaveCSS("aspect-ratio", "16 / 9");
    expect((await doc(page)).nodes.b.name).toBe("Remote name");
  });
});
