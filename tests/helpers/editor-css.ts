/** Reconstruct the editor stylesheet in cascade order across root and site layouts. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let cachedCss: string | undefined;

export function readEditorCss(): string {
  if (cachedCss !== undefined) return cachedCss;
  const extract = (file: string, base: string) =>
    [...readFileSync(resolve(file), "utf8").matchAll(/^import ["'](.+\.css)["'];?$/gm)]
      .map((match) => resolve(base, match[1]));
  const rootSheets = extract("app/layout.tsx", "app");
  const siteSheets = extract("app/sites/[id]/layout.tsx", "app/sites/[id]");
  const darkSheet = resolve("app/styles/editor-dark.css");
  const sheets = [
    ...rootSheets.filter((sheet) => sheet !== darkSheet),
    ...siteSheets,
    ...rootSheets.filter((sheet) => sheet === darkSheet),
  ];
  if (!sheets.length) throw new Error("No editor stylesheets imported by layout files");
  cachedCss = sheets.map((file) => readFileSync(file, "utf8")).join("\n");
  return cachedCss;
}
