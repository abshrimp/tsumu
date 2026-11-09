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

test("AUD-F-004: exporting a selected unpublished page includes it without publishing it in the source", () => {
  const site = doc();
  site.pages.public.unpublished = true;
  const scoped = exportScopeDoc(site, { ...opts, scope: "page" });
  assert.equal(scoped.pages.public.unpublished, false);
  assert.equal(site.pages.public.unpublished, true);
  assert.deepEqual(scoped.pageOrder, ["public"]);
  const html = generateExportProject(site, { ...opts, scope: "page" }).files["index.html"];
  assert.match(html, /PUBLIC/);
  assert.doesNotMatch(html, /PRIVATE-SENTINEL/);
  assert.equal(site.pages.public.unpublished, true,
    "exporting a page does not change the saved publication state");
});

test("AUD-F-005: every Tailwind export registers its CSS processing plugin", () => {
  const site = doc();
  const options = { language: "typescript", style: "tailwind", scope: "project" } as const;
  const registrations = [
    ["react", "vite.config.ts", /plugins:\s*\[tailwindcss\(\)\]/],
    ["vue", "vite.config.ts", /plugins:\s*\[vue\(\),\s*tailwindcss\(\)\]/],
    ["nuxt", "nuxt.config.ts", /vite:\s*\{\s*plugins:\s*\[tailwindcss\(\)\]/],
    ["sveltekit", "vite.config.ts", /plugins:\s*\[tailwindcss\(\),\s*sveltekit\(/],
    ["nextjs", "postcss.config.mjs", /"@tailwindcss\/postcss"/],
  ] as const;
  for (const [framework, path, plugin] of registrations) {
    const generated = generateExportProject(site, { ...options, framework });
    assert.match(generated.files[path], plugin, framework + ": missing Tailwind plugin");
    assert.match(generated.files["package.json"], /tailwindcss/,
      framework + ": missing Tailwind dependency");
  }
});

test("AUD-F-006: generated ZIPs reject file/directory collisions and unsafe paths", async () => {
  const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
  const empty = { binaries: {}, remoteAssets: {} };
  for (const path of ["../outside.txt", "/absolute.txt", "C:/drive.txt",
    "a//b.txt", "a/./b.txt", "a/../b.txt", "a\\b.txt", "bad\u0000name"]) {
    assert.throws(() => assertGeneratedPaths({ ...empty, files: { [path]: "x" } }),
      /Unsafe generated/, JSON.stringify(path));
  }
  assert.throws(() => assertGeneratedPaths({
    files: { "styles/site.css": "css", "styles/site.css/index.html": "html" },
    binaries: {}, remoteAssets: {},
  }), /file\/directory collision/);
  assert.throws(() => assertGeneratedPaths({
    files: { "public/assets/photo.png": "text" },
    binaries: { "public/assets/photo.png": "AQID" }, remoteAssets: {},
  }), /Duplicate generated/);
  assert.doesNotThrow(() => assertGeneratedPaths({
    files: { "styles/site.css": "css", "styles/globals.css": "css" },
    binaries: { "public/assets/photo.png": "AQID" }, remoteAssets: {},
  }));
});

test("AUD-F-006: HTML export reports a page slug that collides with the CSS file", () => {
  const site = doc();
  site.pages.private.unpublished = false;
  site.pages.private.slug = "styles/site.css";
  assert.throws(() => generateExportProject(site, "html"),
    /file\/directory collision: styles\/site\.css/);
  assert.doesNotThrow(() => generateExportProject(site, "nextjs"),
    "Next.js uses a different output tree without this HTML static-file collision");
});

test("AUD-F-007: generated names remain unambiguous on case-insensitive filesystems", async () => {
  const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
  const { buildAssetNames } = await import("../lib/generator/names");
  assert.throws(() => assertGeneratedPaths({
    files: { "About/index.html": "page", "about/index.html": "other" },
    binaries: {}, remoteAssets: {},
  }), /Case-insensitive generated file collision/);
  assert.throws(() => assertGeneratedPaths({
    files: { "ASSETS": "file", "assets/logo.png": "image" },
    binaries: {}, remoteAssets: {},
  }), /file\/directory collision/);
  for (const path of ["CON.txt", "public/nul/file", "public/name.", "public/invalid?file"]) {
    assert.throws(() => assertGeneratedPaths({
      files: { [path]: "content" }, binaries: {}, remoteAssets: {},
    }), /Unsafe generated/);
  }

  const site = doc();
  site.assets["upper"] = { id: "upper", name: "Logo.PNG", mimeType: "image/png",
    width: 1, height: 1, dataUrl: "data:image/png;base64,AQID" };
  site.assets["lower"] = { id: "lower", name: "logo.png", mimeType: "image/png",
    width: 1, height: 1, dataUrl: "data:image/png;base64,AQID" };
  const names = buildAssetNames(site);
  assert.notEqual(names.get("upper")?.toLowerCase(), names.get("lower")?.toLowerCase());
  assert.match(names.get("lower")!, /-2\.png$/i);
});


test("AUD-F-008: editable ZIP metadata cannot collide with generated page paths", async () => {
  const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
  const reserved = ["_tsumu/doc.json", "_tsumu/assets.json"];
  const empty = { binaries: {}, remoteAssets: {} };
  for (const path of ["_tsumu/doc.json", "_tsumu/doc.json/index.html",
    "_TSUMU/Assets.JSON/index.html", "_tsumu/assets.json"]) {
    assert.throws(() => assertGeneratedPaths({ ...empty, files: { [path]: "content" } }, reserved),
      /Duplicate generated|Case-insensitive generated|file\/directory collision/,
      "ZIP metadata collision: " + path);
  }
  const site = doc();
  site.pages.private.unpublished = false;
  site.pages.private.slug = "_tsumu/doc.json";
  const html = generateExportProject(site, "html");
  assert.ok(html.files["_tsumu/doc.json/index.html"],
    "normal HTML generation alone cannot detect later ZIP metadata entries");
  assert.throws(() => assertGeneratedPaths(html, reserved), /file\/directory collision/);
});

test("AUD-F-009: Windows device names are renamed, not rejected, as asset paths", async () => {
  const { buildAssetNames } = await import("../lib/generator/names");
  const site = doc();
  for (const [i, name] of ["CON.png", "con.png", "AUX.svg", "COM1.jpg",
    "lpt9.woff", "CON..png", "normal.png"].entries()) {
    const id = "asset" + i;
    site.assets[id] = { id, name, width: 1, height: 1,
      mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" };
  }
  const names = buildAssetNames(site);
  const files = Array.from(names.values());
  assert.equal(new Set(files.map((name) => name.toLowerCase())).size, files.length);
  for (let i = 0; i < 6; i++) {
    assert.ok(files[i].startsWith("_"), "Windows device-name asset was not renamed: " + files[i]);
  }
  assert.equal(files[0], "_CON.png");
  assert.equal(files[1], "_con-2.png");
  assert.equal(files[5], "_CON-3.png");
  assert.doesNotThrow(() => generateExportProject(site, "html"));
});

test("AUD-F-010: the ZIP root directory is portable for Windows device-name site titles", async () => {
  const { exportDirectoryName } = await import("../lib/exportZip");
  for (const name of ["CON", "prn", "AuX", "NUL", "com1", "LPT9"]) {
    assert.equal(exportDirectoryName(name), "_" + name.toLowerCase());
  }
  assert.equal(exportDirectoryName("Example website"), "example-website");
  assert.equal(exportDirectoryName(""), "my-site");
});

test("AUD-F-011: Next.js refuses imported HTML route collisions before generating files", () => {
  const site = doc();
  site.pages.public.rawHtml = "<!doctype html><html><body>Imported</body></html>";
  site.pages.private.unpublished = false;
  site.pages.private.slug = "";
  site.pages.private.query = "tab=2";
  assert.ok(exportLimitations(site, "nextjs").some((reason) =>
    reason.includes("同じパス")));
  assert.throws(() => generateExportProject(site, "nextjs"), /同じパス/);

  // Two imported pages with different queries still compile to one route.ts.
  site.pages.private.rawHtml = "<!doctype html><html><body>Other</body></html>";
  assert.throws(() => generateExportProject(site, "nextjs"), /同じパス/);

  // Different URLs are independent routes and remain supported.
  site.pages.private.slug = "other";
  assert.deepEqual(exportLimitations(site, "nextjs"), []);
});

test("AUD-F-012: browser exports use decoded, deep credential scanning like GitHub Push", () => {
  const site = doc();
  site.pages.public.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "fetch", kind: "fetch", as: "data",
      url: "https://public.example/data?%61pi_key=literal" }],
  }];
  for (const framework of ["react", "vue", "nuxt", "sveltekit", "html", "single-html"] as const) {
    assert.ok(exportLimitations(site, framework).some((reason) =>
      reason.includes("APIキー")), framework + ": encoded query must be rejected");
  }
  const step = site.pages.public.pageScripts[0].steps[0];
  if (step.kind !== "fetch") throw new Error("Expected fetch fixture");
  step.url = "https://public.example/data";
  step.method = "POST";
  step.body = '{"nested":{"password":"literal"}}';
  assert.ok(exportLimitations(site, "html").some((reason) => reason.includes("APIキー")),
    "nested JSON must be rejected");
  step.body = "mode=public&client%5Fsecret=literal";
  assert.ok(exportLimitations(site, "react").some((reason) => reason.includes("APIキー")),
    "URL-encoded body fields must be rejected");
  step.body = undefined;
  step.headers = [{ name: "Authorization", value: "Bearer {private}" }];
  assert.ok(exportLimitations(site, "html").length > 0,
    "browser exports must never accept Authorization headers");
  step.headers = [{ name: "Metadata-Flavor", value: "Google" }];
  assert.ok(exportLimitations(site, "html").length > 0,
    "metadata service headers must retain previous export restrictions");
  step.headers = [];
  step.url = "https://public.example/data?api_key=%7Bkey%7D";
  assert.deepEqual(exportLimitations(site, "html"), [],
    "pure variable placeholders are not literal credentials");
});

