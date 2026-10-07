import assert from "node:assert/strict";
import { test } from "node:test";
import { pagePlan } from "../lib/data";
import { compileScripts } from "../lib/script";
import { scriptsFile } from "../lib/script-runtime";
import { runtimeJsonBody } from "../lib/fetch-request";
import { makeBox } from "../lib/presets";
import type { ScriptStep, SiteDoc } from "../lib/types";

const initial: ScriptStep = {
  id: "initial", kind: "fetch", url: "https://data.example.test/catalog", as: "initial",
  preview: { sample: [{ name: "seed" }] },
};
const later: ScriptStep = {
  id: "interactive", kind: "fetch", url: "https://data.example.test/{q}", as: "items",
  method: "POST", headers: [{ name: "X-Query", value: "{q}" }],
  body: '{"q":"{q}","index":{index}}',
  preview: { sample: [{ name: "sample" }] },
};

function site(): SiteDoc {
  const node = makeBox();
  node.id = "button";
  node.scripts = [{ id: "click", trigger: "click", steps: [
    { id: "if", kind: "if", cond: { subject: "var", left: "{ready}", op: "eq", value: "true", target: "" },
      then: [later], else: [] },
    { id: "after", kind: "set-var", into: "done", value: "{items.0.name}" },
  ] }];
  return {
    schemaVersion: 1, siteName: "Event-driven data", assets: {}, nodes: { button: node },
    pageOrder: ["p"], pages: { p: {
      id: "p", name: "Page", slug: "", description: "", title: "",
      children: ["button"], pageScripts: [{ id: "load", trigger: "load", steps: [initial] }],
    } },
  };
}

test("only page-load root fetches are server-executed; event fetches remain live", () => {
  const doc = site(), plan = pagePlan(doc, "p");
  assert.deepEqual(plan.steps.map((step) => step.id), ["initial"]);
  assert.ok(plan.serverIds.has("initial"));
  assert.ok(plan.clientVars.has("items"));
  assert.equal(plan.clientVars.has("initial"), false);

  const page = compileScripts({ scripts: doc.pages.p.pageScripts }, () => "/", undefined, false, plan.serverIds);
  assert.deepEqual(page, []);

  const actions = compileScripts(doc.nodes.button, () => "/");
  const nested = actions[0].steps[0] as { then: Array<Record<string, unknown>> };
  const actual = nested.then[0];
  assert.equal(actual.kind, "fetch");
  assert.equal(actual.url, later.url);
  assert.equal(actual.body, later.body);
  assert.equal(actual.as, "items");
  assert.equal("preview" in actual, false);
  assert.equal("id" in actual, false);
  const runtime = scriptsFile(doc);
  assert.match(runtime, /st\.kind === "fetch"/);
});

test("JSON request template preserves types and escapes string values", () => {
  const vars: Record<string, unknown> = { q: 'a"b\\c', index: 3, list: [1, 2] };
  const output = runtimeJsonBody(
    '{"query":"{q}","index":{index},"list":{list},"missing":{unknown}}',
    (name) => vars[name],
    (value) => value == null ? "" : String(value)
  );
  assert.deepEqual(JSON.parse(output), { query: vars.q, index: 3, list: [1, 2], missing: null });
});
