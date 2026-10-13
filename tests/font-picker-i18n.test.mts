import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(path: string) {
  const text = readFileSync(root + path, "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function translatedKeys(node: ts.Node): Set<string> {
  const keys = new Set<string>();
  function visit(child: ts.Node): void {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) &&
        child.expression.text === "tr" && child.arguments.length > 0 &&
        ts.isStringLiteralLike(child.arguments[0])) {
      keys.add(child.arguments[0].text);
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return keys;
}

/** Read literal translations from the source AST to avoid ESM/CJS default-import wrappers. */
const ja = new Map<string, string>();
for (const statement of source("lib/locales/ja.ts").statements) {
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) &&
        ts.isStringLiteralLike(node.initializer)) {
      ja.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(statement);
}

function assertAllTranslated(keys: ReadonlySet<string>): void {
  const missing = [...keys].filter(key => !ja.get(key)?.trim());
  assert.deepEqual(missing, [], "Japanese translations missing for user-facing font strings");
}

test("font-add modal translations cover all static tr() strings", () => {
  const component = source("components/style-panel/FontPicker.tsx");
  const keys = translatedKeys(component);
  assert.ok(keys.size >= 35, "unexpectedly few font modal strings checked");
  assertAllTranslated(keys);
});

test("Google Fonts categories are displayed through the translation function", () => {
  const file = source("components/style-panel/FontPicker.tsx").getFullText();
  const names = ["Sans Serif", "Serif", "Display", "Handwriting", "Monospace"];
  for (const name of names) {
    assert.ok(file.includes(`>{tr("${name}")}</option>`), `Category must be localized: ${name}`);
    assert.ok(ja.get(name), `Category must have a Japanese value: ${name}`);
  }
});

test("Adobe Fonts help topic translations are complete", () => {
  const tree = source("lib/manual-topics/text.ts");
  let topic: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(prop =>
      ts.isPropertyAssignment(prop) && prop.name.getText(tree) === "id" &&
      ts.isStringLiteralLike(prop.initializer) && prop.initializer.text === "text-adobe-fonts")) {
      topic = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(topic, "Adobe Fonts help topic missing");
  const keys = translatedKeys(topic);
  assert.ok(keys.size >= 10, "unexpectedly few Adobe help strings checked");
  assertAllTranslated(keys);
});
