import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";

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
