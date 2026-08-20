import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDocs } from "../lib/merge";
import { makeBox } from "../lib/presets";
import { validateDocValue } from "../lib/doc-storage";
import type { SiteDoc } from "../lib/types";

function empty(): SiteDoc {
  return { schemaVersion: 1, siteName: "Test", assets: {}, nodes: {}, pages: { p: { id: "p", name: "Home", slug: "", title: "", description: "", children: [] } }, pageOrder: ["p"] };
}
function node(id: string, children: string[] = []) { return { ...makeBox(), id, children }; }
function assertValid(doc: SiteDoc) { assert.equal(validateDocValue(doc), null); }
function componentFixture() {
  const base = empty();
  base.nodes = { a: node("a"), b: node("b") };
  base.components = { A: { id: "A", name: "A", rootId: "a" }, B: { id: "B", name: "B", rootId: "b" } };
  return base;
}
function nested(id: string, componentId: string) { return { ...node(id), type: "instance" as const, componentId }; }

test("concurrent legal move and addition cannot merge into an unsavable depth", () => {
  const base = empty(); base.pages.p.children = ["a0", "b0"];
  for (const prefix of ["a", "b"]) for (let i = 0; i < 128; i++) base.nodes[prefix + i] = node(prefix + i, i < 127 ? [prefix + (i + 1)] : []);
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages.p.children = ["b0"]; local.nodes.b127.children = ["a0"];
  remote.nodes.added = node("added"); remote.nodes.a127.children = ["added"];
  for (const doc of [base, local, remote]) assertValid(doc);
  const snapshots = JSON.stringify([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assertValid(merged);
  assert.equal(Object.keys(merged.nodes).length, 257);
  assert.deepEqual(merged.nodes.a127.children, ["added"]);
  assert.ok(merged.pages.p.children.includes("a0"), "fall back to the original parent instead of dropping the addition");
  assert.equal(JSON.stringify([base, local, remote]), snapshots);
});

test("mutual concurrent component insertions retain local nesting and rescue the remote instance", () => {
  const base = componentFixture(), local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  remote.nodes.ba = nested("ba", "A"); remote.nodes.b.children = ["ba"];
  const snapshots = JSON.stringify([base, local, remote]);
  const merged = mergeDocs(base, local, remote);
  assertValid(merged);
  assert.deepEqual(merged.nodes.a.children, ["ab"]);
  assert.deepEqual(merged.nodes.b.children, []);
  assert.deepEqual(merged.pages.p.children, ["ba"]);
  assert.equal(merged.nodes.ba.componentId, "A");
  assert.deepEqual(merged.components, base.components);
  assert.equal(JSON.stringify([base, local, remote]), snapshots);
});

test("component cycle repair prefers an original placement to a new page-root placement", () => {
  const base = componentFixture(); base.nodes.outside = node("outside", ["ba"]); base.pages.p.children = ["outside"];
  base.nodes.ba = nested("ba", "A");
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  remote.nodes.outside.children = []; remote.nodes.b.children = ["ba"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.outside.children, ["ba"]);
  assert.deepEqual(merged.nodes.b.children, []);
  assert.deepEqual(merged.nodes.a.children, ["ab"]);
  assertValid(merged);
});

test("noncyclic independent nested instances keep their intended master placements", () => {
  const base = componentFixture(); base.nodes.c = node("c"); base.components!.C = { id: "C", name: "C", rootId: "c" };
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  remote.nodes.bc = nested("bc", "C"); remote.nodes.b.children = ["bc"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.a.children, ["ab"]); assert.deepEqual(merged.nodes.b.children, ["bc"]);
  assert.deepEqual(merged.pages.p.children, []); assertValid(merged);
});

test("a long acyclic component chain is merged without recursive traversal or reparenting", () => {
  const base = empty(); base.components = {};
  for (let i = 0; i < 12000; i++) {
    const root = `r${i}`, instance = `i${i}`;
    base.components[`c${i}`] = { id: `c${i}`, name: `C${i}`, rootId: root };
    base.nodes[root] = node(root, i < 11999 ? [instance] : []);
    if (i < 11999) base.nodes[instance] = nested(instance, `c${i + 1}`);
  }
  const merged = mergeDocs(base, base, { ...base, siteName: "Remote rename" });
  assert.equal(merged.siteName, "Remote rename");
  assert.deepEqual(merged.nodes, base.nodes);
  assert.deepEqual(merged.pages.p.children, []);
});

test("detached nodes remain detached during an ordinary merge", () => {
  const base = empty(); base.nodes.loose = node("loose", ["child"]); base.nodes.child = node("child");
  const merged = mergeDocs(base, base, { ...base, siteName: "Remote rename" });
  assert.deepEqual(merged.pages.p.children, []);
  assert.deepEqual(merged.nodes, base.nodes);
});

test("independent component cycles each retain their own original non-root placement", () => {
  const base = componentFixture();
  base.nodes.c = node("c"); base.nodes.d = node("d");
  base.components!.C = { id: "C", name: "C", rootId: "c" }; base.components!.D = { id: "D", name: "D", rootId: "d" };
  base.nodes.outside = node("outside", ["ba", "dc"]); base.pages.p.children = ["outside"];
  base.nodes.ba = nested("ba", "A"); base.nodes.dc = nested("dc", "C");
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ab = nested("ab", "B"); local.nodes.a.children = ["ab"];
  local.nodes.cd = nested("cd", "D"); local.nodes.c.children = ["cd"];
  remote.nodes.outside.children = []; remote.nodes.b.children = ["ba"]; remote.nodes.d.children = ["dc"];
  const merged = mergeDocs(base, local, remote);
  assert.deepEqual(merged.nodes.outside.children, ["ba", "dc"]);
  assert.deepEqual(merged.pages.p.children, ["outside"]);
  assert.deepEqual(merged.nodes.a.children, ["ab"]); assert.deepEqual(merged.nodes.c.children, ["cd"]);
  assert.deepEqual(merged.nodes.b.children, []); assert.deepEqual(merged.nodes.d.children, []);
  assertValid(merged);
});

test("repairing a master-root reference does not erase it because an unrelated cycle remains", () => {
  const base = empty(); base.components = {};
  for (const id of ["A", "B", "C", "D", "E", "F"]) { base.components[id] = { id, name: id, rootId: id }; base.nodes[id] = node(id); }
  base.nodes.A = nested("A", "C"); base.nodes.D = nested("D", "F");
  const local = structuredClone(base), remote = structuredClone(base);
  local.nodes.ba = nested("ba", "A"); local.nodes.B.children = ["ba"];
  local.nodes.ed = nested("ed", "D"); local.nodes.E.children = ["ed"];
  remote.nodes.A.componentId = "B"; remote.nodes.D.componentId = "E";
  const merged = mergeDocs(base, local, remote);
  assert.equal(merged.nodes.A.componentId, "C");
  assert.equal(merged.nodes.D.componentId, "F");
  assert.deepEqual(merged.nodes.B.children, ["ba"]); assert.deepEqual(merged.nodes.E.children, ["ed"]);
  assertValid(merged);
});
