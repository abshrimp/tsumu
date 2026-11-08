import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { readHtmlZip } from "../lib/html-zip";
import { generateProject } from "../lib/generator";
import { createInitialDoc } from "../lib/presets";

const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");

test("ZIP SVG image and sprite references follow uploaded assets through export", async () => {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  // Node adapters test the real ZIP importer/exporter, not native SVG rendering.
  Object.assign(globalThis, {
    DOMParser: class {
      parseFromString(html: string) {
        const root = parse(html);
        return { querySelectorAll: (selector: string) => root.querySelectorAll(selector), documentElement: root.querySelector("html") };
      }
    },
    Image: class {
      naturalWidth = 24; naturalHeight = 24; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    },
    fetch: async (_url: unknown, options: RequestInit) => {
      const file = (options.body as FormData).get("file") as File;
      return Response.json({ path: `assets/${file.name}` });
    },
  });
  try {
    const html = `<html><body><svg xmlns:xlink="http://www.w3.org/1999/xlink">
      <use id="namespaced" xlink:href="icons/sprite.svg#check"></use>
      <use id="modern" href="icons/sprite.svg#check"></use>
      <image id="photo" xlink:href="images/photo.svg?v=2#view"></image>
      <use id="local" xlink:href="#local-check"></use>
      <use id="external" xlink:href="https://example.test/icons.svg#check"></use>
      <use id="missing" xlink:href="missing.svg#check"></use>
    </svg></body></html>`;
    const sprite = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="check" viewBox="0 0 24 24"><path d="M2 12 9 19 22 3"/></symbol></svg>';
    const photo = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>';
    const zip = new JSZip().file("site/index.html", html).file("site/icons/sprite.svg", sprite).file("site/images/photo.svg", photo);
    const imported = await readHtmlZip(await zip.generateAsync({ type: "uint8array" }));
    const dom = parse(imported.html);
    const spriteAsset = imported.assets.find(a => a.zip?.path === "site/icons/sprite.svg")!;
    const photoAsset = imported.assets.find(a => a.zip?.path === "site/images/photo.svg")!;
    const proxy = (path: string) => `/api/assets/file?path=${encodeURIComponent(path)}`;
    assert.equal(dom.querySelector("#namespaced").getAttribute("xlink:href"), proxy(spriteAsset.path!) + "#check");
    assert.equal(dom.querySelector("#modern").getAttribute("href"), proxy(spriteAsset.path!) + "#check");
    assert.equal(dom.querySelector("#photo").getAttribute("xlink:href"), proxy(photoAsset.path!) + "&v=2#view");
    for (const [id, value] of [["local", "#local-check"], ["external", "https://example.test/icons.svg#check"], ["missing", "missing.svg#check"]]) {
      assert.equal(dom.querySelector(`#${id}`).getAttribute("xlink:href"), value);
    }
    const doc = createInitialDoc();
    doc.assets = Object.fromEntries(imported.assets.map(a => [a.id, a]));
    doc.pages[doc.pageOrder[0]].rawHtml = imported.html;
    const output = generateProject(doc);
    const route = output.files["app/route.ts"];
    const exported = parse(JSON.parse(/^const html = (.*);$/m.exec(route)![1]));
    const exportedPath = (source: string) => Object.entries(output.remoteAssets)
      .find(([, original]) => original === source)![0].replace(/^public/, "");
    assert.equal(exported.querySelector("#namespaced").getAttribute("xlink:href"), exportedPath(spriteAsset.path!) + "#check");
    assert.equal(exported.querySelector("#modern").getAttribute("href"), exportedPath(spriteAsset.path!) + "#check");
    assert.equal(exported.querySelector("#photo").getAttribute("xlink:href"), exportedPath(photoAsset.path!) + "?v=2#view");
    assert.equal(exported.querySelector("#local").getAttribute("xlink:href"), "#local-check");

  } finally {
    for (const key of ["DOMParser", "Image", "fetch"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
