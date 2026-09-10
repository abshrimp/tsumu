import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { parse } from "acorn";
import { generateExportProject } from "../lib/export-formats";
import { makeText } from "../lib/presets";
import type { ScriptStep, SiteDoc } from "../lib/types";

const catalogCode = "^([A-Z]+)-([0-9]+)$";

function site(): SiteDoc {
  const transform: ScriptStep = {
    id: "replace", kind: "transform", source: "input", into: "output",
    transform: { kind: "replace", find: catalogCode, replacement: "$2:$1", regex: true },
  };
  return {
    siteName: "Catalog", assets: {}, pageOrder: ["home"],
    nodes: { text: { ...makeText("{output}"), id: "text", scripts: [
      { id: "click", trigger: "click", pos: { x: 0, y: 0 }, steps: [{ ...transform, id: "click-replace", into: "clickedOutput" }] },
    ] } },
    pages: { home: {
      id: "home", name: "Home", title: "Home", description: "", slug: "", children: ["text"],
      pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: "input", kind: "set-var", into: "input", value: "KIT-2026" }, transform,
      ] }],
    } },
  };
}

/** Extract the evaluator that survived code generation and pruning for this format. */
function emittedEvaluator(source: string): string {
  const pending: unknown[] = [parse(source, { ecmaVersion: "latest", sourceType: "module" })];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { pending.push(...value); continue; }
    const node = value as Record<string, unknown>;
    if (node.type === "VariableDeclarator") {
      const name = (node.id as { name?: string } | undefined)?.name;
      if (name === "evaluateValueRecipe" || name === "evalRecipe") {
        const expression = node.init as { start: number; end: number };
        return source.slice(expression.start, expression.end);
      }
    }
    pending.push(...Object.values(node));
  }
  assert.fail("export did not include its recipe evaluator");
}

// Each field starts with its first choice; each choice within a field has a distinct initial.
const catalogFields = [
  ["Mon", "Tue", "Wed"], ["red", "blue", "green"], ["small", "medium", "large"],
  ["east", "west", "north"], ["yes", "no", "later"], ["bus", "rail", "walk"],
];
function catalogSample(fieldCount: number) {
  const fields = catalogFields.slice(0, fieldCount);
  return {
    input: fields.map(([first]) => first).join("/"),
    pattern: "^" + fields.map((choices) => "(?:" + choices.join("|") + ")").join("/") + "$",
  };
}

for (const [framework, path] of [
  ["nextjs", "lib/value-recipe.ts"],
  ["react", "public/scripts.js"],
  ["html", "data-loader.js"],
  ["vue", "src/site-data.js"],
  ["nuxt", "app/generated/site-data.js"],
  ["sveltekit", "src/lib/site-data.js"],
] as const) {
  test(`${framework} published evaluator applies regex budgets to ordinary catalog values`, () => {
    const files = generateExportProject(site(), framework).files;
    assert.ok(files[path], path);
    const evaluator = emittedEvaluator(files[path]);
    const script = new vm.Script("const __name = (fn) => fn; (" + evaluator + ")(input, [transform]);");
    const evaluate = (input: string, find: string, replacement: string) => JSON.parse(JSON.stringify(
      script.runInNewContext({ input, transform: { kind: "replace", find, replacement, regex: true } }),
    ));
    const rejected = { kind: "error", code: "invalid-regex" };

    assert.deepEqual(evaluate("KIT-2026", catalogCode, "$2:$1"), { kind: "value", value: "2026:KIT" });
    const section = "CATALOG".repeat(200);
    assert.deepEqual(evaluate(section, "^([A-Z]+)$", "[$1]"), { kind: "value", value: "[" + section + "]" });
    assert.deepEqual(evaluate(section + "-2026", catalogCode, "$2:$1"), rejected);

    const five = catalogSample(5);
    assert.deepEqual(evaluate(five.input, five.pattern, "selected"), { kind: "value", value: "selected" });
    const six = catalogSample(6);
    assert.deepEqual(evaluate(six.input, six.pattern, "selected"), rejected);
  });
}
