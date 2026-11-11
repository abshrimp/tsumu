import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { renameVarInPage, obfuscateVarNames, pagePlan } from "../lib/data";
import { validDocumentScripts } from "../lib/document-validation";
import { makeBox } from "../lib/presets";
import { compileScripts } from "../lib/script";
import { SCRIPT_RUNTIME, scriptsFile } from "../lib/script-runtime";
import type { Script, ScriptStep, SiteDoc } from "../lib/types";

const pos = { x: 16, y: 16 };

function fixture(watchers: Script[], clickSteps: ScriptStep[]): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Variable changes", assets: {}, pageOrder: ["p"],
    pages: {
      p: {
        id: "p", name: "P", slug: "", title: "", description: "",
        children: ["button"], pageScripts: watchers,
      },
    },
    nodes: {
      button: {
        ...makeBox(), id: "button",
        scripts: [{ id: "click", trigger: "click", pos, steps: clickSteps }],
      },
    },
  };
}

function watcher(id: string, variable: string, steps: ScriptStep[]): Script {
  return { id, pos, trigger: "change", changeVariable: variable, steps };
}

function browserRun(published: boolean, doc: SiteDoc, search = "") {
  const notifications: { name: string; value: unknown }[] = [];
  const listeners = new Map<string, Array<(event: { target: unknown }) => void>>();
  const on = (type: string, fn: (event: { target: unknown }) => void) =>
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const pageScripts = JSON.stringify(compileScripts(
    { scripts: doc.pages.p.pageScripts }, () => "/", undefined, true, pagePlan(doc, "p").serverIds,
  ));
  const nodeScripts = JSON.stringify(compileScripts(doc.nodes.button, () => "/"));
  const marker = {
    nodeType: 1, parentElement: null,
    getAttribute: (name: string) =>
      name === "data-page-body" ? "p" : name === "data-scripts" ? pageScripts : null,
  };
  const button = {
    nodeType: 1, parentElement: null,
    getAttribute: (name: string) => name === "data-scripts" ? nodeScripts : null,
    closest: (selector: string) => selector === "[data-scripts]" ? button : null,
  };
  const root = {
    querySelector: (selector: string) => selector === "[data-page-body]" ? marker : null,
    querySelectorAll: (selector: string) => selector === "[data-scripts]" ? [marker, button] : [],
    contains: () => true,
    addEventListener: on,
    removeEventListener: () => {},
  };
  const globals = {
    document: root, location: { search }, URLSearchParams,
    window: {
      __siteVarsOnChange: (name: string, value: unknown) => notifications.push({ name, value }),
    },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => {},
    CSS: { escape: (text: string) => text },
    setTimeout, clearTimeout,
  };
  const script = published ? scriptsFile(doc) : "(" + SCRIPT_RUNTIME + ")({}).install(document);";
  runInNewContext(script, globals);
  return {
    notifications,
    click: () => (listeners.get("click") ?? []).forEach((fn) => fn({ target: button })),
  };
}

test("existing element-change scripts remain valid without a migration", () => {
  const legacy: Script = {
    id: "old", trigger: "change", pos,
    steps: [{ id: "set", kind: "set-var", into: "seen", value: "true" }],
  };
  const modern = watcher("new", "stats.total", legacy.steps);
  assert.equal(validDocumentScripts([legacy, modern]), true);
  const compiled = compileScripts({ scripts: [legacy, modern] }, () => "/");
  assert.equal("changeVariable" in compiled[0], false);
  assert.equal(compiled[1].changeVariable, "stats.total");
  assert.equal(compileScripts({ scripts: [watcher("empty", "", legacy.steps)] }, () => "/").length, 0);
});

test("renaming and exported variable obfuscation update watched variable paths", () => {
  const doc = fixture([
    watcher("watch", "stats.total", [
      { id: "seen", kind: "set-var", into: "status", value: "true" },
    ]),
  ], [
    { id: "assign", kind: "set-var", into: "stats", value: "{}" },
  ]);
  // The name-editing flow first renames the producer, then updates references.
  const producer = doc.nodes.button.scripts![0].steps[0];
  if (producer.kind !== "set-var") throw new Error("expected set-var producer");
  producer.into = "renamed";
  renameVarInPage(doc, "p", "stats", "renamed");
  assert.equal(doc.pages.p.pageScripts?.[0].changeVariable, "renamed.total");
  const published = obfuscateVarNames(doc);
  const assignment = published.nodes.button.scripts?.[0].steps[0];
  assert.equal(assignment?.kind, "set-var");
  if (assignment?.kind !== "set-var") return;
  assert.notEqual(assignment.into, "renamed");
  assert.equal(published.pages.p.pageScripts?.[0].changeVariable, assignment.into + ".total");
  assert.equal(doc.pages.p.pageScripts?.[0].changeVariable, "renamed.total", "source doc must remain unchanged");
});