test("AUD-F-013: Next.js credential fetch stays in server files, not client-distributed assets", async () => {
  const { hasPublishCredentials } = await import("../lib/publish-security");
  const site = doc();
  const sentinel = "AUDIT_NOT_A_REAL_SECRET_SENTINEL_0529";
  site.pages.public.pageScripts = [{
    id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "fetch", kind: "fetch", as: "data",
      url: "https://public.example/private",
      headers: [{ name: "Authorization", value: "Bearer " + sentinel }] }],
  }];
  assert.equal(hasPublishCredentials(site), true,
    "GitHub Push must detect literal credential-like headers");
  const project = generateExportProject(site, "nextjs");
  assert.match(project.files["app/page.tsx"], /fetchPublic/,
    "existing authenticated server fetch behavior is preserved pending design approval");
  const publicSources = Object.entries(project.files)
    .filter(([path, content]) =>
      path.startsWith("public/") ||
      (path.startsWith("components/") && /^(?:"use client"|'use client')/.test(content)))
    .map(([path, content]) => path + ":\\n" + content)
    .join("\\n");
  assert.ok(!publicSources.includes(sentinel),
    "server-side fetch settings must not be duplicated into browser-distributed files");
});

test("AUD-F-014: generated filename components are bounded for portable ZIP extraction", async () => {
  const { assertGeneratedPaths } = await import("../lib/generator/output-paths");
  const { buildAssetNames } = await import("../lib/generator/names");
  const { exportDirectoryName } = await import("../lib/exportZip");
  const empty = { binaries: {}, remoteAssets: {} };
  for (const tooLong of ["a".repeat(256) + ".txt", "あ".repeat(86) + ".png"]) {
    assert.throws(() => assertGeneratedPaths({ ...empty, files: { [tooLong]: "data" } }),
      /Unsafe generated/, "filesystem segment longer than 255 bytes: " + tooLong.length);
  }
  const site = doc();
  site.assets["long"] = {
    id: "long", name: "A".repeat(500) + ".png", width: 1, height: 1,
    mimeType: "image/png", dataUrl: "data:image/png;base64,AQID",
  };
  const path = buildAssetNames(site).get("long")!;
  assert.ok(path.length <= 140, "asset path should leave room for unique suffixes");
  assert.match(path, /\.png$/);
  assert.doesNotThrow(() => generateExportProject(site, "html"));
  assert.ok(exportDirectoryName("A".repeat(1000)).length <= 96);
});

