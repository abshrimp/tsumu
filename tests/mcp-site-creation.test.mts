import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeIndexedDB } from "./helpers/fake-indexeddb";
import { createLocalBrowserSite } from "../lib/browser-site-create";
import { readBrowserDoc } from "../lib/browser-doc-storage";
import { loadLocalSites } from "../lib/site";

test("MCP and Home share an atomic browser-site creation path", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const entries = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { indexedDB: fakeIndexedDB(), localStorage, navigator: null },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const site = await createLocalBrowserSite({ name: "Coffee & Space" });
  assert.equal(site.name, "Coffee & Space");
  assert.equal(loadLocalSites({ strict: true }).length, 1);
  const raw = await readBrowserDoc(site.id);
  assert.equal(JSON.parse(raw!).siteName, site.name);

  await assert.rejects(createLocalBrowserSite({ name: "   " }));
  assert.equal(loadLocalSites({ strict: true }).length, 1, "invalid input must not add a site");
});
