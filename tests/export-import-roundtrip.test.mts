import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { createInitialDoc } from "../lib/presets";
import { exportProjectZip } from "../lib/exportZip";
import { readRestorableArchive } from "../lib/url-site-import";

test("export ZIP includes an editable SiteDoc that can be imported again", async () => {
  const doc = createInitialDoc();
  doc.siteName = "Round-trip design";
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const timer = globalThis.setTimeout;
  let downloaded: Blob | undefined;
  let fileName = "";
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        href: "",
        set download(value: string) { fileName = value; },
        click() {},
      }),
    },
  });
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    if (blob instanceof Blob) downloaded = blob;
    return "blob:roundtrip";
  };
  URL.revokeObjectURL = () => {};
  (globalThis as typeof globalThis).setTimeout = ((callback: () => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    assert.deepEqual(await exportProjectZip(doc), []);
    assert.ok(downloaded);
    assert.match(fileName, /round-trip-design\.zip/);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const path = Object.keys(zip.files).find((name) => name.endsWith("/_tsumu/doc.json"));
    assert.ok(path);
    assert.deepEqual(JSON.parse(await zip.file(path)!.async("text")), doc);
    const restored = await readRestorableArchive(bytes);
    assert.equal(restored.doc.siteName, "Round-trip design");
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    globalThis.setTimeout = timer;
  }
});
