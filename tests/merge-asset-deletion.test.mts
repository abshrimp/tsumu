import assert from "node:assert/strict";
import { test } from "node:test";
import { assetSrc } from "../lib/assets";
import { validSiteDoc } from "../lib/doc-tree";
import { createDocPatch } from "../lib/doc-patch";
import { mergeDocs } from "../lib/merge";
import { makeBox, makeImage } from "../lib/presets";
import { useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Concurrent assets", pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: ["box"] } },
    nodes: { box: { ...makeBox(), id: "box" } },
    assets: Object.fromEntries(["shared-image", "unused-image"].map(id => [id, {
      id, name: `${id}.png`, mimeType: "image/png", width: 10, height: 10, path: `assets/${id}.png`,
    }])),
  };
}

for (const reverse of [false, true]) {
  test(`concurrent asset reuse survives ${reverse ? "local" : "remote"} deletion without restoring unused assets`, () => {
    const base = fixture();
    const reuse = structuredClone(base);
    reuse.nodes.image = { ...makeImage(), id: "image", image: {
      src: "", alt: "", width: 10, height: 10, assetId: "shared-image",
    } };
    reuse.pages.home.children.push("image");
    const deletion = { ...base, assets: {} };
    const originals = structuredClone([base, reuse, deletion]);
    assert.ok([base, reuse, deletion].every(validSiteDoc));
    const result = reverse ? mergeDocs(base, deletion, reuse) : mergeDocs(base, reuse, deletion);
    assert.ok(validSiteDoc(result), "the merged document must remain saveable");
    assert.equal(result.nodes.image.image?.assetId, "shared-image");
    assert.deepEqual(result.assets, { "shared-image": base.assets["shared-image"] });
    assert.deepEqual([base, reuse, deletion], originals, "merge must not modify history snapshots");
  });
}

test("concurrent site, page, media and secondary source references retain their assets", () => {
  for (const add of [
    (d: SiteDoc) => { d.favicon = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.appleTouchIcon = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.ogImage = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.pwa = { enabled: false, icon: { assetId: "shared-image" } }; },
    (d: SiteDoc) => { d.pages.home.ogImage = { assetId: "shared-image" }; },
    (d: SiteDoc) => { d.nodes.box.media = { kind: "video", src: "", assetId: "shared-image" }; },
    (d: SiteDoc) => { d.nodes.box.media = { kind: "video", src: "", sources: [{ src: "", assetId: "shared-image" }] }; },
  ]) {
    const base = fixture(), local = structuredClone(base);
    add(local);
    assert.ok(validSiteDoc(local));
    const result = mergeDocs(base, local, { ...base, assets: {} });
    assert.ok(validSiteDoc(result));
    assert.deepEqual(Object.keys(result.assets), ["shared-image"]);
  }
});

test("CSS URLs and imported HTML retain deleted assets and their ZIP stylesheet dependencies", () => {
  const base = fixture();
  base.assets.stylesheet = {
    id: "stylesheet", name: "main.css", width: 0, height: 0, mimeType: "text/css",
    zip: { version: 1, group: "import", path: "main.css", stylesheet: {
      source: "body { background: url(image.png) }",
      references: [{ url: "image.png", assetId: "shared-image", suffix: "" }],
    } },
  };
  for (const add of [
    (d: SiteDoc) => { d.nodes.box.styles = { base: { default: { backgroundImage: `url('${assetSrc(base.assets["shared-image"])}#icon')` } } }; },
    (d: SiteDoc) => { d.pages.home.rawHtml = '<link href="tsumu-zip-css:stylesheet">'; },
  ]) {
    const local = structuredClone(base);
    add(local);
    const result = mergeDocs(base, local, { ...base, assets: {} });
    assert.ok(validSiteDoc(result));
    assert.ok(result.assets["shared-image"]);
    assert.equal(result.assets["unused-image"], undefined);
    if (local.pages.home.rawHtml) assert.ok(result.assets.stylesheet);
  }
});

test("asset deletion still wins when neither surviving document references it", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.nodes.box.name = "Unrelated edit";
  const result = mergeDocs(base, local, { ...base, assets: {} });
  assert.deepEqual(result.assets, {});
  assert.equal(result.nodes.box.name, "Unrelated edit");
  assert.ok(validSiteDoc(result));
});

test("Undo before an upload retains an asset newly referenced by a collaborator's node patch", () => {
  const original = fixture();
  original.assets = {};
  useEditor.getState().replaceDoc(original);
  useEditor.getState().updateDoc(doc => { doc.assets = fixture().assets; });
  const base = useEditor.getState().doc;
  const updated = structuredClone(base);
  updated.nodes.box.styles = { base: { default: {
    backgroundImage: `url('${assetSrc(base.assets["shared-image"])}')`,
  } } };
  useEditor.getState().applyRemoteDoc(updated, { baseDoc: base, patch: createDocPatch(base, updated)! });
  useEditor.getState().undo();
  const result = useEditor.getState().doc;
  assert.ok(validSiteDoc(result));
  assert.deepEqual(result.nodes.box.styles, updated.nodes.box.styles);
  assert.deepEqual(Object.keys(result.assets), ["shared-image"]);
});
