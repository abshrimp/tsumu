import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { resolve } from "node:path";

// 実際のストアとキャンバスで、複製したサイトへの貼り付けを試す。外部へのリクエストは行わない。
const buildFixture = () => buildSync({
  stdin: {
    contents: `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { NodeView } from "./components/canvas/NodeView";
import { buildClipPayload } from "./lib/clip-transfer";
import { makeBox, makeText } from "./lib/presets";
import { useEditor } from "./lib/store";

const destination = {
  siteName: "Fork", assets: {}, pageOrder: ["home"],
  pages: { home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["shared"] } },
  nodes: {
    shared: { ...makeBox(), id: "shared", children: ["text"] },
    text: { ...makeText("Destination original"), id: "text" },
  },
};
function open(doc) {
  useEditor.getState().replaceDoc(doc);
  useEditor.getState().setActivePage("home");
  useEditor.getState().select(null);
  useEditor.getState().setEditingComponent(null);
}
open(structuredClone(destination));
useEditor.getState().updateNode("text", { text: { content: "Imported master content", heading: 0 } });
useEditor.getState().createComponent("shared");
const source = useEditor.getState().doc;
const instance = source.nodes[source.pages.home.children[0]];
const componentId = instance.componentId;
const payload = buildClipPayload(source, { nodes: [structuredClone(instance)], rootIds: [instance.id] });
open(destination);

function Harness() {
  const doc = useEditor((state) => state.doc);
  const button = (label, action) => createElement("button", { onClick: action }, label);
  return createElement("main", null,
    button("Paste component", () => {
      useEditor.getState().select(null);
      useEditor.getState().pasteClipboard(payload);
    }),
    button("Edit imported master", () => {
      const doc = useEditor.getState().doc;
      const root = doc.nodes[doc.components[componentId].rootId];
      useEditor.getState().updateNode(root.children[0], { text: { content: "Edited imported master", heading: 0 } });
    }),
    button("Delete imported component", () => useEditor.getState().deleteComponent(componentId)),
    button("Undo", () => useEditor.getState().undo()),
    button("Redo", () => useEditor.getState().redo()),
    createElement("div", { id: "canvas" }, doc.pages.home.children.map((id) =>
      createElement(NodeView, { key: id, id, isTop: true }))),
  );
}
window.importFixture = { useEditor, componentId, destination };
createRoot(document.getElementById("app")).render(createElement(Harness));
`,
    loader: "tsx",
    sourcefile: "component-import-browser.tsx",
    resolveDir: resolve(__dirname, ".."),
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
}).outputFiles[0].text;

test("Editing, deleting, and undoing components pasted into a copied site does not corrupt original nodes", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // エディタのサーバーにも外部のサービスにも接続しない。想定外の通信も横取りする。
  await page.route("**/*", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.setContent('<div id="app"></div>');
  await page.addScriptTag({ content: buildFixture() });
  const canvas = page.locator("#canvas");
  const original = canvas.getByText("Destination original", { exact: true });
  const imported = canvas.getByText("Imported master content", { exact: true });
  const edited = canvas.getByText("Edited imported master", { exact: true });
  await expect(original).toHaveCount(1);
  await expect(imported).toHaveCount(0);

  await page.getByRole("button", { name: "Paste component", exact: true }).click();
  await expect(original).toHaveCount(1);
  await expect(imported).toHaveCount(1);
  await page.getByRole("button", { name: "Edit imported master", exact: true }).click();
  await expect(original).toHaveCount(1);
  await expect(edited).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(imported).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(edited).toHaveCount(1);

  await page.getByRole("button", { name: "Delete imported component", exact: true }).click();
  await expect(original).toHaveCount(1);
  await expect(edited).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(original).toHaveCount(1);
  await expect(edited).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(original).toHaveCount(1);
  await expect(edited).toHaveCount(0);

  const result = await page.evaluate(() => {
    const { useEditor, componentId, destination } = (window as any).importFixture;
    const doc = useEditor.getState().doc;
    return {
      originalNodesPreserved: Object.entries(destination.nodes).every(([id, node]) => JSON.stringify(doc.nodes[id]) === JSON.stringify(node)),
      pageChildren: doc.pages.home.children,
      componentRemoved: !doc.components?.[componentId],
    };
  });
  expect(result).toEqual({ originalNodesPreserved: true, pageChildren: ["shared"], componentRemoved: true });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
