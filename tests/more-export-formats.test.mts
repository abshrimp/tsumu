import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject, prepareExportProject, exportLimitations } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const fixture = (): SiteDoc => ({
  siteName: "Example site",
  pageOrder: ["home"],
  pages: {
    home: {
      id: "home", name: "Home", slug: "", title: "Home", description: "Description",
      children: ["heading"],
    },
  },
  nodes: {
    heading: { ...makeBox(), id: "heading", text: { content: "Example heading", heading: 1 } },
  },
  assets: {},
});

test("HTML export retains imported classes and safe attributes without importing event handlers", () => {
  const doc = fixture();
  doc.nodes.heading.htmlClass = "external-heading";
  doc.nodes.heading.htmlAttrs = {
    "data-source": "imported",
    "aria-label": "Imported heading",
    "title": "Original {literal}",
    "tabIndex": "3",
    "onmouseover": "alert(1)",
    "data-tsumu-scripts": "untrusted",
  };
  const html = generateExportProject(doc, "html").files["index.html"];
  assert.match(html, /class="[^"]*external-heading/);
  assert.match(html, /data-source="imported"/);
  assert.match(html, /aria-label="Imported heading"/);
  assert.match(html, /title="Original \{literal\}"/);
  assert.match(html, /tabindex="3"/);
  assert.doesNotMatch(html, /onmouseover|data-tsumu-scripts/);
});

test("single HTML mode contains one index.html without build tooling", async () => {
  const result = await prepareExportProject(fixture(), "single-html");
  assert.deepEqual(Object.keys(result.files), ["index.html"]);
  assert.deepEqual(result.binaries, {});
  assert.deepEqual(result.remoteAssets, {});
  assert.match(result.files["index.html"], /Example heading/);
  assert.match(result.files["index.html"], /<style>/);
  assert.match(result.files["index.html"], /<script[^>]*src="data:text\/javascript;base64,/i);
  assert.doesNotMatch(result.files["index.html"], /<script[^>]*\bsrc=["'](?!data:)/);
  assert.doesNotMatch(result.files["index.html"], /<link[^>]*rel="stylesheet"/);
  assert.doesNotMatch(result.files["index.html"], /tsumu/i);
});

test("single HTML inlines local media, CSS backgrounds and script source", async () => {
  const file = await toSingleHtmlProject({
    files: {
      "index.html": [
        '<!doctype html><html><head><link rel="stylesheet" href="./styles/site.css"></head>',
        '<body><img src="./assets/logo.png"><script defer src="./main.js"></script></body></html>',
      ].join(""),
      "styles/site.css": '.logo { background-image: url("../assets/logo.png"); }',
      "main.js": "window.scriptIsInline = true;",
    },
    binaries: { "assets/logo.png": "iVBORw0KGgo=" },
    remoteAssets: {},
  });
  const html = file.files["index.html"];
  assert.deepEqual(Object.keys(file.files), ["index.html"]);
  assert.ok((html.match(/data:image\/png;base64,/g) || []).length >= 2);
  assert.match(html, /<style>/);
  const script = html.match(/<script[^>]*src="data:text\/javascript;base64,([^"]+)"/);
  assert.ok(script);
  assert.equal(atob(script[1]), "window.scriptIsInline = true;");
  assert.doesNotMatch(html, /src="\.\/assets\/logo.png"|href="\.\/styles\/site.css"|src="\.\/main.js"/);
});

test("single HTML inlines fetched remote stored assets without leaking their source IDs", async () => {
  const requests: string[] = [];
  const result = await toSingleHtmlProject({
    files: {
      "index.html": '<!doctype html><html><head></head><body><img src="./assets/photo.webp"></body></html>',
    },
    binaries: {},
    remoteAssets: { "assets/photo.webp": "assets/internal-key" },
  }, async (url) => {
    requests.push(url);
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 200, headers: { "Content-Type": "image/webp" },
    });
  });
  assert.deepEqual(requests, ["/api/assets/file?path=assets%2Finternal-key"]);
  assert.match(result.files["index.html"], /data:image\/webp;base64,AQID/);
  assert.doesNotMatch(result.files["index.html"], /internal-key/);
  assert.equal(Object.keys(result.files).length, 1);
});

test("single HTML cancels oversized asset streams even when Content-Length is absent", async () => {
  let pulls = 0;
  let cancellations = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
    },
    cancel() { cancellations++; },
  }), { status: 200, headers: { "Content-Type": "image/png" } });
  await assert.rejects(
    toSingleHtmlProject({
      files: { "index.html": '<html><body><img src="./assets/large.png"></body></html>' },
      binaries: {}, remoteAssets: { "assets/large.png": "assets/remote-id" },
    }, async () => response),
    /Resource exceeds single HTML size limit/,
  );
  assert.equal(cancellations, 1, "the excessive stream must be cancelled");
  assert.ok(pulls <= 9, "the remote resource must not be buffered completely");
});

test("single HTML checks a declared oversized asset before reading it", async () => {
  let reads = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull() { reads++; },
  }), { headers: { "Content-Length": String(49 * 1024 * 1024) } });
  await assert.rejects(
    toSingleHtmlProject({
      files: { "index.html": '<html><body><img src="./assets/large.png"></body></html>' },
      binaries: {}, remoteAssets: { "assets/large.png": "assets/remote-id" },
    }, async () => response),
    /Resource exceeds single HTML size limit/,
  );
  // The stream can be pulled once by the Response constructor, but not consumed.
  assert.ok(reads <= 1);
});

