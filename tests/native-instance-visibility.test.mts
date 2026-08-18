import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");
for (const framework of ["vue", "nuxt", "sveltekit"] as const) test(`${framework}: instance visibility markup matches its responsive CSS without hiding sibling instances`, () => {
  const doc: SiteDoc = { siteName: "Visibility", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "", children: ["hidden", "visible"] } },
    components: { card: { id: "card", name: "Card", rootId: "root" } },
    nodes: {
      root: { ...makeBox(), id: "root", text: { content: "Card", heading: 0 } },
      hidden: { ...makeBox(), id: "hidden", attrId: "hidden-use", type: "instance", componentId: "card", hiddenOn: ["sm"] },
      visible: { ...makeBox(), id: "visible", attrId: "visible-use", type: "instance", componentId: "card" },
    },
  };
  const { files } = generateExportProject(doc, framework);
  const path = framework === "nuxt" ? "app/generated/pages/Page0.vue" : framework === "vue" ? "src/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
  const tree = parse(files[path]);
  const hidden = tree.querySelector("#hidden-use"), visible = tree.querySelector("#visible-use");
  const marker = hidden.getAttribute("data-instance-hidden");
  assert.ok(marker, "instance wrapper needs the selector marker used by shared responsive CSS");
  const css = Object.entries(files).filter(([name]) => name.endsWith(".css")).map(([, content]) => content).join("\n");
  assert.ok(css.includes(`[data-instance-hidden~=${JSON.stringify(marker)}]`));
  assert.match(css.slice(css.indexOf(`[data-instance-hidden~=${JSON.stringify(marker)}]`)), /display: none !important/);
  assert.equal(visible.hasAttribute("data-instance-hidden"), false);
  assert.equal(hidden.getAttribute("style"), "display:contents");
});
