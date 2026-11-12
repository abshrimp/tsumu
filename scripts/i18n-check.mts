/**
 * 1つの言語、または見つかったすべての辞書の訳を点検する。
 * 訳が欠けた項目は、既定では警告にとどめる（実行時は英語の原文で表示する）。
 * 訳がそろっていることを強制するには --strict を使う（日本語の CI など）。
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
// 生成した登録の一覧を import せず、ファイルを直接読む。
// この点検は、切り離したテスト用のツリーや、訳が途中の言語に対しても動く必要があるため。
const localeDir = path.join(root, "lib", "locales");
const available = new Map<string, string>();
for (const name of fs.readdirSync(localeDir)) {
  if (!name.endsWith(".ts") || name === "index.ts" || name.endsWith(".generated.ts")) continue;
  const code = Intl.getCanonicalLocales(name.slice(0, -3))[0].toLowerCase();
  available.set(code, name);
}
const codes = all ? [...available.keys()].sort() : [Intl.getCanonicalLocales(selected[0] ?? "ja")[0].toLowerCase()];
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
files.push(path.join(root, "auth.ts"), path.join(root, "proxy.ts"));

const literal = (node: ts.Node | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;

// 呼び出し箇所のキーを1回で集める（文脈ごとの参照も含む）。動的なキーは、
// 引き続き手動でのテストが必要。それらも、実行時は英語で表示する。
const required = new Map<string, Set<string>>();
for (const file of files) {
  if (file.endsWith(path.join("lib", "i18n.ts"))) continue;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const found = new Set<string>();
  // Phrase は、訳したスクリプトのブロックの文言に、操作できる部品を挿入する。
  const collectPhrase = (text: ts.Node | undefined): void => {
    if (!text) return;
    if (ts.isJsxExpression(text)) collectPhrase(text.expression);
    else if (ts.isConditionalExpression(text)) {
      collectPhrase(text.whenTrue);
      collectPhrase(text.whenFalse);
    } else if (ts.isStringLiteralLike(text)) found.add(text.text);
  };
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        ts.isIdentifier(node.tagName) && node.tagName.text === "Phrase") {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) && attr.name.text === "text") {
          collectPhrase(attr.initializer);
        }
      }
    }
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
