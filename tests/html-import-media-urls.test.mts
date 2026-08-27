import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { assetUsage } from "../lib/asset-usage";
import { assetSrc, mediaSrc } from "../lib/assets";
import { convertHtmlFile } from "../lib/html-file-import";
import { parseSiteImport, restoreImportAssets } from "../lib/site-import";
import { exportProjectZip } from "../lib/exportZip";
import { buildAssetNames } from "../lib/generator/names";

const { parse } = createRequire(import.meta.url)("next/dist/compiled/node-html-parser");

// Adapt the parser to the inert DOM subset used by this no-CSS conversion.
// ZIP reading, conversion, asset restoration and export all use production code.
function parseDocument(html: string) {
  const cache = new WeakMap<object, any>();
  const wrap = (node: any): any => {
    if (!node) return node;
    if (cache.has(node)) return cache.get(node);
    const proxy = new Proxy(node, { get(target, key) {
      if (key === "style") {
        const declarations = (target.getAttribute?.("style") || "").split(";").map((part: string) => part.split(":"));
        const entries = declarations.filter((pair: string[]) => pair.length === 2);
        return { length: entries.length, item: (i: number) => entries[i][0],
          getPropertyValue: (name: string) => entries.find((pair: string[]) => pair[0] === name)?.[1] || "",
          getPropertyPriority: () => "" };
      }
      if (key === "attributes") return Object.entries(target.attributes).map(([name, value]) => ({ name, value }));
      if (key === "namespaceURI") return "http://www.w3.org/1999/xhtml";
      if (key === "childNodes") return target.childNodes.map(wrap);
      if (key === "children") return target.childNodes.filter((child: any) => child.nodeType === 1).map(wrap);
      if (key === "querySelector") return (selector: string) => wrap(target.querySelector(selector));
      if (key === "querySelectorAll") return (selector: string) => target.querySelectorAll(selector).map(wrap);
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    } });
    cache.set(node, proxy);
    return proxy;
  };
  const root = wrap(parse(html));
  return { head: root.querySelector("head"), body: root.querySelector("body"),
    title: root.querySelector("title")?.textContent || "",
    documentElement: root.querySelector("html"), querySelectorAll: root.querySelectorAll };
}