test("AUD-F-015: exported CSS contains untrusted style-map values as declarations only", async () => {
  const { safeCssDeclaration } = await import("../lib/css-declaration");
  assert.equal(safeCssDeclaration("color", "rebeccapurple"), "color: rebeccapurple;");
  assert.equal(safeCssDeclaration("WebkitLineClamp", "3"), "-webkit-line-clamp: 3;");
  assert.equal(safeCssDeclaration("--brand-color", "#abc"), "--brand-color: #abc;");
  assert.equal(safeCssDeclaration("fontFamily", '"A; B", sans-serif'),
    'font-family: "A; B", sans-serif;');
  for (const value of ["red; } body { display:none", '"</style><script>unsafe()</script>"',
    "rgb(1,2", "red/* unclosed", "red; background:black"]) {
    assert.equal(safeCssDeclaration("color", value), null);
  }
  assert.equal(safeCssDeclaration("color; } body {", "red"), null);

  const site = doc();
  site.nodes.visible.styles = { base: { default: {
    "color; } body {": "red",
    color: 'red; } body { --__AUDIT_CSS_BREAKOUT__: yes; } /*',
    backgroundImage: "url(data:image/png;base64,AQID)",
    fontFamily: '"A; B", sans-serif',
    WebkitLineClamp: "3",
    "--brand-color": "#abc",
  } } };
  site.nodes.visible.customCss = 'padding: 5px; border-radius: calc(2px + 1px);';
  site.pages.public.bodyStyles = { base: { default: {
    color: '"</style><script>window.__AUDIT_CSS_XSS__=1</script>"',
    margin: "12px",
  } } };
  site.pages.public.htmlBackground = 'red; } body { --__AUDIT_HTML_BACKGROUND_BREAKOUT__: yes; } /*';
  for (const format of ["nextjs", "html"] as const) {
    const project = generateExportProject(site, format);
    const css = project.files["styles/site.css"];
    assert.doesNotMatch(css, /__AUDIT_CSS_BREAKOUT__|__AUDIT_CSS_XSS__|__AUDIT_HTML_BACKGROUND_BREAKOUT__/);
    assert.match(css, /background-image: url\(data:image\/png;base64,AQID\);/);
    assert.match(css, /font-family: "A; B", sans-serif;/);
    assert.match(css, /-webkit-line-clamp: 3;/);
    assert.match(css, /--brand-color: #abc;/);
    assert.match(css, /padding: 5px;/);
    assert.match(css, /border-radius: calc\(2px \+ 1px\);/);
    assert.match(css, /margin: 12px;/);
  }
});

test("AUD-F-016: custom keyframes and motion settings cannot escape generated CSS", async () => {
  const { safeCssKeyframesBody } = await import("../lib/css-declaration");
  for (const good of ["from { opacity: 0; } to { opacity: 1; }",
    "0%, 30.5% { transform: translateX(0); } 100% { transform: translateX(1px); }",
    "/* start */ from { background: url(data:image/png;base64,AQID); }"]) {
    assert.equal(safeCssKeyframesBody(good), true, good);
  }
  for (const bad of ["from { opacity: 0; } } body { --__AUDIT_KF_BREAKOUT__: yes; } /*",
    "from { opacity:0;", "from { opacity:0; } @import url(x);",
    "body { color:red; }", 'from { content: "</style><script>x</script>"; }']) {
    assert.equal(safeCssKeyframesBody(bad), false, bad);
  }
  const site = doc();
  site.nodes.visible.motions = [
    { id: "valid", trigger: "load", keyframes: "custom",
      customKeyframes: "from { opacity: 0; } to { opacity: 1; }",
      duration: 1, delay: 0, easing: "ease" },
    { id: "broken", trigger: "load", keyframes: "custom",
      customKeyframes: "from { opacity: 0; } } body { --__AUDIT_KF_BREAKOUT__: yes; } /*",
      duration: 1, delay: 0, easing: "ease" },
    { id: "easing", trigger: "hover", keyframes: "fade-in",
      duration: 1, delay: 0, easing: "ease; } body { --__AUDIT_EASING_BREAKOUT__: yes; } /*" },
    { id: "transition", trigger: "state", property: "opacity, transform",
      duration: 0.2, delay: 0, easing: "ease" },
  ];
  const css = generateExportProject(site, "html").files["styles/site.css"];
  assert.match(css, /@keyframes anim-visible-valid/);
  assert.match(css, /transition: opacity, transform 0\.2s ease 0s;/);
  assert.doesNotMatch(css, /__AUDIT_KF_BREAKOUT__|__AUDIT_EASING_BREAKOUT__/);
});

test("AUD-F-017: Vue TypeScript CSS Modules has Vite ambient CSS module types", () => {
  const site = doc();
  const { files } = generateExportProject(site, {
    framework: "vue", language: "typescript", style: "css-modules", scope: "project",
  });
  assert.match(files["src/env.d.ts"], /reference types="vite\/client"/);
  assert.match(files["src/App.vue"], /import siteStyles from "\.\/site\.module\.css"/);
  assert.match(files["tsconfig.json"], /src\/\*\*\/\*\.ts/);
});
