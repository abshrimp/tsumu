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

test("AUD-F-002: static query variants bootstrap authored scripts before the page engine", async () => {
  const { QUERY_VARIANT_RUNTIME } = await import("../lib/generator/query-route");
  const site = doc();
  site.pages.private.unpublished = false;
  site.pages.private.slug = "";
  site.pages.private.query = "tab=2";
  site.pages.private.customTopHtml = '<script>window.__authoredScript = true;</script>';
  const project = generateExportProject(site, "html");
  const html = project.files["index.html"];
  assert.match(html, /data-runtime-sources="[^"]*data-loader\.js/);
  assert.match(html, /query-router\.js/);
  assert.equal((html.match(/<script defer /g) || []).length, 1,
    "generated data/event scripts are loaded only after the variant is ready");

  const events: string[] = [];
  const element = (type: string, textContent: string, source?: string) => {
    const attributes = [
      ...(type ? [{ name: "type", value: type }] : []),
      ...(source ? [{ name: "src", value: source }] : []),
    ];
    return {
      attributes, textContent,
      getAttribute: (name: string) => attributes.find((attr) => attr.name === name)?.value ?? null,
      hasAttribute: (name: string) => attributes.some((attr) => attr.name === name),
      replaceWith(script: { text: string; onload?: () => void }) {
        events.push(source ? "author-external-inserted" : type === "application/json" ? "incorrect-json" : "author-inline-inserted");
        if (!source) {
          assert.equal(script.text, textContent);
        } else {
          queueMicrotask(() => {
            events.push("author-external-loaded");
            script.onload?.();
          });
        }
      },
    };
  };
  const fragments = [
    element("application/json", '{"steps":[]}'),
    element("", "window.__authoredScript = true;"),
    element("module", "", "/author.js"),
  ];
  const host = {
    innerHTML: "",
    querySelectorAll(selector: string) {
      assert.equal(selector, "script");
      return fragments;
    },
  };
  const metadata = { value: "", setAttribute(_key: string, value: string) { this.value = value; } };
  const documentMock = {
    title: "",
    documentElement: { lang: "" },
    currentScript: {
      getAttribute: (_name: string) => JSON.stringify(["/data-loader.js", "/scripts.js"]),
    },
    querySelector(selector: string) {
      if (selector === "[data-variant-root]") return host;
      if (selector === "script[data-page-variants]") {
        return { textContent: JSON.stringify([
          { query: {}, html: "<h1>Default</h1>", title: "Default", lang: "en", description: "" },
          { query: { tab: "2" }, html: "<h1>Selected</h1>", title: "Selected", lang: "ja", description: "Chosen" },
        ]) };
      }
      if (selector === 'meta[name="description"]') return metadata;
      return null;
    },
    createElement() {
      return {
        text: "", src: "",
        setAttribute(name: string, value: string) {
          if (name === "src") this.src = value;
        },
        onload: undefined as undefined | (() => void),
        onerror: undefined as undefined | (() => void),
      };
    },
    body: {
      appendChild(script: { src: string; onload?: () => void }) {
        events.push(script.src);
        queueMicrotask(() => script.onload?.());
      },
    },
  };
  const run = new Function("document", "location", "URLSearchParams", "console", QUERY_VARIANT_RUNTIME);
  run(documentMock, { search: "?tab=2" }, URLSearchParams, console);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(host.innerHTML, "<h1>Selected</h1>");
  assert.equal(documentMock.title, "Selected");
  assert.equal(documentMock.documentElement.lang, "ja");
  assert.equal(metadata.value, "Chosen");
  assert.deepEqual(events, [
    "author-inline-inserted", "author-external-inserted", "author-external-loaded",
    "/data-loader.js", "/scripts.js",
  ]);
});

test("AUD-F-003: native formats refuse authored HTML they would otherwise omit", () => {
  const site = doc();
  const page = site.pages.public;
  const cases: Array<() => void> = [
    () => { site.customHeadHtml = '<meta name="authored-marker" content="head">'; },
    () => { site.customBodyEndHtml = '<aside data-marker="footer">Footer</aside>'; },
    () => { page.customTopHtml = '<div data-marker="top">Top</div>'; },
    () => { page.customEndHtml = '<div data-marker="end">End</div>'; },
  ];
  for (const setup of cases) {
    delete site.customHeadHtml;
    delete site.customBodyEndHtml;
    delete page.customTopHtml;
    delete page.customEndHtml;
    setup();
    for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
      assert.ok(exportLimitations(site, framework).some((reason) =>
        reason.includes("カスタムHTML")), framework);
      assert.throws(() => generateExportProject(site, framework), /カスタムHTML/);
    }
  }
  assert.equal(exportLimitations(site, "html").length, 0,
    "custom page HTML is supported in standalone HTML");
});

test("AUD-F-003: React refuses executable page scripts on data-driven DOM pages", () => {
  const site = doc();
  const page = site.pages.public;
  page.pageScripts = [{
    id: "init", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "set", kind: "set-var", into: "state", value: "ready" }],
  }];
  page.customTopHtml = '<script>window.__pageStarted = true;</script>';
  assert.ok(exportLimitations(site, "react").some((reason) =>
    reason.includes("カスタムスクリプト")));
  assert.throws(() => generateExportProject(site, "react"), /カスタムスクリプト/);
  page.customTopHtml = '<script type="application/json">{"safe":true}</script>';
  assert.ok(!exportLimitations(site, "react").some((reason) =>
    reason.includes("カスタムスクリプト")));
});