test("single HTML fails explicitly rather than retaining a CORS-blocked remote image", async () => {
  await assert.rejects(
    toSingleHtmlProject({
      files: { "index.html": '<html><body><img src="https://cdn.example.test/photo.png"></body></html>' },
      binaries: {}, remoteAssets: {},
    }, async () => { throw new TypeError("CORS blocked"); }),
    /CORS|import it as a local asset/i
  );
});

test("single HTML does not silently discard pages with different fixed URLs", () => {
  const doc = fixture();
  doc.pages.about = { ...doc.pages.home, id: "about", slug: "about" };
  doc.pageOrder.push("about");
  assert.ok(exportLimitations(doc, "single-html").some((m) => m.includes("1ページ")));
  assert.throws(() => generateExportProject(doc, "single-html"), /1ページ/);
  const current = {
    framework: "single-html" as const, language: "javascript" as const,
    style: "css" as const, scope: "page" as const, pageId: "about",
  };
  assert.deepEqual(exportLimitations(doc, current), []);
});

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  test(framework + " produces native build files and browser runtime without a Next.js project", () => {
    const result = generateExportProject(fixture(), framework);
    assert.ok(result.files["package.json"]);
    assert.ok(result.files["README.md"]);
    assert.equal(result.files["next.config.mjs"], undefined);
    assert.equal(result.files["app/page.tsx"], undefined);
    const root = framework === "sveltekit" ? "static" : "public";
    assert.equal(result.files[root + "/data-loader.js"], undefined);
    assert.equal(result.files[root + "/browser-start.js"], undefined);
    if (framework === "nuxt") {
      assert.equal(result.files["app/browser-start.js"], undefined);
      assert.equal(result.files["app/site-routes.js"], undefined);
    } else if (framework === "sveltekit") {
      assert.equal(result.files["src/browser-start.js"], undefined);
      assert.equal(result.files["src/site-routes.js"], undefined);
    }
    assert.match(result.files[framework === "nuxt" ? "app/generated/site-data.js" :
      framework === "vue" ? "src/site-data.js" : "src/lib/site-data.js"], /loadPageData/);
    assert.match(result.files[root + "/scripts.js"], /__pageDataReady/);
    if (framework === "vue") {
      assert.match(result.files["src/pages/Page0.vue"], /<h1/);
      assert.doesNotMatch(result.files["src/App.vue"], /v-html/);
      assert.match(result.files["vite.config.ts"], /plugin-vue/);
      assert.match(result.files["package.json"], /"vue"/);
    } else if (framework === "nuxt") {
      assert.match(result.files["app/generated/pages/Page0.vue"], /<h1/);
      assert.doesNotMatch(result.files["app/app.vue"], /v-html/);
      assert.match(result.files["nuxt.config.ts"], /ssr: true/);
      assert.match(result.files["app/pages/index.vue"], /useAsyncData/);
      assert.match(result.files["package.json"], /"nuxt"/);
    } else {
      assert.match(result.files["src/lib/pages/Page0.svelte"], /<h1/);
      assert.doesNotMatch(result.files["src/routes/+page.svelte"], /@html html/);
      assert.match(result.files["vite.config.ts"], /adapter-node/);
      assert.equal(result.files["svelte.config.js"], undefined);
      assert.match(result.files["package.json"], /"@sveltejs\/kit": "\^3/);
      assert.doesNotMatch(result.files["package.json"], /adapter-static|@sveltejs\/kit": "\^2/);
      assert.match(result.files["vite.config.ts"], /adapter-node/);
      assert.equal(result.files["src/routes/+layout.ts"].includes("ssr = true"), true);
      assert.match(result.files["src/routes/+page.server.js"], /loadPageData/);
      assert.match(result.files["package.json"], /"@sveltejs\/kit"/);
    }
    for (const [path, content] of Object.entries(result.files)) {
      if (/\.md$/i.test(path)) continue;
      assert.doesNotMatch(content, /tsumu/i, framework + " " + path);
    }
  });

  test(framework + " supports JS mode and CSS Modules and Tailwind styles", () => {
    const options = { framework, language: "javascript" as const, scope: "project" as const };
    const js = generateExportProject(fixture(), { ...options, style: "css" });
    const root = framework === "nuxt" ? "app/generated/" :
      framework === "sveltekit" ? "src/lib/" : "src/";
    assert.ok(js.files[root + "site-routes.js"]);
    assert.equal(js.files[root + "site-routes.ts"], undefined);
    const modules = generateExportProject(fixture(), { ...options, style: "css-modules" });
    assert.ok(modules.files[framework === "nuxt" ? "app/assets/site.module.css" : "src/site.module.css"]);
    const tailwind = generateExportProject(fixture(), { ...options, style: "tailwind" });
    assert.match(tailwind.files["package.json"], /tailwindcss/);
  });

  test(framework + " supports URL query parameters without a dynamic server path", () => {
    const doc = fixture();
    doc.pages.home.query = "tab=default";
    doc.pages.variant = { ...doc.pages.home, id: "variant", title: "Variant", query: "tab=2" };
    doc.pageOrder.push("variant");
    assert.deepEqual(exportLimitations(doc, framework), []);
    const result = generateExportProject(doc, framework);
    const path = framework === "nuxt" ? "app/generated/site-routes.js" :
      framework === "sveltekit" ? "src/lib/site-routes.js" : "src/site-routes.js";
    assert.match(result.files[path], /"tab":"2"/);
    assert.match(result.files[path], /URLSearchParams/);
    doc.pages.home.slug = "[slug]";
    assert.ok(exportLimitations(doc, framework).some((m) => m.includes("[slug]")));
  });
}
