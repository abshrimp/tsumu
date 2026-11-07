import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import {
  parseRestoredDoc, readRestorableArchive, readRestorableJson,
  restoreAssets, recoverPublicAssetBytes, SOURCE_LIMIT, ZIP_ENTRY_LIMIT,
} from "../lib/url-site-import";

const doc = (): SiteDoc => ({
  siteName: "Restored document",
  pages: { home: { id: "home", name: "Home", title: "Home", slug: "",
    description: "", children: ["picture"] } },
  pageOrder: ["home"],
  nodes: {
    picture: {
      ...makeBox(), id: "picture", type: "image",
      image: { src: "/api/assets/file?path=assets%2Fold.png", assetId: "cover",
        alt: "Cover", width: 1, height: 1 },
    },
  },
  assets: { cover: { id: "cover", name: "cover.png", path: "assets/old.png",
    mimeType: "image/png", width: 1, height: 1 } },
});

async function archive(d: SiteDoc, includeAsset = true): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("website/_tsumu/doc.json", JSON.stringify(d));
  if (includeAsset) zip.file("website/public/assets/cover.png", Uint8Array.of(137, 80, 78, 71));
  return zip.generateAsync({ type: "uint8array" });
}

test("ZIP site archive loads the editable doc and maps exported assets to the original IDs", async () => {
  const d = doc();
  const data = await readRestorableArchive(await archive(d));
  assert.equal(data.folder, "website/");
  assert.deepEqual(data.doc, d);
  assert.deepEqual([...data.assets.keys()], ["cover"]);
  const { doc: restored, warnings } = await restoreAssets(data.doc, data.assets,
    async (file) => {
      assert.equal(file.name, "cover.png");
      return { id: "brand-new-asset-id", name: file.name, path: "assets/imported.png",
        width: 1, height: 1, mimeType: file.type, bytes: file.size };
    });
  assert.equal(restored.assets.cover.id, "cover");
  assert.equal(restored.assets.cover.path, "assets/imported.png");
  assert.equal(restored.nodes.picture.image!.assetId, "cover");
  assert.equal(restored.nodes.picture.image!.src,
    "/api/assets/file?path=assets%2Fimported.png");
  assert.deepEqual(warnings, []);
});

test("restores standalone JSON with data URLs even without ZIP assets", async () => {
  const d = doc();
  delete d.assets.cover.path;
  d.assets.cover.dataUrl = "data:image/png;base64,AAAA";
  const snapshot = await readRestorableJson(new TextEncoder().encode(JSON.stringify(d)));
  const { doc: restored, warnings } = await restoreAssets(snapshot.doc, snapshot.assets,
    async () => { throw new Error("must not upload"); });
  assert.equal(restored.assets.cover.dataUrl, d.assets.cover.dataUrl);
  assert.deepEqual(warnings, []);
});

test("missing assets do not prevent import, but return warning unless original path is accessible", async () => {
  const snapshot = await readRestorableArchive(await archive(doc(), false));
  const missing = await restoreAssets(snapshot.doc, snapshot.assets,
    async () => { throw new Error("should not upload"); });
  assert.equal(missing.warnings.length, 1);
  assert.equal(missing.doc.nodes.picture.image!.assetId, "cover");
  const accessible = await restoreAssets(snapshot.doc, snapshot.assets,
    async () => { throw new Error("should not upload"); },
    async () => true);
  assert.deepEqual(accessible.warnings, []);
});

test("rejects malicious prototype keys, malformed doc and missing embedded document", async () => {
  assert.throws(() => parseRestoredDoc('{"pages":{"__proto__":1}}'), /使用できない/);
  assert.throws(() => parseRestoredDoc('{"pages":{}}'), /編集データ/);
  const zip = new JSZip();
  zip.file("index.html", "<h1>Site</h1>");
  await assert.rejects(readRestorableArchive(await zip.generateAsync({ type: "uint8array" })),
    /_tsumu\/doc.json/);
});

test("rejects oversized URL sources and ZIP entry count before attempting asset uploads", async () => {
  await assert.rejects(readRestorableArchive(new Uint8Array(SOURCE_LIMIT + 1)), /5MB/);
  const zip = new JSZip();
  zip.file("_tsumu/doc.json", JSON.stringify(doc()));
  for (let i = 0; i <= ZIP_ENTRY_LIMIT; i++) zip.file("assets/" + i + ".txt", "a");
  await assert.rejects(readRestorableArchive(await zip.generateAsync({ type: "uint8array" })),
    /350/);
});

test("supports the newer neutral metadata directory in addition to legacy archives", async () => {
  const zip = new JSZip();
  zip.file("_site-data/doc.json", JSON.stringify(doc()));
  const parsed = await readRestorableArchive(await zip.generateAsync({ type: "uint8array" }));
  assert.equal(parsed.doc.siteName, "Restored document");
});

test("remote image URLs are recovered when ZIP or JSON lacks an asset", async () => {
  const d = doc();
  d.nodes.picture.image!.src = "https://cdn.example.test/images/cover.png";
  const fetched: string[] = [];
  const files = await recoverPublicAssetBytes(d, new Map(), async (url) => {
    fetched.push(url);
    return Uint8Array.of(1, 2, 3);
  });
  assert.deepEqual(fetched, ["https://cdn.example.test/images/cover.png"]);
  assert.deepEqual([...files.get("cover")!], [1, 2, 3]);
  const saved = await restoreAssets(d, files, async () => ({
    id: "another-id", name: "cover.png", mimeType: "image/png",
    bytes: 3, width: 1, height: 1, path: "assets/recovered.png",
  }));
  assert.deepEqual(saved.warnings, []);
  assert.equal(saved.doc.assets.cover.id, "cover");
  assert.equal(saved.doc.assets.cover.path, "assets/recovered.png");
});
