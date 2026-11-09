import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { generateExportProject, prepareExportProject } from "../lib/export-formats";
import { toSingleHtmlProject } from "../lib/generator/single-html";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

const require = createRequire(import.meta.url);
const { parse } = require("next/dist/compiled/node-html-parser");
const source = "/api/assets/file?path=assets%2Fprivate-photo.png";
const inline = "data:image/png;base64,AQID";

function fixture(): SiteDoc {
  return {
    siteName: "Embedded assets", pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", title: "Home", description: "", slug: "guide/details", children: ["code", "icon"] } },
    nodes: {
      code: { ...makeBox(), id: "code", type: "code", code: { html:
        `<img id="remote" src="${source}&amp;v=1#photo">` +
        `<img id="inline" src="${inline}">` +
        `<div id="background" style="background-image:url(&quot;${source}&quot;)">Literal {value} &amp; text</div>` } },
      icon: { ...makeBox(), id: "icon", type: "icon", icon: { name: "picture", svg:
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">` +
        `<image id="svg-image" href="${source}#picture" />` +
        `<image id="svg-xlink" xlink:href="${source}#picture" /></svg>` } },
    },
    assets: {
      remote: { id: "remote", name: "photo.png", path: "assets/private-photo.png", mimeType: "image/png", width: 1, height: 1 },
      inline: { id: "inline", name: "photo.png", dataUrl: inline, mimeType: "image/png", width: 1, height: 1 },
    },
  };
}

async function pageMarkup(files: Record<string, string>, framework: string, language: string): Promise<string> {
  if (framework === "nextjs" || framework === "react") {
    const path = framework === "nextjs" ? "app/guide/details/page" : "src/pages/Page0";
    const code = transformSync(files[path + (language === "typescript" ? ".tsx" : ".jsx")], {
      loader: "tsx", format: "cjs", jsx: "automatic",
    }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)(require, module, module.exports);
    return renderToStaticMarkup(await module.exports.default({ searchParams: Promise.resolve({}) }));
  }
  const path = framework === "vue" ? "src/pages/Page0.vue"
    : framework === "nuxt" ? "app/generated/pages/Page0.vue" : "src/lib/pages/Page0.svelte";
  // These constants are the exact HTML passed to v-html / {@html}; evaluate
  // the emitted literals to check runtime values, including SFC escaping.
  return [...files[path].matchAll(/const rawBlock\d+ = ("(?:\\.|[^"\\])*");/g)]
    .map(match => JSON.parse(match[1])).join("\n");
}

function assertMarkup(html: string, prefix: string, remote = "photo.png", embedded = "photo-2.png") {
  const tree = parse(html);
  assert.equal(tree.querySelector("#remote")?.getAttribute("src"), prefix + `assets/${remote}?v=1#photo`);
  assert.equal(tree.querySelector("#inline")?.getAttribute("src"), prefix + `assets/${embedded}`);
  assert.equal(tree.querySelector("#svg-image")?.getAttribute("href"), prefix + `assets/${remote}#picture`);
  assert.equal(tree.querySelector("#svg-xlink")?.getAttribute("xlink:href"), prefix + `assets/${remote}#picture`);
  assert.equal(tree.querySelector("#background")?.getAttribute("style"), `background-image:url("${prefix}assets/${remote}")`);
  assert.equal(tree.querySelector("#background")?.textContent, "Literal {value} & text");
  assert.doesNotMatch(html, /\/api\/assets\/file|private-photo/);
}

for (const framework of ["nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
  for (const language of ["typescript", "javascript"] as const) {
    for (const style of ["css", "css-modules", "tailwind"] as const) {
      test(`${framework} ${language} ${style} embeds exported asset URLs in code and SVG`, async () => {
        const doc = fixture(), before = structuredClone(doc);
        const project = await prepareExportProject(doc, { framework, language, style, scope: "page", pageId: "p" });
        const root = framework === "sveltekit" ? "static/" : "public/";
        // Scoped asset discovery may change collision suffix assignment; the
        // URLs must point to the correct bytes in the resulting resource map.
        const [remote] = Object.keys(project.remoteAssets);
        const [embedded] = Object.keys(project.binaries);
        assert.ok(remote.startsWith(root + "assets/"));
        assert.ok(embedded.startsWith(root + "assets/"));
        assert.notEqual(remote, embedded);
        assert.equal(project.remoteAssets[remote], "assets/private-photo.png");
        assert.equal(project.binaries[embedded], "AQID");
        assertMarkup(await pageMarkup(project.files, framework, language), "/", remote.split("/").at(-1), embedded.split("/").at(-1));
        assert.deepEqual(doc, before);
      });
    }
  }
}

test("nested HTML code and SVG use relative exported asset URLs", () => {
  const doc = fixture();
  doc.pages.home = { ...doc.pages.p, id: "home", slug: "", children: [] };
  doc.pageOrder.unshift("home");
  const project = generateExportProject(doc, "html");
  assertMarkup(project.files["guide/details/index.html"], "../../");
});

test("React browser-data rendering keeps embedded assets portable", async () => {
  const doc = fixture();
  doc.nodes.live = { ...makeBox(), id: "live", text: { content: "Hello {visitor}", heading: 0 } };
  doc.pages.p.children.push("live");
  doc.pages.p.pageScripts = [{ id: "load", trigger: "load", pos: { x: 0, y: 0 },
    steps: [{ id: "visitor", kind: "set-var", into: "visitor", value: "Guest" }] }];
  const project = await prepareExportProject(doc, "react");
  assert.ok(project.files["public/data-loader.js"]);
  assertMarkup(await pageMarkup(project.files, "react", "typescript"), "/");
});

test("single HTML embeds code and SVG assets from the exported resource map", async () => {
  const doc = fixture();
  doc.pages.p.slug = "";
  const requests: string[] = [];
  const project = await toSingleHtmlProject(generateExportProject(doc, "single-html"), async (url) => {
    requests.push(String(url));
    assert.equal(url, source);
    return new Response(Uint8Array.from([4, 5, 6]), { headers: { "Content-Type": "image/png" } });
  });
  const tree = parse(project.files["index.html"]);
  assert.match(tree.querySelector("#remote").getAttribute("src"), /^data:image\/png;base64,BAUG/);
  assert.equal(tree.querySelector("#inline").getAttribute("src"), inline);
  assert.match(tree.querySelector("#svg-image").getAttribute("href"), /^data:image\/png;base64,BAUG/);
  assert.match(tree.querySelector("#svg-xlink").getAttribute("xlink:href"), /^data:image\/png;base64,BAUG/);
  assert.match(tree.querySelector("#background").getAttribute("style"), /data:image\/png;base64,BAUG/);
  assert.deepEqual(requests, [source]);
  assert.deepEqual(Object.keys(project.files), ["index.html"]);
  assert.deepEqual(project.remoteAssets, {});
});
