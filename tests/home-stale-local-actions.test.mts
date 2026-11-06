import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialDoc } from "../lib/presets";
import { DOC_STORAGE_KEY, SITE_SCOPED_KEYS, deleteLocalSite, emptyDest, isLocalSiteDeleted, siteKey } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteFixture } from "./helpers/home-site-storage";

const listKey = storageKey("sites-v1");
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
const survivor = { ...emptyDest(), id: "survivor", name: "Other site", createdAt: 3, updatedAt: 4 };
const input = { ...emptyDest(), name: "Requested change", repo: "example/site" };
function storageFixture() {
  const doc = createInitialDoc();
  doc.customHeadHtml = "<meta name='authored-content' content='keep me'>";
  const values = new Map([[listKey, JSON.stringify([source, survivor])], [siteKey(DOC_STORAGE_KEY, source.id), JSON.stringify(doc)]]);
  let failList = false;
  const storage: Storage = {
    get length() { return values.size; },
    key(i) { return [...values.keys()][i] ?? null; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (failList && key === listKey) throw new DOMException("Storage full", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
  };
  return { values, storage, failList: (value: boolean) => { failList = value; } };
}

for (const action of ["duplicate", "settings"] as const) {
  for (const cleanup of ["complete", "document-left", "list-left", "both-left", "missing-without-marker"] as const) {
    test(`stale local ${action} rejects a removed target after ${cleanup}`, async () => {
      const f = storageFixture();
      const home = await homeSiteFixture(f.storage);
      try {
        home[action](source.id);
        if (cleanup === "missing-without-marker") {
          f.values.set(listKey, JSON.stringify([survivor]));
        } else {
          f.failList(cleanup === "list-left" || cleanup === "both-left");
          deleteLocalSite(source.id);
          f.failList(false);
          if (cleanup === "complete" || cleanup === "list-left") {
            for (const key of SITE_SCOPED_KEYS) f.storage.removeItem(siteKey(key, source.id));
          }
          assert.equal(isLocalSiteDeleted(source.id), true);
        }
        const before = [...f.values];
        await assert.rejects(home.save(input), /サイトが見つかりません/);
        assert.deepEqual([...f.values], before, "do not register an empty copy, copy deleted bytes, or write an unchanged list as a successful save");
        assert.equal(home.dialogOpen(), true, "retain the user's pending form rather than silently closing it");
        assert.equal(home.location.href, "/");
        assert.deepEqual(home.sites(), [survivor]);
      } finally { home.dispose(); }
    });
  }
}

test("successful local duplication displays the same fresh list that was persisted", async () => {
  const f = storageFixture();
  const home = await homeSiteFixture(f.storage);
  try {
    home.duplicate(source.id);
    const added = { ...emptyDest(), id: "another-tab", name: "Created elsewhere", createdAt: 5, updatedAt: 6 };
    f.values.set(listKey, JSON.stringify([added, source]));
    await home.save(input);
    assert.deepEqual(home.cards().map((card: any) => card.props.site.id), home.sites().map(site => site.id));
    assert.equal(home.cards().some((card: any) => card.props.site.id === survivor.id), false);
    assert.equal(home.cards().some((card: any) => card.props.site.id === added.id), true);
    assert.equal(home.dialogOpen(), false);
  } finally { home.dispose(); }
});
