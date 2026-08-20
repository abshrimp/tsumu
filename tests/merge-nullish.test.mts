import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Merge",
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["home"], nodes: {}, assets: {},
    pwa: { enabled: true, name: "Initial" },
  };
}

test("concurrent settings preserve explicit null added beside a remote edit", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.pwa!.icon = null;
  remote.pwa!.name = "Remote";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Remote");
  assert.ok(Object.hasOwn(merged.pwa!, "icon"));
  assert.equal(merged.pwa!.icon, null);
  assert.equal(base.pwa!.icon, undefined);
});

test("removing a null property is not mistaken for leaving it unchanged", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  base.pwa!.icon = null;
  local.pwa!.icon = null;
  remote.pwa!.icon = null;
  delete local.pwa!.icon;
  remote.pwa!.name = "Remote";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Remote");
  assert.equal(Object.hasOwn(merged.pwa!, "icon"), false);
});

test("remote null and independent local properties survive three-way merge", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  remote.pwa!.icon = null;
  local.pwa!.name = "Local";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Local");
  assert.equal(merged.pwa!.icon, null);
});

test("merging nested arbitrary JSON keys never changes object prototypes", () => {
  const base = fixture() as SiteDoc & { customData: Record<string, unknown> };
  base.customData = JSON.parse('{"__proto__":{"base":true},"value":"base"}');
  const local = structuredClone(base), remote = structuredClone(base);
  local.customData.value = "local";
  remote.customData = JSON.parse('{"__proto__":{"remote":true},"value":"base"}');
  const merged = mergeDocs(base, local, remote) as typeof base;
  assert.equal(Object.getPrototypeOf(merged.customData), Object.prototype);
  assert.deepEqual(Object.keys(merged.customData).sort(), ["__proto__", "value"]);
  assert.deepEqual(Object.getOwnPropertyDescriptor(merged.customData, "__proto__")?.value, { remote: true });
  assert.equal(({} as { remote?: boolean }).remote, undefined);
  assert.equal(merged.customData.value, "local");
});
