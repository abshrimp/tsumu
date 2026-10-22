import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    siteName: "Merge", assets: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", children: ["a"] } },
    nodes: { a: { ...makeBox(), id: "a", styles: {} } },
  };
}

test("concurrent first edits to a style state preserve independent properties", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.a.styles = { base: { hover: { color: "red" } } };
  remote.nodes.a.styles = { base: { hover: { backgroundColor: "blue" } } };
  const snapshots = structuredClone([base, local, remote]);
  assert.deepEqual(mergeDocs(base, local, remote).nodes.a.styles, {
    base: { hover: { color: "red", backgroundColor: "blue" } },
  });
  assert.deepEqual([base, local, remote], snapshots);
});

test("new nested settings retain both editors' independent changes and local conflicts", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.a.styles = { base: { hover: { color: "red" } } };
  remote.nodes.a.styles = { base: { hover: { color: "blue", opacity: "0.5" } } };
  assert.deepEqual(mergeDocs(base, local, remote).nodes.a.styles.base?.hover, { color: "red", opacity: "0.5" });
});

test("explicit null and scalar replacements keep local conflict precedence", () => {
  for (const original of [null, "old"]) {
    const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
    Object.assign(base, { customSetting: original });
    Object.assign(local, { customSetting: { a: 1 } });
    Object.assign(remote, { customSetting: { b: 2 } });
    assert.deepEqual((mergeDocs(base, local, remote) as any).customSetting, { a: 1 });
  }
});

test("concurrent new collection IDs do not merge unrelated entities", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.fresh = { ...makeBox(), id: "fresh", name: "Local", styles: { base: { default: { color: "red" } } } };
  remote.nodes.fresh = { ...makeBox(), id: "fresh", name: "Remote", styles: { base: { default: { backgroundColor: "blue" } } } };
  local.pages.p.children.push("fresh");
  remote.pages.p.children.push("fresh");
  assert.deepEqual(mergeDocs(base, local, remote).nodes.fresh, local.nodes.fresh);
});

test("new optional site settings are merged by property", () => {
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  Object.assign(local, { customSetting: { a: 1 } });
  Object.assign(remote, { customSetting: { b: 2 } });
  assert.deepEqual((mergeDocs(base, local, remote) as any).customSetting, { a: 1, b: 2 });
});

function pwaFixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Merge",
    pages: { home: { id: "home", name: "Home", slug: "", title: "", description: "", children: [] } },
    pageOrder: ["home"], nodes: {}, assets: {},
    pwa: { enabled: true, name: "Initial" },
  };
}

test("concurrent settings preserve explicit null added beside a remote edit", () => {
  const base = pwaFixture(), local = structuredClone(base), remote = structuredClone(base);
  local.pwa!.icon = null;
  remote.pwa!.name = "Remote";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Remote");
  assert.ok(Object.hasOwn(merged.pwa!, "icon"));
  assert.equal(merged.pwa!.icon, null);
  assert.equal(base.pwa!.icon, undefined);
});

test("removing a null property is not mistaken for leaving it unchanged", () => {
  const base = pwaFixture(), local = structuredClone(base), remote = structuredClone(base);
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
  const base = pwaFixture(), local = structuredClone(base), remote = structuredClone(base);
  remote.pwa!.icon = null;
  local.pwa!.name = "Local";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.pwa!.name, "Local");
  assert.equal(merged.pwa!.icon, null);
});

test("merging nested arbitrary JSON keys never changes object prototypes", () => {
  const base = pwaFixture() as SiteDoc & { customData: Record<string, unknown> };
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
