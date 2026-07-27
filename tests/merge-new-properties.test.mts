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
