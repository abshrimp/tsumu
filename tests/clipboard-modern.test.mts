import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload, clipboardPayload, clipHtml, parseClipPayload, writeClipPayload } from "../lib/clip-transfer";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture() {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "コピー", pageOrder: ["p"], assets: {},
    pages: { p: { id: "p", name: "Home", title: "", slug: "", description: "", children: ["n"] } },
    nodes: { n: { ...makeBox(), id: "n", text: { content: "利用者 <確認>", heading: 0 } } },
  };
  return buildClipPayload(doc, { nodes: [doc.nodes.n], rootIds: ["n"] });
}

test("clipboard HTML round-trips structured content through a standard MIME type", () => {
  const payload = fixture();
  const html = clipHtml(payload);
  assert.match(html, /data-tsumu-clipboard=/);
  assert.match(html, /利用者 &lt;確認&gt;/);
  const data = { getData: (type: string) => type === "text/html" ? "<html><body>" + html + "</body></html>" : "" };
  assert.deepEqual(clipboardPayload(data), payload);
  assert.equal(clipboardPayload({ getData: () => "<span data-tsumu-clipboard=\"%invalid\"></span>" }), null);
  assert.equal(clipboardPayload({ getData: () => "<span>Ordinary HTML</span>" }), null);
  assert.equal(clipboardPayload({ getData: () => "a".repeat(48 * 1024 * 1024 + 1) }), null);
});

test("clipboard reads a valid explicitly supplied editor MIME payload", () => {
  const payload = fixture();
  assert.deepEqual(clipboardPayload({ getData: (type: string) =>
    type === "application/x-tsumu+json" ? JSON.stringify(payload) : "" }), payload);
  assert.equal(parseClipPayload(JSON.stringify({ ...payload, breakpoints: undefined })), null);
});

test("copy uses ClipboardItem without the deprecated DOM copy command", async () => {
  const payload = fixture();
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["navigator", "ClipboardItem", "window", "document"]) descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const storage = new Map<string, string>();
  let formats: Record<string, Blob> | null = null;
  let legacyCalled = false;
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write: async (items: Array<{ formats: Record<string, Blob> }>) => {
        formats = items[0].formats;
      } } },
    });
    Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: class {
      formats: Record<string, Blob>;
      constructor(formats: Record<string, Blob>) { this.formats = formats; }
      static supports() { return false; }
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { setItem(key: string, value: string) { storage.set(key, value); } },
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      execCommand() { legacyCalled = true; },
    } });
    writeClipPayload(payload);
    await Promise.resolve();
    assert.equal(legacyCalled, false);
    assert.deepEqual(JSON.parse(storage.get("tsumu-clipboard-v1")!), payload);
    assert.ok(formats);
    assert.equal(await formats!["text/plain"].text(), "利用者 <確認>");
    assert.deepEqual(clipboardPayload({ getData: (type: string) =>
      type === "text/html" ? "" : "" }), null);
    assert.deepEqual(clipboardPayload({ getData: (type: string) =>
      type === "text/html" ? "<body>" + clipHtml(payload) + "</body>" : "" }), payload);
    assert.equal(await formats!["text/html"].text(), clipHtml(payload));
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
