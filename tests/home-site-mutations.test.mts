import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { DOC_STORAGE_KEY, emptyDest, siteKey, touchLocalSite } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteFixture } from "./helpers/home-site-storage";

const listKey = storageKey("sites-v1");
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
const sourceDocKey = siteKey(DOC_STORAGE_KEY, source.id);
function storageFixture() {
  const doc = createInitialDoc();
  doc.siteName = "Original public title";
  doc.customHeadHtml = "<style>/* Original authored content */</style>";
  const raw = JSON.stringify(doc);
  const values = new Map<string, string>([[listKey, JSON.stringify([source])], [sourceDocKey, raw]]);
  let failure: "list" | "document" | "read" | null = null;
  const removals: string[] = [];
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) {
      if (failure === "read" && key === listKey) throw new DOMException("Storage blocked", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if ((failure === "list" && key === listKey) || (failure === "document" && key.startsWith(`${DOC_STORAGE_KEY}:`))) {
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      values.set(key, value);
    },
    removeItem(key) { removals.push(key); values.delete(key); },
  };
  return { storage, values, raw, removals, fail: (v: typeof failure) => { failure = v; } };
}

const input = { ...emptyDest(), name: "New name", repo: "example/site", siteUrl: "https://example.test" };
const error = /ブラウザの保存容量や設定を確認して、もう一度/;

for (const failure of ["list", "document"] as const) {
  test(`local creation rejects ${failure} write failure without navigating, then retries`, async () => {
    const f = storageFixture();
    const before = [...f.values];
    const home = await homeSiteFixture(f.storage);
    try {
      home.create();
      f.fail(failure);
      await assert.rejects(home.save(input), error);
      assert.equal(home.location.href, "/", "do not open an unpersisted site");
      assert.deepEqual([...f.values], before, "preserve existing sites and avoid orphaned new content");
      assert.equal(home.dialogOpen(), true);
      f.fail(null);
      await home.save(input);
      const site = home.sites()[0];
      assert.equal(site.name, input.name);
      assert.equal(site.repo, input.repo);
      assert.equal(home.location.href, `/sites/${site.id}`);
      assert.equal(JSON.parse(f.values.get(siteKey(DOC_STORAGE_KEY, site.id))!).siteName, input.name);
      assert.equal(f.values.get(sourceDocKey), f.raw);
    } finally { home.dispose(); }
  });
}

test("local settings do not show an unsaved rename or discard the retry dialog", async () => {
  const f = storageFixture();
  const before = [...f.values];
  const home = await homeSiteFixture(f.storage);
  try {
    home.settings(source.id);
    f.fail("list");
    await assert.rejects(home.save(input), error);
    assert.equal(home.dialogOpen(), true);
    assert.equal(home.cards()[0].props.site.name, source.name);
    assert.deepEqual([...f.values], before);
    f.fail(null);
    await home.save(input);
    assert.equal(home.dialogOpen(), false);
    assert.equal(home.cards()[0].props.site.name, input.name);
    assert.equal(home.sites()[0].repo, input.repo);
    assert.equal(f.values.get(sourceDocKey), f.raw, "settings must not replace the authored document");
  } finally { home.dispose(); }
});

test("a failed local deletion leaves its listed document intact and can be retried", async () => {
  const f = storageFixture();
  const before = [...f.values];
  const home = await homeSiteFixture(f.storage);
  try {
    f.fail("list");
    home.remove(source.id);
    assert.equal(home.prompt().kind, "prompt");
    home.answer(source.name);
    await home.flush();
    assert.equal(home.prompt()?.kind, "alert", "report the failed deletion");
    assert.match(home.prompt().message, error);
    assert.deepEqual([...f.values], before, "never erase the document when its list entry could not be removed");
    assert.deepEqual(f.removals, [], "no destructive cleanup after a failed list write");
    assert.equal(home.cards().length, 1);
    home.answer();
    await home.flush();
    f.fail(null);
    home.remove(source.id);
    home.answer(source.name);
    await home.flush();
    assert.equal(home.cards().length, 0);
    assert.equal(home.sites().length, 0);
    assert.equal(f.values.has(sourceDocKey), false);
  } finally { home.dispose(); }
});

