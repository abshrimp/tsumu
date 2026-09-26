import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";

test("front/back controls affect a static block's actual stacking and undo restores it", async ({ page }) => {
  await page.route("http://position-control.test/", route => route.fulfill({ contentType: "text/html", body: '<body style="margin:0"><div id="app"></div></body>' }));
  await page.goto("http://position-control.test/");
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import StylePanel from "./components/StylePanel";
      import { makeBox, createInitialDoc } from "./lib/presets";
      import { useEditor } from "./lib/store";
      const node = makeBox(); node.id = "a";
      node.styles = {base:{default:{display:"block",position:"static",width:"100px",height:"100px",backgroundColor:"red"}}};
      const peer = makeBox(); peer.id = "b";
      peer.styles = {base:{default:{position:"relative",zIndex:"0",width:"100px",height:"100px",marginTop:"-100px",backgroundColor:"blue"}}};
      const doc = createInitialDoc(); doc.nodes = { a: node, b: peer };
      doc.pages[doc.pageOrder[0]].children = ["a", "b"];
      useEditor.getState().replaceDoc(doc); useEditor.getState().select("a");
      window.positionEditor = useEditor;
      function Fixture() {
        const style = useEditor(s => s.doc.nodes.a.styles.base.default);
        const peer = useEditor(s => s.doc.nodes.b.styles.base.default);
        return <><div id="front" style={style}/><div id="back" style={peer}/><StylePanel nodeId="a" /></>;
      }
      createRoot(document.getElementById("app")).render(<Fixture />);
    `, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const top = () => page.evaluate(() => document.elementFromPoint(50, 50)?.id);
  await expect.poll(top).toBe("back");
  await page.locator(".z-ctl button").last().click();
  await expect.poll(top).toBe("front");
  await expect(page.locator("#front")).toHaveCSS("position", "relative");
  await page.evaluate(() => (window as any).positionEditor.getState().undo());
  await expect.poll(top).toBe("back");
  await expect(page.locator("#front")).toHaveCSS("position", "static");
});
