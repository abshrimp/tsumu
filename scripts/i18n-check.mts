/**
 * Audit translations for one language or all discovered dictionaries.
 * Missing entries warn by default (English source is the runtime fallback).
 * Use --strict to enforce complete translations, e.g. for Japanese CI.
 *
 * npm run i18n:check -- fr
 * npm run i18n:check -- --strict ja
 * npm run i18n:check -- --all
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const knownFlags = new Set(["--all", "--strict", "--verbose"]);
const unknownFlags = args.filter((arg) => arg.startsWith("--") && !knownFlags.has(arg));
if (unknownFlags.length) throw new Error("Unknown options: " + unknownFlags.join(", "));
const strict = args.includes("--strict");
const all = args.includes("--all");
const verbose = args.includes("--verbose");
const selected = args.filter((arg) => !arg.startsWith("--"));
if ((all && selected.length) || selected.length > 1) {
  throw new Error("Specify either one language or --all");
}
// Read files directly rather than importing the generated registry: the
// checker must also run against isolated test trees and incomplete locales.
const localeDir = path.join(root, "lib", "locales");
const available = new Map<string, string>();
for (const name of fs.readdirSync(localeDir)) {
  if (!name.endsWith(".ts") || name === "index.ts" || name.endsWith(".generated.ts")) continue;
  const code = Intl.getCanonicalLocales(name.slice(0, -3))[0].toLowerCase();
  available.set(code, name);
}
const codes = all ? [...available.keys()].sort() : [selected[0] ?? "ja"];
for (const code of codes) {
  if (code !== "en" && !available.has(code)) throw new Error("Unknown language: " + code);
}

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

// Collect callsite keys once, including context-specific lookups. Dynamic keys
// still require manual tests; the runtime falls back to English for those too.
const required = new Map<string, Set<string>>();
for (const file of files) {
  if (file.endsWith(path.join("lib", "i18n.ts"))) continue;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const found = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      const first = literal(node.arguments[0]);
      if ((name === "tr" || name === "trNodes") && first !== undefined) {
        const context = name === "tr" ? literal(node.arguments[1]) : literal(node.arguments[2]);
        found.add(context === undefined ? first : context + "\u0004" + first);
      } else if (name === "trc" && first !== undefined) {
        const key = literal(node.arguments[1]);
        if (key !== undefined) found.add(first + "\u0004" + key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found.size) required.set(path.relative(root, file), found);
}

let failed = false;
for (const code of codes) {
  if (code === "en") {
    console.log("English is the source language; no dictionary is required.");
    continue;
  }
  const file = path.join(localeDir, available.get(code)!);
  const dict = (await import(file)).default as Record<string, string>;
  if (!dict || typeof dict !== "object" || Array.isArray(dict)) {
    throw new Error("Invalid dictionary in " + file);
  }

  const missing: { file: string; key: string }[] = [];
  for (const [source, keys] of required) {
    for (const key of keys) {
      if (typeof dict[key] !== "string" || dict[key].length === 0) {
        missing.push({ file: source, key });
      }
    }
  }
  if (!missing.length) {
    console.log("All static strings are translated for " + code);
    continue;
  }

  const limit = verbose || strict ? missing.length : Math.min(missing.length, 25);
  for (const { file: source, key } of missing.slice(0, limit)) {
    console.log(source + ": " + JSON.stringify(key));
  }
  if (limit < missing.length) {
    console.log("... and " + (missing.length - limit) + " more (use --verbose to list all)");
  }
  const message = missing.length + " untranslated strings for " + code +
    " (English fallback applies; dynamic keys need separate verification)";
  if (strict) {
    console.error("ERROR: " + message);
    failed = true;
  } else {
    console.warn("WARNING: " + message);
  }
}
if (failed) process.exitCode = 1;
