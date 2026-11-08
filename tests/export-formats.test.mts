import assert from "node:assert/strict";
import { test } from "node:test";
import type { SiteDoc } from "../lib/types";
import { exportLimitations, generateExportProject } from "../lib/export-formats";
import { reactSource } from "../lib/generator/react-export";
import { makeBox, makeImage } from "../lib/presets";

function fixture(): SiteDoc {
  const box = { ...makeBox(), id: "hero", text: { content: "Hello", heading: 1 } };
  const image = { ...makeImage(), id: "photo" };
  return {
    siteName: "Export Test",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "Welcome", children: ["hero", "photo"] },
    },
    pageOrder: ["home"],
    nodes: { hero: box, photo: image },
    assets: {},
  };
}

test("Next.js export remains identical to the publish generator", async () => {
  const { generateProject } = await import("../lib/generator");
  assert.deepEqual(generateExportProject(fixture(), "nextjs"), generateProject(fixture()));
});

test("React output includes Vite entrypoints, routes, CSS and assets", () => {
  const result = generateExportProject(fixture(), "react");
  assert.match(result.files["package.json"], /"vite"/);
  assert.match(result.files["src/main.tsx"], /createRoot/);
  assert.match(result.files["src/App.tsx"], /const routes: Route\[\]/);
  assert.match(result.files["src/pages/Page0.tsx"], /Hello/);
  assert.match(result.files["src/pages/Page0.tsx"], /<img/);
  assert.doesNotMatch(result.files["src/pages/Page0.tsx"], /next\/image/);
  assert.ok(result.files["src/site.css"]);
  assert.ok(result.files["src/globals.css"]);
  assert.match(result.files["index.html"], /<div id="root"><\/div>/);
  assert.equal(result.files["next.config.mjs"], undefined);
});

test("HTML export downloads ready-to-open pages, styles and assets without a build", () => {
  const result = generateExportProject(fixture(), "html");
  assert.match(result.files["index.html"], /<!doctype html>/);
  assert.match(result.files["index.html"], /Hello/);
  assert.match(result.files["index.html"], /styles\/globals\.css/);
  assert.match(result.files["index.html"], /styles\/site\.css/);
  assert.ok(result.files["styles/site.css"]);
  assert.ok(result.files["styles/globals.css"]);
  assert.equal(result.files["package.json"], undefined);
  assert.equal(result.files["next.config.mjs"], undefined);
  assert.equal(result.files["vite.config.ts"], undefined);
  assert.match(result.files["README.txt"], /No npm install/);
});

test("HTML export produces independent nested pages and relative links", () => {
  const doc = fixture();
  doc.pages.about = { ...doc.pages.home, id: "about", name: "About", slug: "about", title: "About", children: [] };
  doc.pageOrder.push("about");
  doc.nodes.hero.link = { kind: "page", pageId: "about" };
  const result = generateExportProject(doc, "html");
  assert.match(result.files["index.html"], /href="\.\/about\/index\.html"/);
  assert.match(result.files["about/index.html"], /href="\.\.\/styles\/site\.css"/);
  assert.equal(result.files["src/App.tsx"], undefined);
});

test("HTML export keeps raw HTML routes without transpiling their content", () => {
  const doc = fixture();
  doc.pages.home.rawHtml = '<!doctype html><html><head><title>Raw</title></head><body><main id="raw-html">Raw body</main></body></html>';
  const result = generateExportProject(doc, "html");
  assert.match(result.files["index.html"], /id="raw-html"/);
  assert.doesNotMatch(result.files["index.html"], /react-dom|__next/);
});

test("unsupported dynamic routes and reverse proxies fail explicitly", () => {
  const doc = fixture();
  doc.pages.home.slug = "articles/[slug]";
  assert.ok(exportLimitations(doc, "react").some((x) => x.includes("[slug]")));
  assert.throws(() => generateExportProject(doc, "html"), /slug/);
  doc.pages.home.slug = "";
  doc.pages.home.rewriteTo = "https://example.com";
  assert.ok(exportLimitations(doc, "react").length);
  assert.throws(() => generateExportProject(doc, "react"));
});

test("client-only variables do not force a server-only export error", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Hello {username}";
  const react = generateExportProject(doc, "react");
  assert.match(react.files["src/pages/Page0.tsx"], /export default function Page/);
  assert.match(react.files["src/pages/Page0.tsx"], /new URLSearchParams\(window\.location\.search\)/);
  // A standalone page can update client text from the visitor's query.
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.match(html, /data-live="Hello \{username\}"/);
});

