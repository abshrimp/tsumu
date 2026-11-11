/** Validate that every static English source key has a translation in the selected locale.
 * Run npm run i18n:check -- <language> (default: ja).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lang = process.argv[2] ?? "ja";
const file = path.join(root, "lib/locales", `${lang}.ts`);
if (!fs.existsSync(file)) {
  console.error(`lib/locales/${lang}.ts がありません`);
  process.exit(2);
}
const dict = (await import(file)).default as Record<string, string>;

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of fs.readdirSync(dir)) {
    if (["node_modules", ".next", ".open-next", ".wrangler", "locales"].includes(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
};
for (const d of ["app", "components", "lib"]) walk(path.join(root, d));
files.push(path.join(root, "auth.ts"), path.join(root, "middleware.ts"));

const literal = (node: ts.Node | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;
// Match the runtime's lookup: an empty translation falls back to the source text.
const translated = (key: string) => typeof dict[key] === "string" && dict[key].length > 0;
const missing = new Map<string, string[]>();
const add = (f: string, key: string) => {
  const rel = path.relative(root, f);
  missing.set(rel, [...(missing.get(rel) ?? []), key]);
};
for (const f of files) {
  if (f.endsWith(path.join("lib", "i18n.ts"))) continue;
  // Parse TS/TSX so comments and examples are not calls, and JavaScript literal
  // quoting/escapes are decoded correctly. Dynamic keys still require manual coverage.
  const source = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      const first = literal(node.arguments[0]);
      if ((name === "tr" || name === "trNodes") && first !== undefined) {
        const context = name === "tr" ? literal(node.arguments[1]) : literal(node.arguments[2]);
        const key = context === undefined ? first : `${context}\\u0004${first}`;
        if (!translated(key)) add(f, key);
      } else if (name === "trc" && first !== undefined) {
        const second = literal(node.arguments[1]);
        if (second !== undefined) {
          // trc only looks up the context-specific key; it does not fall back to tr.
          const key = `${first}\u0004${second}`;
          if (!translated(key)) add(f, key);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

let n = 0;
for (const [f, keys] of missing) {
  console.log(`\n${f}`);
  for (const k of new Set(keys)) {
    console.log(`  ${JSON.stringify(k)}`);
    n++;
  }
}
console.log(n ? `\n${n} untranslated strings for "${lang}"` : `All strings are translated for "${lang}"`);
process.exit(n ? 1 : 0);