test("canceling local deletion leaves the list and all content untouched", async () => {
  const f = storageFixture();
  const before = [...f.values];
  const home = await homeSiteFixture(f.storage);
  try {
    home.remove(source.id);
    home.answer(null);
    await home.flush();
    assert.deepEqual([...f.values], before);
    assert.equal(home.cards().length, 1);
    assert.deepEqual(f.removals, []);
  } finally { home.dispose(); }
});

for (const action of ["create", "update", "duplicate", "delete"] as const) {
  for (const failure of ["read", "corrupt", "shape", "entry"] as const) {
    test(`local ${action} does not replace a list after ${failure} failure`, async () => {
      const f = storageFixture();
      const home = await homeSiteFixture(f.storage);
      try {
        if (action === "create") home.create();
        if (action === "update") home.settings(source.id);
        if (action === "duplicate") home.duplicate(source.id);
        if (failure === "read") f.fail("read");
        if (failure === "corrupt") f.values.set(listKey, "{unreadable JSON");
        if (failure === "shape") f.values.set(listKey, JSON.stringify({ sites: [source] }));
        if (failure === "entry") f.values.set(listKey, JSON.stringify([source, { id: "invalid/id" }]));
        const before = [...f.values];
        if (action === "delete") {
          home.remove(source.id);
          home.answer(source.name);
          await home.flush();
          assert.equal(home.prompt()?.kind, "alert");
          assert.match(home.prompt().message, error);
          home.answer();
          await home.flush();
        } else {
          await assert.rejects(home.save(input), error);
          assert.equal(home.dialogOpen(), true);
        }
        assert.deepEqual([...f.values], before, "leave the stored list and authored content untouched");
        assert.equal(home.cards().length, 1);
        assert.equal(home.location.href, "/");
        assert.deepEqual(f.removals, [], "reject unreadable lists before document writes or cleanup");
        // An unreadable list is still tolerated by the read-only Home loader.
        assert.deepEqual(home.sites(), failure === "entry" ? [source] : []);
      } finally { home.dispose(); }
    });
  }
}

for (const failure of ["read", "corrupt", "entry", "write", "none"] as const) {
  test(`the editor timestamp update preserves the site list under ${failure} failure`, async () => {
    const f = storageFixture();
    const home = await homeSiteFixture(f.storage);
    try {
      home.location.pathname = `/sites/${source.id}`;
      if (failure === "read") f.fail("read");
      if (failure === "write") f.fail("list");
      if (failure === "corrupt") f.values.set(listKey, "{unreadable JSON");
      if (failure === "entry") f.values.set(listKey, JSON.stringify([source, { id: "invalid/id" }]));
      const before = [...f.values];
      assert.doesNotThrow(() => touchLocalSite(12345), "metadata failure must not interrupt document saving");
      if (failure === "none") {
        assert.deepEqual(home.sites(), [{ ...source, updatedAt: 12345, savedAt: 12345 }]);
        assert.equal(f.values.get(sourceDocKey), f.raw);
      } else assert.deepEqual([...f.values], before);
    } finally { home.dispose(); }
  });
}

test("a genuinely empty local store can create its first site", async () => {
  const f = storageFixture();
  f.values.clear();
  const home = await homeSiteFixture(f.storage);
  try {
    home.create();
    await home.save(input);
    const created = home.sites()[0];
    assert.equal(home.sites().length, 1);
    assert.equal(created.name, input.name);
    assert.equal(home.location.href, `/sites/${created.id}`);
    assert.equal(JSON.parse(f.values.get(siteKey(DOC_STORAGE_KEY, created.id))!).siteName, input.name);
  } finally { home.dispose(); }
});

for (const raw of ["", "{corrupt document", "null"]) {
  test(`failed local deletion preserves existing malformed document ${JSON.stringify(raw)}`, async () => {
    const f = storageFixture();
    f.values.set(sourceDocKey, raw);
    const before = [...f.values];
    const home = await homeSiteFixture(f.storage);
    try {
      f.fail("list");
      home.remove(source.id);
      home.answer(source.name);
      await home.flush();
      assert.equal(home.prompt()?.kind, "alert");
      assert.deepEqual([...f.values], before, "failure does not reseed or erase existing corrupt document bytes");
      home.answer();
      await home.flush();
    } finally { home.dispose(); }
  });
}