test("React uses the same browser data loader for API calls and transformations", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Found {total} records";
  doc.pages.home.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [
      { id: "fetch", kind: "fetch", url: "https://example.com/data.json?tab={tab}", as: "results" },
      { id: "count", kind: "count", array: "results", into: "total" },
    ],
  }];
  assert.deepEqual(exportLimitations(doc, "react"), []);
  const project = generateExportProject(doc, "react");
  assert.ok(project.files["public/data-loader.js"].includes("fetch(url, init)"));
  assert.ok(project.files["public/scripts.js"].includes("__pageDataReady"));
  assert.match(project.files["src/pages/Page0.tsx"], /data-page-plan/);
  assert.match(project.files["src/pages/Page0.tsx"], /data-live/);
  assert.match(project.files["src/pages/Page0.tsx"], /Found .* records/);
  assert.match(project.files["src/App.tsx"], /data-loader\.js/);
  assert.doesNotMatch(project.files["src/pages/Page0.tsx"], /fetchPublic|next\/navigation/);
});

test("React preserves list-display operations even without a fetch", () => {
  const doc = fixture();
  doc.pages.home.pageScripts = [{
    id: "filter-on-load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "filter", kind: "list-display", mode: "filter",
      array: "products", field: "status", op: "eq",
      value: "published", dir: "asc" }],
  }] as unknown as typeof doc.pages.home.pageScripts;
  const output = generateExportProject(doc, "react");
  assert.ok(output.files["public/data-loader.js"]);
  assert.ok(output.files["src/pages/Page0.tsx"].includes("data-page-plan"));
  assert.ok(output.files["src/pages/Page0.tsx"].includes("filter"));
});

test("React JSX adaptation removes only framework-specific JSX wrappers", () => {
  const source = 'import type { Metadata } from "next";\n' +
    'import Link from "next/link";\nimport Image from "next/image";\n' +
    'export const metadata: Metadata = {\n  title: "X",\n};\n' +
    'export default function Page() { return <><Link href="/a">A</Link><Image src="/x" alt="X" width={10} height={10} /></>; }';
  const result = reactSource(source);
  assert.match(result, /<a href/);
  assert.match(result, /<img src/);
  assert.doesNotMatch(result, /next\/|export const metadata/);
  assert.throws(() => reactSource('import { notFound } from "next/navigation";'));
});


test("React export preserves query-variant routing", () => {
  const doc = fixture();
  doc.pages.tab = { ...doc.pages.home, id: "tab", name: "Tab", title: "Tab", query: "tab=2" };
  doc.pageOrder.push("tab");
  const result = generateExportProject(doc, "react");
  assert.match(result.files["src/App.tsx"], /"tab":"2"/);
  assert.match(result.files["src/App.tsx"], /matches\.sort/);
  assert.ok(result.files["src/pages/Page1.tsx"]);
});

test("HTML supports query-based page variants without a server rewrite", () => {
  const doc = fixture();
  doc.nodes.hero.text!.content = "Default";
  doc.pages.other = {
    ...doc.pages.home, id: "other", title: "Other", query: "tab=2",
    children: ["other-text"],
  };
  doc.nodes["other-text"] = {
    ...makeBox(), id: "other-text", text: { content: "Second tab", heading: 1 },
  };
  doc.pageOrder.push("other");
  doc.nodes.hero.link = { kind: "page", pageId: "other" };
  assert.deepEqual(exportLimitations(doc, "html"), []);
  const html = generateExportProject(doc, "html");
  assert.ok(html.files["query-router.js"]);
  assert.match(html.files["index.html"], /data-page-variants/);
  assert.match(html.files["index.html"], /query-router\.js/);
  assert.match(html.files["index.html"], /index\.html\?tab=2/);
  assert.match(html.files["index.html"], /Second tab/);
  assert.equal(Object.keys(html.files).filter((name) => name.endsWith("index.html")).length, 1);
});

test("HTML accepts ordinary query variables even without separate page variants", () => {
  const doc = fixture();
  doc.pages.home.query = "tab=default";
  doc.nodes.hero.text!.content = "Tab {tab}";
  assert.deepEqual(exportLimitations(doc, "html"), []);
  assert.match(generateExportProject(doc, "html").files["index.html"], /data-live="Tab \{tab\}"/);
});

test("React export includes native forms and PWA manifest", () => {
  const doc = fixture();
  const form = { ...makeBox(), id: "search", semantic: "form" as const, children: ["hero"] };
  doc.nodes.search = form;
  doc.pages.home.children = ["search"];
  doc.pwa = { enabled: true };
  const result = generateExportProject(doc, "react");
  assert.match(result.files["src/components/SearchForm.tsx"], /window\.location\.assign/);
  assert.ok(result.files["public/manifest.webmanifest"]);
  assert.match(result.files["index.html"], /manifest\.webmanifest/);
});

