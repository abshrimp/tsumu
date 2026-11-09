import assert from "node:assert/strict";
import { test } from "node:test";
import { exportLimitations, exportScopeDoc, generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function doc(): SiteDoc {
  return {
    siteName: "Export scope security",
    lang: "ja",
    pageOrder: ["public", "private"],
    pages: {
      public: { id: "public", name: "Public", slug: "", title: "Public",
        description: "", children: ["container", "instance"] },
      private: { id: "private", name: "Private", slug: "private", title: "Private",
        description: "", unpublished: true, children: ["secret"] },
    },
    nodes: {
      container: { ...makeBox(), id: "container", children: ["visible"] },
      visible: { ...makeBox(), id: "visible", text: { heading: 0, content: "PUBLIC" } },
      instance: { ...makeBox(), id: "instance", type: "instance", componentId: "shared" },
      master: { ...makeBox(), id: "master", children: ["nested"] },
      nested: { ...makeBox(), id: "nested", text: { heading: 0, content: "COMPONENT" } },
      secret: { ...makeBox(), id: "secret", text: { heading: 0, content: "PRIVATE-SENTINEL" } },
    },
    components: { shared: { id: "shared", name: "Shared", rootId: "master" } },
    assets: {},
  };
}

const opts = { framework: "html", language: "javascript", style: "css", scope: "component",
  pageId: "public" } as const;

test("AUD-F-001: component export cannot select a stale node from a different page", () => {
  const site = doc();
  assert.ok(exportLimitations(site, { ...opts, nodeId: "secret" }).length > 0);
  assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "secret" }),
    /書き出すコンポーネント/);
  assert.throws(() => generateExportProject(site, { ...opts, nodeId: "secret" }),
    /書き出すコンポーネント/);
  assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "missing" }),
    /書き出すコンポーネント/);
});

test("AUD-F-001: descendant nodes and referenced component masters remain valid selections", () => {
  const site = doc();
  for (const nodeId of ["container", "visible", "instance", "master", "nested"]) {
    const scoped = exportScopeDoc(site, { ...opts, nodeId });
    assert.deepEqual(scoped.pageOrder, ["__export_component__"]);
    assert.ok(scoped.nodes[nodeId], nodeId);
    assert.equal(scoped.nodes.secret, undefined);
    assert.doesNotMatch(generateExportProject(site, { ...opts, nodeId }).files["index.html"],
      /PRIVATE-SENTINEL/);
  }
  assert.equal(site.pages.public.children.includes("container"), true,
    "export must not mutate the saved document");
});

test("AUD-F-001: inherited object properties never count as page or component nodes", () => {
  const site = doc();
  assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "toString" }),
    /書き出すコンポーネント/);
  assert.throws(() => exportScopeDoc(site, { ...opts, pageId: "constructor", nodeId: "visible" }),
    /書き出すページ/);
});

test("AUD-F-001: malformed cyclic child pointers terminate without widening export scope", () => {
  const site = doc();
  site.nodes.visible.children = ["container"];
  assert.doesNotThrow(() => exportScopeDoc(site, { ...opts, nodeId: "visible" }));
  assert.throws(() => exportScopeDoc(site, { ...opts, nodeId: "secret" }),
    /書き出すコンポーネント/);
});
