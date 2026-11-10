import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Run without a server or browser installation:
// node --import tsx --test e2e/browser-projects.check.mts
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

test("all three engines discover the same core editing smoke tests", () => {
  const report = JSON.parse(execFileSync(process.execPath, [
    require.resolve("@playwright/test/cli"), "test", "--list", "--reporter=json",
  ], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.config.projects.map((p: { name: string }) => p.name).sort(),
    ["chromium", "firefox", "webkit"]);

  type Suite = { suites?: Suite[]; specs?: {
    file: string; title: string; tags: string[]; tests: { projectName: string }[];
  }[] };
  const smoke = new Map<string, Set<string>>();
  const forms = new Map<string, Set<string>>();
  let chromiumOnly = 0;
  function visit(suite: Suite) {
    for (const spec of suite.specs ?? []) {
      const projects = spec.tests.map((t) => t.projectName).sort();
      const group = spec.tags.includes("core-editing") ? smoke : spec.tags.includes("form-values") ? forms : null;
      if (group) {
        assert.deepEqual(projects, ["chromium", "firefox", "webkit"], spec.title);
        const titles = group.get(spec.file) ?? new Set<string>();
        titles.add(spec.title);
        group.set(spec.file, titles);
      } else {
        assert.deepEqual(projects, ["chromium"], spec.title);
        chromiumOnly++;
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  // Guard against an empty/mis-spelled tag making a green but empty matrix.
  assert.equal(smoke.get("editor.spec.ts")?.size, 6);
  assert.equal(smoke.get("text-editing.spec.ts")?.size, 3);
  assert.equal(smoke.size, 2);
  assert.equal(forms.get("search-form-values.spec.ts")?.size, 2);
  assert.equal(forms.size, 1);
  assert.ok(chromiumOnly > 0, "keep the full existing Chromium suite");
});