test("export scope isolates one page or the selected node", () => {
  const doc = fixture();
  doc.pages.other = { id: "other", name: "Other", title: "Other", slug: "other", description: "", children: [] };
  doc.pageOrder.push("other");
  const opts = { framework: "react" as const, language: "typescript" as const, style: "css" as const, pageId: "home" };
  const page = generateExportProject(doc, { ...opts, scope: "page" });
  assert.doesNotMatch(page.files["src/App.tsx"], /"\/other"/);
  const component = generateExportProject(doc, { ...opts, scope: "component", nodeId: "hero" });
  assert.match(component.files["src/pages/Page0.tsx"], /Hello/);
  assert.ok(exportLimitations(doc, { ...opts, scope: "component" }).length > 0);
});

test("CSS Modules and Tailwind retain Tsumu's authored CSS", () => {
  const doc = fixture();
  const options = { framework: "react" as const, language: "typescript" as const, scope: "project" as const };
  const modules = generateExportProject(doc, { ...options, style: "css-modules" });
  assert.match(modules.files["src/App.tsx"], /siteStyles\.siteRoot/);
  assert.ok(modules.files["src/site.module.css"]);
  assert.ok(modules.files["src/site-global.css"]);
  const tailwind = generateExportProject(doc, { ...options, style: "tailwind" });
  assert.match(tailwind.files["src/globals.css"], /tailwindcss\/utilities\.css/);
  assert.match(tailwind.files["package.json"], /@tailwindcss\/vite/);
  assert.ok(tailwind.files["src/site.css"]);
});

test("JavaScript option produces actual JS and JSX files", async () => {
  const { toJavaScriptProject } = await import("../lib/generator/javascript-export");
  const output = await toJavaScriptProject(generateExportProject(fixture(), "react"), "react");
  assert.ok(output.files["src/App.jsx"]);
  assert.ok(output.files["src/main.jsx"]);
  assert.equal(output.files["src/main.tsx"], undefined);
  assert.ok(output.files["index.html"].includes("src/main.jsx"));
  assert.ok(!output.files["index.html"].includes("src/main.tsx"));
  assert.ok(output.files["vite.config.js"]);
  assert.equal(output.files["src/App.tsx"], undefined);
  assert.ok(output.files["jsconfig.json"]);
  assert.doesNotMatch(output.files["src/App.jsx"], /type Route =/);
  assert.match(output.files["package.json"], /"build": "vite build"/);
});

test("nested HTML exports rewrite real resource URLs without changing scripts, comments, or attribute text", () => {
  const doc = fixture();
  doc.pages.details = {
    ...doc.pages.home, id: "details", slug: "guide/details",
    children: [], customTopHtml: [
      "<script>window.template = 'src=\"/literal\" url(/literal)';</script>",
      '<script src="/scripts/app.js"></script>',
      '<!-- <img src="/comment.svg"> -->',
      '<textarea>href="/textarea.txt"</textarea>',
      '<style>.background { background-image: url(/assets/paint.svg); }</style>',
      '<style>@import "/assets/theme.css"; /* url(/comment) */ .literal { content: "url(/literal)"; }</style>',
      "<div data-example='src=\"/untouched\"' style='background:url(/assets/paint.svg)'>",
      '<img src="/assets/photo.png">',
      "</div>",
    ].join("\n"),
  };
  doc.pageOrder.push("details");
  doc.customHeadHtml =
    '<script>window.headLiteral = \'href="/head-literal"\';</script>' +
    '<link rel="preload" href="/assets/font.woff2">';

  const html = generateExportProject(doc, "html").files["guide/details/index.html"];
  assert.ok(html);
  assert.match(html, /window\.template = 'src="\/literal" url\(\/literal\)'/);
  assert.match(html, /window\.headLiteral = 'href="\/head-literal"'/);
  assert.match(html, /<script src="\.\.\/\.\.\/scripts\/app\.js"><\/script>/);
  assert.match(html, /<link rel="preload" href="\.\.\/\.\.\/assets\/font\.woff2">/);
  assert.match(html, /<img src="\.\.\/\.\.\/assets\/photo\.png">/);
  assert.match(html, /background-image: url\(\.\.\/\.\.\/assets\/paint\.svg\)/);
  assert.match(html, /@import "\.\.\/\.\.\/assets\/theme\.css"/);
  assert.match(html, /\/\* url\(\/comment\) \*\//);
  assert.match(html, /content: "url\(\/literal\)"/);
  assert.match(html, /style='background:url\(\.\.\/\.\.\/assets\/paint\.svg\)'/);
  assert.match(html, /data-example='src="\/untouched"'/);
  assert.match(html, /<!-- <img src="\/comment\.svg"> -->/);
  assert.match(html, /<textarea>href="\/textarea\.txt"<\/textarea>/);
});
