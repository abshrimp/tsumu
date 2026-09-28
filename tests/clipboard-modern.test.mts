import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClipPayload, clipboardPayload, clipHtml, parseClipPayload, readSystemClipPayload, writeClipPayload } from "../lib/clip-transfer";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture() {
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "コピー", pageOrder: ["p"], assets: {},
    pages: { p: { id: "p", name: "Home", title: "", slug: "", description: "", children: ["n"] } },
    nodes: { n: { ...makeBox(), id: "n", text: { content: "  2 < 3 && 5 > 4\n<br> は文字です  ", heading: 0 } } },
  };
  return buildClipPayload(doc, { nodes: [doc.nodes.n], rootIds: ["n"] });
}

test("clipboard HTML round-trips structured content through a standard MIME type", () => {
  const payload = fixture();
  const html = clipHtml(JSON.stringify(payload), payload.nodes[0].text!.content);
  assert.match(html, /data-tsumu-clipboard=/);
  assert.match(html, /  2 &lt; 3 &amp;&amp; 5 &gt; 4\n&lt;br&gt; は文字です  <\/span>/);
  const data = { getData: (type: string) => type === "text/html" ? "<html><body>" + html + "</body></html>" : "" };
  assert.deepEqual(clipboardPayload(data)?.payload, payload);
  assert.equal(clipboardPayload(data)?.raw, JSON.stringify(payload));
  assert.equal(clipboardPayload({ getData: (type: string) => type === "text/html" ? '<span data-tsumu-clipboard="%invalid"></span>' : "" }), null);
  assert.equal(clipboardPayload({ getData: () => "<span>Ordinary HTML</span>" }), null);
  assert.equal(clipboardPayload({ getData: () => "a".repeat(48 * 1024 * 1024 + 1) }), null);
});

test("clipboard reads a valid explicitly supplied editor MIME payload", () => {
  const payload = fixture();
  assert.deepEqual(clipboardPayload({ getData: (type: string) =>
    type === "application/x-tsumu+json" ? JSON.stringify(payload) : "" })?.payload, payload);
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
    assert.equal(await formats!["text/plain"].text(), payload.nodes[0].text!.content);
    const html = await formats!["text/html"].text();
    assert.deepEqual(clipboardPayload({ getData: (type: string) =>
      type === "text/html" ? "<body>" + html + "</body>" : "" })?.payload, payload);
    assert.equal(html, clipHtml(JSON.stringify(payload), payload.nodes[0].text!.content));
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("context menu reads the current system clipboard rather than an old saved copy", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copy = fixture();
  const newer = structuredClone(copy);
  newer.nodes[0].name = "New copy";
  let html = "<span>Ordinary HTML</span>";
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
      read: async () => [{ types: ["text/html"], getType: async () => new Blob([html], { type: "text/html" }) }],
    } } });
    assert.equal(await readSystemClipPayload(), null, "unrelated OS content is not replaced by the saved Tsumu copy");
    html = clipHtml(JSON.stringify(newer), "New copy");
    assert.deepEqual((await readSystemClipPayload())?.payload, newer);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("multiple asynchronous node copies finish in copy order before context paste reads", async () => {
  const descriptors = ["navigator", "ClipboardItem", "window"].map(name =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const first = fixture();
  const second = structuredClone(first);
  second.nodes[0].name = "Last copied";
  const writes: { formats: Record<string, Blob>; resolve: () => void }[] = [];
  let current: Record<string, Blob> | null = null;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { setItem() {} },
    } });
    Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: class {
      formats: Record<string, Blob>;
      constructor(formats: Record<string, Blob>) { this.formats = formats; }
      static supports() { return false; }
    } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: {
      write: (items: Array<{ formats: Record<string, Blob> }>) => new Promise<void>(resolve => {
        writes.push({ formats: items[0].formats, resolve: () => { current = items[0].formats; resolve(); } });
      }),
      read: async () => current ? [{
        types: ["text/html"], getType: async () => current!["text/html"],
      }] : [],
    } } });
    writeClipPayload(first);
    writeClipPayload(second);
    await Promise.resolve();
    assert.equal(writes.length, 1, "the second OS write must not overtake the first");
    writes[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(writes.length, 2);
    writes[1].resolve();
    assert.deepEqual((await readSystemClipPayload())?.payload, second);
    await Promise.resolve();
    writeClipPayload(first);
    assert.equal(writes.length, 3, "later independent copies should write immediately during user activation");
    writes[2].resolve();
    assert.deepEqual((await readSystemClipPayload())?.payload, first);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
