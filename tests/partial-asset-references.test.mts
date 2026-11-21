import { test } from "node:test";
import assert from "node:assert/strict";
import { generateExportProject, prepareExportScopeDoc } from "../lib/export-formats";
import { buildAssetNames } from "../lib/generator/names";
import { makeBox } from "../lib/presets";
import type { Asset, SiteDoc } from "../lib/types";

function image(id: string, name: string): Asset {
  return { id, name, mimeType: "image/png", width: 1, height: 1, dataUrl: "data:image/png;base64," + Buffer.from(id).toString("base64") };
}

function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Scoped artwork", pageOrder: ["p"], pages: {
      p: { id: "p", name: "Home", title: "Home", slug: "", description: "", children: ["instance", "rows"],
        pageScripts: [{ id: "data", trigger: "load", steps: [{
          id: "init", kind: "set-var", into: "items", value: JSON.stringify([{ image: "/assets/art.png", caption: "Example: /assets/unused.png", "/assets/unused.png": "a key" }]),
        }] }] },
    },
    components: { card: { id: "card", name: "Card", rootId: "master" } },
    nodes: {
      instance: { ...makeBox(), id: "instance", type: "instance", componentId: "card" },
      master: { ...makeBox(), id: "master", styles: { base: { default: { backgroundImage: 'url("/assets/card-photo-2.png")' } } },
        motions: [{ id: "motion", trigger: "load", keyframes: "custom", duration: 1, delay: 0, easing: "linear",
          customKeyframes: 'from{background-image:url("/assets/motion.png")}to{opacity:1}' }] },
      rows: { ...makeBox(), id: "rows", type: "list", list: { from: "items" }, children: ["picture"] },
      picture: { ...makeBox(), id: "picture", type: "image", image: { src: "{image}", alt: "Artwork", width: 1, height: 1 } },
    },
    assets: {
      first: image("first", "card photo.png"), second: image("second", "card photo.png"),
      art: image("art", "art.png"), motion: image("motion", "motion.png"), unused: image("unused", "unused.png"),
    },
  };
}

test("page and component exports keep files referenced in shared-component styles, animation CSS and structured script data", async () => {
  const doc = fixture();
  const full = generateExportProject(doc, "html");
  for (const scope of ["page", "component"] as const) {
    const opts = { scope, pageId: "p", nodeId: "instance", framework: "html", style: "css", language: "javascript" } as const;
    const scoped = await prepareExportScopeDoc(doc, opts);
    const files = generateExportProject(doc, opts);
    const expected = ["assets/card-photo-2.png", "assets/motion.png", ...(scope === "page" ? ["assets/art.png"] : [])].sort();
    assert.deepEqual(Object.keys(files.binaries).sort(), expected);
    for (const path of expected) assert.equal(files.binaries[path], full.binaries[path]);
    assert.match(files.files["styles/site.css"], /url\("\.\.\/assets\/card-photo-2\.png"\)/);
    assert.match(files.files["styles/site.css"], /url\("\.\.\/assets\/motion\.png"\)/);
    assert.equal(scoped.assets.second.name, "card photo.png");
    const reopened = JSON.parse(JSON.stringify(scoped)) as SiteDoc;
    assert.equal(buildAssetNames(reopened).get("second"), "card-photo-2.png");
    assert.deepEqual(Object.keys(generateExportProject(reopened, "html").binaries).sort(), expected);
  }
  assert.equal(doc.assets.second.exportSuffix, undefined);
});

test("scoping the first of two identical public names retains just that file", async () => {
  const doc = fixture();
  doc.assets.first.name = doc.assets.second.name = "same.png";
  doc.assets.second.path = "assets/same.png";
  doc.nodes.master.styles.base.default!.backgroundImage = 'url("/assets/same.png")';
  const scoped = await prepareExportScopeDoc(doc, { scope: "component", pageId: "p", nodeId: "instance", framework: "html", style: "css", language: "javascript" });
  assert.deepEqual(Object.keys(scoped.assets).sort(), ["first", "motion"]);
});

test("custom keyframes referring to an editor asset URL use the exported path", () => {
  const doc = fixture();
  doc.assets.motion.path = "assets/stored-motion.png";
  delete doc.assets.motion.dataUrl;
  doc.nodes.master.motions![0].customKeyframes = 'from{background-image:url("/api/assets/file?path=assets%2Fstored-motion.png")}to{opacity:1}';
  const opts = { scope: "component", pageId: "p", nodeId: "instance", framework: "html", style: "css", language: "javascript" } as const;
  const project = generateExportProject(doc, opts);
  assert.deepEqual(Object.keys(project.remoteAssets), ["assets/motion.png"]);
  assert.match(project.files["styles/site.css"], /url\("\.\.\/assets\/motion\.png"\)/);
  assert.doesNotMatch(project.files["styles/site.css"], /\/api\/assets\/file/);
});


test("ZIP dependencies added asynchronously retain their public names without pulling in same-name siblings", async () => {
  const doc = fixture();
  function module(id: string, name: string, path: string, code: string): Asset {
    return { id, name, width: 0, height: 0, mimeType: "text/javascript",
      dataUrl: "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
      zip: { version: 1, group: "pack", path },
    };
  }
  doc.assets.unrelated = module("unrelated", "shared.js", "unused.js", "export default 0;");
  doc.assets.needed = module("needed", "shared.js", "parts/value.js", "export default 7;");
  doc.assets.entry = module("entry", "main.js", "main.js", 'import value from "./parts/value.js"; console.log(value);');
  doc.pages.p.customEndHtml = `<script type="module" src="${doc.assets.entry.dataUrl}"></script>`;
  const opts = { scope: "page", pageId: "p", framework: "html", style: "css", language: "javascript" } as const;
  const scoped = await prepareExportScopeDoc(doc, opts);
  assert.equal(scoped.assets.unrelated, undefined);
  assert.equal(scoped.assets.needed.name, "shared.js");
  assert.equal(buildAssetNames(scoped).get("needed"), "shared-2.js");
  const { binaries } = generateExportProject(scoped, "html");
  assert.equal(binaries["assets/shared-2.js"], Buffer.from("export default 7;").toString("base64"));
  assert.equal(binaries["assets/shared.js"], undefined);
  assert.equal(doc.assets.needed.exportSuffix, undefined);
});
