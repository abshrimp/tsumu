import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBox } from "../lib/presets";
import type { DocNode, SiteDoc } from "../lib/types";
import { parseSiteImport } from "../lib/site-import";
import { normalizeImportedScriptTargets } from "../lib/imported-script-targets";
import { validSiteDoc } from "../lib/doc-tree";

function fixture(): SiteDoc {
  const node = (id: string, name: string, attrId?: string): DocNode => ({
    ...makeBox(name), id, ...(attrId ? { attrId } : {}),
  });
  const trigger = node("trigger", "Trigger");
  const panel = node("panel", "Panel");
  const known = node("known", "Known", "known-id");
  const foreign = node("foreign", "Foreign", "panel");
  trigger.scripts = [{
    id: "on-click", trigger: "click", steps: [
      { id: "show", kind: "show", target: "panel" },
      { id: "self", kind: "toggle", target: "@self" },
      { id: "unknown", kind: "hide", target: "foreign" },
      { id: "nested", kind: "if",
        cond: { subject: "visible", target: "known" },
        conditions: [{ subject: "var", target: "", left: "{enabled}", op: "eq", value: "yes", and: true }],
        then: [{ id: "inner", kind: "scroll-to", target: "panel" }],
        else: [{ id: "unused", kind: "show", target: "not-a-node" }],
      },
    ],
  }];
  return {
    schemaVersion: 1, siteName: "Script IDs", assets: {},
    pageOrder: ["home", "other"],
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["trigger", "panel", "known"], pageScripts: [
        { id: "page-load", trigger: "load", steps: [{ id: "reveal", kind: "show", target: "panel" }] },
      ] },
      other: { id: "other", name: "Other", slug: "other", title: "Other", description: "", children: ["foreign"] },
    },
    nodes: { trigger, panel, known, foreign },
  };
}

test("SiteDoc JSON import resolves node IDs into HTML script target attributes only within scope", async () => {
  const source = fixture();
  assert.equal(validSiteDoc(source), true);
  const before = structuredClone(source);
  const imported = await parseSiteImport(new TextEncoder().encode(JSON.stringify(source)), "doc");
  const doc = imported.doc;
  assert.deepEqual(source, before, "parsing must not mutate the caller's SiteDoc");
  assert.equal(doc.nodes.panel.attrId, "panel-2", "a different page's ID attribute must not be stolen");
  const steps = doc.nodes.trigger.scripts![0].steps;
  assert.equal(steps[0].kind, "show");
  if (steps[0].kind !== "show") throw new Error("wrong step");
  assert.equal(steps[0].target, "panel-2");
  if (steps[1].kind !== "toggle" || steps[2].kind !== "hide" || steps[3].kind !== "if")
    throw new Error("wrong script layout");
  assert.equal(steps[1].target, "@self");
  assert.equal(steps[2].target, "foreign", "an element on another page must not be selected");
  assert.equal(steps[3].cond.target, "known-id");
  assert.equal(steps[3].conditions![0].target, "", "variable conditions have no element target");
  assert.equal(steps[3].then[0].kind, "scroll-to");
  if (steps[3].then[0].kind !== "scroll-to" || steps[3].else?.[0].kind !== "show") throw new Error("wrong nested steps");
  assert.equal(steps[3].then[0].target, "panel-2");
  assert.equal(steps[3].else[0].target, "not-a-node", "do not guess unknown target names");
  assert.equal(doc.pages.home.pageScripts![0].steps[0].kind, "show");
  const pageStep = doc.pages.home.pageScripts![0].steps[0];
  if (pageStep.kind !== "show") throw new Error("wrong page script");
  assert.equal(pageStep.target, "panel-2");
  assert.equal(validSiteDoc(doc), true);
  assert.deepEqual(normalizeImportedScriptTargets(doc), doc, "canonicalization must be idempotent");
});

test("already canonical targets keep their attribute IDs and unrelated nodes unchanged", () => {
  const doc = fixture();
  doc.nodes.trigger.scripts = [{ id: "click", trigger: "click", steps: [
    { id: "known", kind: "show", target: "known-id" },
    { id: "missing", kind: "show", target: "" },
  ] }];
  const original = structuredClone(doc);
  normalizeImportedScriptTargets(doc);
  assert.deepEqual(doc, original);
});

test("component scripts resolve only targets in their own reusable master", () => {
  const doc = fixture();
  const root = { ...makeBox("Master"), id: "master", children: ["component-target", "component-trigger"] };
  const target = { ...makeBox("Component target"), id: "component-target" };
  const trigger = { ...makeBox("Component trigger"), id: "component-trigger",
    scripts: [{ id: "trigger", trigger: "click" as const, steps: [
      { id: "in", kind: "show" as const, target: "component-target" },
      { id: "out", kind: "show" as const, target: "panel" },
    ] }],
  };
  doc.nodes.master = root;
  doc.nodes["component-target"] = target;
  doc.nodes["component-trigger"] = trigger;
  doc.components = { card: { id: "card", name: "Card", rootId: "master" } };
  doc.nodes.instance = { ...makeBox("Instance"), id: "instance", type: "instance", componentId: "card" };
  doc.pages.home.children.push("instance");
  doc.pages.other.children.push("instance-two");
  doc.nodes["instance-two"] = { ...makeBox("Second instance"), id: "instance-two", type: "instance", componentId: "card" };
  normalizeImportedScriptTargets(doc);
  assert.equal(doc.nodes["component-target"].attrId, "component-target");
  const steps = doc.nodes["component-trigger"].scripts![0].steps;
  if (steps[0].kind !== "show" || steps[1].kind !== "show") throw new Error("wrong component script");
  assert.equal(steps[0].target, "component-target");
  assert.equal(steps[1].target, "panel", "component scripts must not borrow page-only targets");
});
