import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { DOC_STORAGE_KEY, emptyDest, siteKey } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteFixture, homeSiteStorageBundle } from "./helpers/home-site-storage";

const listKey = storageKey("sites-v1");
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
const sourceDocKey = siteKey(DOC_STORAGE_KEY, source.id);
function storageFixture(withDoc = true) {
  const doc = createInitialDoc();
  doc.siteName = "Original public title";
  doc.pages.about = { ...doc.pages[doc.pageOrder[0]], id: "about", name: "About", title: "About", slug: "about", children: [] };
  doc.pageOrder.push("about");
  doc.customHeadHtml = `<style>/* ${"x".repeat(100_000)} */</style>`;
  const raw = JSON.stringify(doc);
  const values = new Map<string, string>([[listKey, JSON.stringify([source])]]);
  if (withDoc) values.set(sourceDocKey, raw);
  let quota = Infinity;
  let failList = false;
  let failRead = false;
  const size = () => [...values].reduce((n, [key, value]) => n + key.length + value.length, 0);
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) {
      if (failRead && key === sourceDocKey) throw new DOMException("Storage blocked", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      const oldSize = values.has(key) ? key.length + values.get(key)!.length : 0;
      if ((failList && key === listKey) || size() - oldSize + key.length + value.length > quota) {
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
  };
  return { storage, values, raw, doc, size, setQuota: (n: number) => { quota = n; },
    failList: (v: boolean) => { failList = v; }, failRead: (v: boolean) => { failRead = v; } };
}

const input = { ...emptyDest(), name: "Duplicate" };
const error = /サイトを複製できませんでした.*もう一度/;

for (const failure of ["quota", "list", "read"] as const) {
  test(`local duplication rejects ${failure} failure without registering or seeding a partial site, then retries`, async () => {
    const f = storageFixture();
    const originalEntries = [...f.values];
    const home = await homeSiteFixture(f.storage);
    try {
      home.duplicate(source.id);
      if (failure === "quota") f.setQuota(f.size() + f.raw.length / 2);
      if (failure === "list") f.failList(true);
      if (failure === "read") f.failRead(true);
      await assert.rejects(home.save(input), error);
      assert.deepEqual([...f.values], originalEntries, "no blank duplicate, orphan doc, or changed source");
      assert.equal(home.dialogOpen(), true, "keep the form available for retry");
      assert.equal(home.cards().length, 1, "do not show an unsaved duplicate as successful");
      f.setQuota(Infinity); f.failList(false); f.failRead(false);
      await home.save(input);
      assert.equal(home.dialogOpen(), false);
      assert.equal(home.cards().length, 2);
      const copy = home.sites().find((s) => s.id !== source.id)!;
      assert.equal(f.values.get(siteKey(DOC_STORAGE_KEY, copy.id)), f.raw);
      assert.equal(f.values.get(sourceDocKey), f.raw);
      assert.equal(copy.repo, null);
    } finally { home.dispose(); }
  });
}

test("normal local duplication preserves the complete document and supplied publication destination", async () => {
  const f = storageFixture();
  const home = await homeSiteFixture(f.storage);
  try {
    home.duplicate(source.id);
    await home.save({ ...input, repo: "example/copy", siteUrl: "https://example.test" });
    const copy = home.sites()[0];
    assert.equal(copy.name, input.name);
    assert.equal(copy.repo, "example/copy");
    assert.equal(copy.siteUrl, "https://example.test");
    assert.equal(f.values.get(siteKey(DOC_STORAGE_KEY, copy.id)), f.raw);
    assert.deepEqual(home.sites()[1], source);
  } finally { home.dispose(); }
});

test("a never-opened site still duplicates with an initial document, but rejects insufficient space", async () => {
  const f = storageFixture(false);
  const originalEntries = [...f.values];
  const home = await homeSiteFixture(f.storage);
  try {
    home.duplicate(source.id);
    f.setQuota(f.size());
    await assert.rejects(home.save(input), error);
    assert.deepEqual([...f.values], originalEntries);
    f.setQuota(Infinity);
    await home.save(input);
    const copy = home.sites()[0];
    const doc = JSON.parse(f.values.get(siteKey(DOC_STORAGE_KEY, copy.id))!);
    assert.equal(doc.siteName, input.name);
    assert.ok(doc.pageOrder.length > 0);
    assert.equal(f.values.has(sourceDocKey), false);
  } finally { home.dispose(); }
});

test("new local site creation still writes its list entry and initial named document before navigating", async () => {
  const f = storageFixture();
  const home = await homeSiteFixture(f.storage);
  try {
    home.create();
    await home.save({ ...input, name: "New site" });
    const created = home.sites()[0];
    assert.equal(created.name, "New site");
    assert.equal(JSON.parse(f.values.get(siteKey(DOC_STORAGE_KEY, created.id))!).siteName, "New site");
    assert.equal(home.location.href, `/sites/${created.id}`);
    assert.equal(f.values.get(sourceDocKey), f.raw);
  } finally { home.dispose(); }
});

test("browser fixture bundles the real Home dialog and storage callbacks", async () => {
  const bundle = await homeSiteStorageBundle();
  assert.match(bundle, /function SiteDialog/);
  assert.match(bundle, /function copyLocalDoc/);
});
