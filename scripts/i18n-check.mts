/**
 * 訳の抜けを調べる: npm run i18n:check -- <言語コード>（既定 en）
 * ソースの tr("…") / trNodes("…") / trc("…", "…") の日本語のうち、その言語の辞書に無いものを
 * ファイルごとに出す。抜けがあれば終了コード 1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lang = process.argv[2] ?? "en";
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

const JA = /[぀-ヿ㐀-鿿]/;
const str = (s: string) => JSON.parse(`"${s}"`) as string;
const missing = new Map<string, string[]>();
const add = (f: string, key: string) => {
  const rel = path.relative(root, f);
  missing.set(rel, [...(missing.get(rel) ?? []), key]);
};
for (const f of files) {
  if (f.endsWith(path.join("lib", "i18n.ts"))) continue;
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\btr(?:Nodes)?\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = str(m[1]);
    if (JA.test(key) && !(key in dict)) add(f, key);
  }
  for (const m of src.matchAll(/\btrc\(\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = `${str(m[1])}\u0004${str(m[2])}`;
    if (!(key in dict) && !(str(m[2]) in dict)) add(f, key);
  }
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