for (const published of [false, true]) {
  const where = published ? "published" : "preview";

  test(where + " fires variable-change trigger only when the value changes", () => {
    const doc = fixture([
      watcher("watch", "count", [
        { id: "record", kind: "set-var", into: "seen", value: "{count}" },
      ]),
    ], [
      { id: "first", kind: "set-var", into: "count", value: "1" },
      { id: "same", kind: "set-var", into: "count", value: "1" },
      { id: "second", kind: "set-var", into: "count", value: "2" },
      { id: "unrelated", kind: "set-var", into: "other", value: "7" },
    ]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(
      harness.notifications.filter((n) => n.name === "seen").map((n) => n.value),
      [1, 2],
    );
  });

  test(where + " watches nested paths and ignores unchanged descendants", () => {
    const doc = fixture([
      watcher("child", "nested.item", [
        { id: "child-seen", kind: "set-var", into: "childSeen", value: "{nested.other}" },
      ]),
      watcher("parent", "nested", [
        { id: "parent-seen", kind: "set-var", into: "parentSeen", value: "{nested.other}" },
      ]),
    ], [
      { id: "first", kind: "set-var", into: "nested.item", value: "1" },
      { id: "same", kind: "set-var", into: "nested.item", value: "1" },
      { id: "parent", kind: "set-var", into: "nested", value: "{\"item\":1,\"other\":2}" },
    ]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(harness.notifications.filter((n) => n.name === "childSeen").map((n) => n.value), [undefined]);
    assert.deepEqual(harness.notifications.filter((n) => n.name === "parentSeen").map((n) => n.value), [undefined, 2]);
  });

  test(where + " writes missing values before resolving URL parameters of the same name", () => {
    const doc = fixture([], [
      { id: "input", kind: "set-var", into: "data", value: "{}" },
      { id: "missing", kind: "transform", source: "data", into: "result",
        transform: { kind: "field", key: "absent" } },
      { id: "output", kind: "set-var", into: "message", value: "Found: {result}" },
    ]);
    const harness = browserRun(published, doc, "?result=stale");
    harness.click();
    assert.equal(harness.notifications.find((entry) => entry.name === "message")?.value, "Found: ");
  });

  test(where + " tracks last-item and length references across indexed writes", () => {
    const doc = fixture([
      watcher("tail", "items.-1", [{ id: "a", kind: "set-var", into: "tail", value: "{items.-1}" }]),
      watcher("size", "items.length", [{ id: "b", kind: "set-var", into: "size", value: "{items.length}" }]),
    ], [
      { id: "init", kind: "set-var", into: "items", value: "[1]" },
      { id: "append", kind: "set-var", into: "items.1", value: "2" },
      { id: "edit", kind: "set-var", into: "items.1", value: "3" },
      { id: "first", kind: "set-var", into: "items.0", value: "4" },
    ]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(harness.notifications.filter((n) => n.name === "tail").map((n) => n.value), [1, 2, 3]);
    assert.deepEqual(harness.notifications.filter((n) => n.name === "size").map((n) => n.value), [1, 2]);
  });

  test(where + " fires watchers in order for assignments in page-load scripts", () => {
    const doc = fixture([
      watcher("watch", "stats.total", [
        { id: "record", kind: "set-var", into: "seen", value: "{stats.total}" },
      ]),
      { id: "load", pos, trigger: "load", steps: [
        { id: "init", kind: "set-var", into: "stats", value: '{"total":1}' },
        { id: "loop", kind: "repeat", times: 1, then: [
          { id: "update", kind: "set-var", into: "stats.total", value: "2" },
          { id: "copy", kind: "set-var", into: "after", value: "{seen}" },
        ] },
        { id: "independent", kind: "set-var", into: "title", value: "Example" },
      ] },
    ], []);
    const plan = pagePlan(doc, "p");
    assert.deepEqual([...plan.serverIds], ["independent"]);
    assert.ok(plan.clientVars.has("stats") && plan.clientVars.has("after"));
    assert.deepEqual(browserRun(published, doc).notifications.filter((n) => n.name === "seen").map((n) => n.value), [1, 2]);
  });

  test(where + " prevents recursive variable-trigger updates", () => {
    const doc = fixture([
      watcher("self", "count", [
        { id: "replace", kind: "set-var", into: "count", value: "2" },
      ]),
    ], [{ id: "start", kind: "set-var", into: "count", value: "1" }]);
    const harness = browserRun(published, doc);
    harness.click();
    assert.deepEqual(harness.notifications.filter((n) => n.name === "count").map((n) => n.value), [1, 2]);
  });
}

test("browser list edits retain their initialized variable and record the exact mutation target", () => {
  const doc = fixture([
    { id: "load", pos, trigger: "load", steps: [
      { id: "init", kind: "set-var", into: "catalog", value: '{"rows":[1,2]}' },
      { id: "server-init", kind: "set-var", into: "serverRows", value: "[1,2]" },
      { id: "server-loop", kind: "repeat", times: 1, then: [
        { id: "server-append", kind: "set-list-item", list: "serverRows", key: "", value: "3" },
      ] },
    ] },
  ], [{ id: "remove", kind: "remove-list-item", list: "catalog.rows", mode: "key", value: "0" }]);
  const plan = pagePlan(doc, "p");
  assert.equal(plan.serverIds.has("init"), false);
  assert.ok(plan.serverIds.has("server-loop"));
  assert.deepEqual([...plan.clientListTargets], ["catalog.rows"]);
  assert.ok(plan.clientVars.has("catalog"));
});
