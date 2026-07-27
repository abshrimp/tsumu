import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { buildPagePayload, copyPagesToSite } from "../lib/page-transfer";
import { DOC_STORAGE_KEY, LOCAL_SITE_DELETED_KEY, siteKey } from "../lib/site";

const target = { id: "destination", name: "Destination" };
const key = siteKey(DOC_STORAGE_KEY, target.id);
const source = createInitialDoc();
const payload = buildPagePayload(source, source.pageOrder);

for (const failure of ["read", "json", "empty", "shape"] as const) {
  test(`copy rejects ${failure} destination data without overwriting it`, async () => {
    const original = failure === "json" ? '{"siteName":"recoverable draft"' : failure === "empty" ? "" :
      JSON.stringify(failure === "shape" ? { ...createInitialDoc(), pageOrder: [] } : createInitialDoc());
    let raw = original;
    let writes = 0;
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem(k: string) { if (k !== key) return null; assert.equal(k, key); if (failure === "read") throw new Error("Read unavailable"); return raw; },
      setItem(k: string, value: string) { assert.equal(k, key); writes++; raw = value; },
    } } });
    try {
      await assert.rejects(copyPagesToSite(target, payload, "local"));
      assert.equal(writes, 0);
      assert.equal(raw, original);
    } finally {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}

test("local copy initializes only absent documents and preserves existing target content", async () => {
  for (const exists of [false, true]) {
    const destination = createInitialDoc();
    destination.siteName = "Keep this title";
    destination.customHeadHtml = "<!-- Keep custom code -->";
    let raw: string | null = exists ? JSON.stringify(destination) : null;
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem(k: string) { return k === key ? raw : null; }, setItem(_key: string, value: string) { raw = value; },
    } } });
    try {
      await copyPagesToSite(target, payload, "local");
      const saved = JSON.parse(raw!);
      assert.equal(saved.pageOrder.length, destination.pageOrder.length + payload.pages.length);
      assert.equal(saved.siteName, exists ? destination.siteName : target.name);
      if (exists) {
        assert.equal(saved.customHeadHtml, destination.customHeadHtml);
        for (const id of destination.pageOrder) assert.deepEqual(saved.pages[id], destination.pages[id]);
      }
    } finally {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("a quota failure preserves the existing destination and a retry appends only once", async () => {
  const destination = createInitialDoc();
  const original = JSON.stringify(destination);
  let raw = original;
  let full = true;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem(k: string) { return k === key ? raw : null; },
    setItem(_key: string, value: string) {
      if (full) throw new DOMException("Storage full", "QuotaExceededError");
      raw = value;
    },
  } } });
  try {
    await assert.rejects(copyPagesToSite(target, payload, "local"));
    assert.equal(raw, original);
    full = false;
    await copyPagesToSite(target, payload, "local");
    assert.equal(JSON.parse(raw).pageOrder.length, destination.pageOrder.length + payload.pages.length);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("server copy retries against the latest revision, preserving concurrent target edits", async () => {
  const before = createInitialDoc();
  const concurrent = structuredClone(before);
  concurrent.siteName = "Concurrent title";
  concurrent.customHeadHtml = "<!-- Concurrent edit -->";
  const bodies: any[] = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "https://example.test");
    assert.equal(url.searchParams.get("site"), target.id);
    if (!init) return Response.json({ exists: true, rev: "1", doc: before });
    bodies.push(JSON.parse(String(init.body)));
    assert.equal(url.searchParams.get("base"), String(bodies.length));
    return bodies.length === 1 ? Response.json({ conflict: true, rev: "2", doc: concurrent }, { status: 409 }) : Response.json({ ok: true });
  };
  try {
    await copyPagesToSite(target, payload, "server");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].siteName, concurrent.siteName);
    assert.equal(bodies[1].customHeadHtml, concurrent.customHeadHtml);
    assert.equal(bodies[1].pageOrder.length, concurrent.pageOrder.length + payload.pages.length);
  } finally { globalThis.fetch = oldFetch; }
});

test("server conflict rechecks screen widths before attempting another write", async () => {
  const before = createInitialDoc(), concurrent = createInitialDoc();
  concurrent.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
  let writes = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (!init) return Response.json({ exists: true, rev: "1", doc: before });
    writes++;
    return Response.json({ conflict: true, rev: "2", doc: concurrent }, { status: 409 });
  };
  try {
    await assert.rejects(copyPagesToSite(target, payload, "server"), /画面幅|screen-width/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = oldFetch; }
});

test("local incompatible copy leaves the saved destination byte-for-byte unchanged", async () => {
  const destination = createInitialDoc();
  destination.breakpoints = [{ id: "custom", label: "Custom", maxWidth: 800 }];
  const original = JSON.stringify(destination);
  let writes = 0;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem(k: string) { return k === key ? original : null; }, setItem() { writes++; },
  } } });
  try {
    await assert.rejects(copyPagesToSite(target, payload, "local"), /画面幅|screen-width/);
    assert.equal(writes, 0);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});


test("local copy cannot recreate a destination deleted after opening the copy dialog", async () => {
  const marker = siteKey(LOCAL_SITE_DELETED_KEY, target.id);
  for (const original of [null, JSON.stringify(createInitialDoc())]) {
    let writes = 0;
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem(k: string) { return k === marker ? "1" : k === key ? original : null; },
      setItem() { writes++; },
    } } });
    try {
      await assert.rejects(copyPagesToSite(target, payload, "local"));
      assert.equal(writes, 0);
    } finally {
      if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  }
});