for (const local of [false, true]) test(`HTML ZIP preserves media URL suffixes with ${local ? "embedded" : "uploaded"} assets`, async () => {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  let uploads = 0, embed = local;
  const stored = new Map<string, File>();
  let download: Blob | undefined;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = blob => {
    download = blob;
    return createUrl(blob);
  };
  Object.assign(globalThis, {
    document: { createElement: () => ({ href: "", download: "", click() {} }) },
    DOMParser: class { parseFromString(html: string) { return parseDocument(html); } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    Image: class {
      naturalWidth = 12; naturalHeight = 8; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    },
    FileReader: class {
      result = ""; onload?: () => void;
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => {
        this.result = "data:" + blob.type + ";base64," + Buffer.from(bytes).toString("base64");
        this.onload?.();
      }); }
    },
    fetch: async (input: string, init?: RequestInit) => {
      if (input.startsWith("data:")) return originals.fetch.value(input, init);
      if (input.startsWith("/api/assets/file?")) {
        const file = stored.get(new URL(input, "https://import.test").searchParams.get("path")!);
        assert.ok(file);
        return new Response(file);
      }
      assert.equal(input, "/api/assets");
      assert.equal(init?.method, "POST");
      uploads++;
      if (!embed) stored.set("assets/upload-" + uploads, (init!.body as FormData).get("file") as File);
      return Response.json({ path: "assets/upload-" + uploads }, { status: embed ? 503 : 200 });
    },
  });
  try {
    const zip = new JSZip().file("index.html", `<!doctype html><html><head><title>Media suffixes</title></head><body>
    <img id="plain" src="view.svg" alt="Plain">
    <video id="plain-clip" src="clip.mp4"></video>
    <img id="view" src="view.svg?version=2#detail" alt="Detail">
    <video id="clip" src="clip.mp4?version=3#t=5,10" style="opacity:0.5;transform:translateX(12px)" controls></video>
    <audio id="sound"><source src="sound.mp3#t=2,4" type="audio/mpeg" media="(min-width: 600px)"><source src="clip.mp4#t=3" type="audio/mp4"></audio></body></html>`)
    .file("view.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><view id="detail" viewBox="0 0 6 4"/><rect width="12" height="8"/></svg>')
    .file("clip.mp4", "video fixture").file("sound.mp3", "audio fixture");

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const { doc, warnings } = await convertHtmlFile(new File([bytes], "site.zip"), { allPages: true });
    const plain = Object.values(doc.nodes).find(node => node.attrId === "plain")!;
    assert.equal(plain.type, "image");
    assert.ok(plain.image?.assetId);
    assert.equal(plain.image.src, "");
    const plainClip = Object.values(doc.nodes).find(node => node.attrId === "plain-clip")!;
    assert.equal(plainClip.type, "media");
    assert.ok(plainClip.media?.assetId);
    assert.equal(plainClip.media.src, "");
    const cases = [["view", "view.svg", "#detail", "&version=2"],
      ["clip", "clip.mp4", "#t=5,10", "&version=3"], ["sound", "sound.mp3", "#t=2,4", ""]];
    for (const [id, path, fragment, query] of cases) {
      const node = Object.values(doc.nodes).find(node => node.attrId === id)!;
      const asset = Object.values(doc.assets).find(asset => asset.zip?.path === path)!;
      assert.equal(node.type, id === "view" ? "image" : "media", id);
      const ref = node.image || node.media!.sources?.[0] || node.media!;
      assert.equal(ref.assetId, asset.id);
      assert.equal(ref.assetSuffix, (local || !query ? "" : "?" + query.slice(1)) + fragment);
      assert.equal(mediaSrc(doc, ref), assetSrc(asset) + (local ? "" : query) + fragment);
      assert.ok(assetUsage(doc).has(asset.id), path + " must remain in use");
    }
    assert.equal(Object.values(doc.nodes).find(node => node.attrId === "sound")!.media!.sources![0].type, "audio/mpeg");
    assert.ok(!warnings.some(message => message.includes("カスタムコード")));
    const clip = Object.values(doc.nodes).find(node => node.attrId === "clip")!;
    assert.equal(clip.styles.base.default.opacity, "0.5");
    assert.equal(clip.styles.base.default.transform, "translateX(12px)");
    assert.equal(clip.code, undefined);
    const sound = Object.values(doc.nodes).find(node => node.attrId === "sound")!;
    assert.equal(sound.media!.sources!.length, 2);
    assert.equal(sound.media!.sources![0].media, "(min-width: 600px)");
    assert.equal(sound.media!.sources![1].assetSuffix, "#t=3");
    assert.equal(uploads, 3);
    assert.equal(Object.keys(doc.assets).length, 3);
    for (const framework of ["html", "nextjs", "react", "vue", "nuxt", "sveltekit"] as const) {
      const before = structuredClone(doc);
      download = undefined;
      assert.deepEqual(await exportProjectZip(doc, framework), []);
      assert.ok(download);
      const archiveBytes = new Uint8Array(await (download as Blob).arrayBuffer());
      const archive = await JSZip.loadAsync(archiveBytes);
      const files = Object.values(archive.files).filter(entry => !entry.dir && !entry.name.includes("/_tsumu/"));
      const output = (await Promise.all(files.map(entry => entry.async("text")))).join("\n");
      assert.ok(!output.includes("/api/assets/file"), framework);
      if (framework === "html") {
        const page = files.find(entry => entry.name.endsWith("/index.html"))!;
        const html = parse(await page.async("text"));
        assert.equal(html.querySelectorAll("#clip").length, 1);
        assert.equal(html.querySelector("#clip").tagName, "VIDEO");
        assert.equal(html.querySelector("#clip").getAttribute("style"), undefined);
        assert.equal(html.querySelector("#sound").getAttribute("src"), undefined);
        assert.equal(html.querySelectorAll("#sound > source").length, 2);
        assert.equal(html.querySelector("#sound > source").getAttribute("type"), "audio/mpeg");
      }
      for (const [, path, fragment, query] of cases) {
        const asset = Object.values(doc.assets).find(asset => asset.zip?.path === path)!;
        const exported = "assets/" + buildAssetNames(doc).get(asset.id) +
          (!local && query ? "?" + query.slice(1) : "") + fragment;
        assert.ok(output.includes(exported), framework + ": " + exported);
      }
      const imported = await parseSiteImport(archiveBytes, "zip");
      assert.deepEqual(imported.doc, before, "editable source retains its asset identities and URLs");
      assert.deepEqual(doc, before, "export must not mutate the active document");
      assert.equal(imported.assets.size, 3);
      for (const asset of Object.values(doc.assets)) {
        assert.deepEqual(imported.assets.get(asset.id), await zip.file(asset.zip!.path)!.async("uint8array"));
      }
    }
    if (local) {
      embed = false;
      const { doc: restored } = await restoreImportAssets({ doc, assets: new Map(), warnings: [] });
      for (const [id, path, fragment] of cases) {
        const node = Object.values(restored.nodes).find(node => node.attrId === id)!;
        const asset = Object.values(restored.assets).find(asset => asset.zip?.path === path)!;
        assert.equal(mediaSrc(restored, node.image || node.media!.sources?.[0] || node.media!), assetSrc(asset) + fragment);
        assert.ok(assetUsage(restored).has(asset.id));
      }
    }
  } finally {
    URL.createObjectURL = createUrl;
    for (const key of ["document", "DOMParser", "Node", "Image", "FileReader", "fetch"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
