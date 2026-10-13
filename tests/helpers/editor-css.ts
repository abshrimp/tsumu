/** Reconstruct the editor stylesheet in the same order as the root layout. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readEditorCss(): string {
  const layout = readFileSync(resolve("app/layout.tsx"), "utf8");
  const sheets = [...layout.matchAll(/^import ["']\.\/(.+\.css)["'];?$/gm)].map((match) => match[1]);
  if (!sheets.length) throw new Error("No editor stylesheets imported by app/layout.tsx");
  return sheets.map((file) => readFileSync(resolve("app", file), "utf8")).join("\n");
}
