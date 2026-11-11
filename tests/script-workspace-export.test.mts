import assert from "node:assert/strict";
import { test } from "node:test";
import { scriptWorkspaceDoc } from "./helpers/script-workspace";
import { generateExportProject } from "../lib/export-formats";

for (const layout of ["single", "stacks"] as const) {
  test(`${layout} script workspace exports 4000 blocks without mutation`, () => {
    const doc = scriptWorkspaceDoc(layout);
    const scripts = doc.pages.p.pageScripts!;
    assert.equal(scripts.length, layout === "single" ? 1 : 160);
    const steps = scripts.flatMap((script) => script.steps);
    assert.equal(steps.length, 4000);
    assert.equal(new Set(steps.map((step) => step.id)).size, 4000);
    assert.deepEqual(scriptWorkspaceDoc(layout), doc, "test fixture must be deterministic");
    const snapshot = JSON.stringify(doc);
    const project = generateExportProject(doc, "nextjs");
    const encoded = project.files["app/page.tsx"].match(/data-scripts=\{("(?:[^"\\]|\\.)*")\}/)?.[1];
    assert.ok(encoded, "export contains the page script payload");
    const exported = JSON.parse(JSON.parse(encoded));
    assert.deepEqual(exported, scripts.map((script) => ({
      trigger: "load", steps: script.steps.map(() => ({ kind: "wait", seconds: 1 })),
    })), "all 4000 operations must be exported, not just an empty page");
    assert.equal(JSON.stringify(doc), snapshot);
  });
}
