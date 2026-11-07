import type { GeneratedProject } from "../generator";
import type { ExportFormat, ExportStyle } from "../export-formats";

/** Split generated CSS by real brace boundaries, respecting strings and comments. */
function blocks(css: string): { prelude: string; body: string }[] {
  const result: { prelude: string; body: string }[] = [];
  const n = css.length;
  let at = 0;
  const scan = (from: number, target: string) => {
    let quote = "", comment = false;
    for (let i = from; i < n; i++) {
      const ch = css[i];
      if (comment) {
        if (ch === "*" && css[i + 1] === "/") { comment = false; i++; }
        continue;
      }
      if (!quote && ch === "/" && css[i + 1] === "*") { comment = true; i++; continue; }
      if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === target) return i;
    }
    return -1;
  };
  while (at < n) {
    const open = scan(at, "{");
    if (open < 0) break;
    let depth = 1, i = open + 1, quote = "", comment = false;
    for (; i < n; i++) {
      const ch = css[i];
      if (comment) {
        if (ch === "*" && css[i + 1] === "/") { comment = false; i++; }
      } else if (!quote && ch === "/" && css[i + 1] === "*") {
        comment = true; i++;
      } else if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) break;
    }
    if (depth !== 0) throw new Error("Invalid generated CSS nesting");
    result.push({ prelude: css.slice(at, open).trim(), body: css.slice(open + 1, i) });
    at = i + 1;
  }
  return result;
}

function splitSelectors(source: string): string[] {
  const out: string[] = [];
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(source.slice(start).trim());
  return out.filter(Boolean);
}

/** Keep document-wide body rules and keyframes global; scope node classes to the module root. */
export function splitCssModule(source: string): { global: string; module: string } {
  const global: string[] = [], module: string[] = [];
  for (const { prelude, body } of blocks(source)) {
    const outer = prelude.replace(/^(?:\/\*[\s\S]*?\*\/\s*)+/, "");
    if (/^@(?:media|supports|container|layer)\b/i.test(outer)) {
      const child = splitCssModule(body);
      if (child.global.trim()) global.push(prelude + " {\n" + child.global + "\n}");
      if (child.module.trim()) module.push(prelude + " {\n" + child.module + "\n}");
      continue;
    }
    if (outer.startsWith("@")) {
      global.push(prelude + " {" + body + "}");
      continue;
    }
    const globalSelectors: string[] = [], moduleSelectors: string[] = [];
    for (const selector of splitSelectors(prelude)) {
      if (/^\.[\w-]|^\[data-instance-hidden/.test(selector)) {
        moduleSelectors.push(".tsumuRoot :global(" + selector + ")");
      } else globalSelectors.push(selector);
    }
    if (globalSelectors.length) global.push(globalSelectors.join(",\n") + " {" + body + "}");
    if (moduleSelectors.length) module.push(moduleSelectors.join(",\n") + " {" + body + "}");
  }
  return { global: global.join("\n\n") + "\n", module: ".tsumuRoot { display: contents; }\n\n" + module.join("\n\n") + "\n" };
}

function addCssModules(files: Record<string, string>, framework: ExportFormat) {
  const react = framework === "react";
  const cssPath = react ? "src/site.css" : "styles/site.css";
  const result = splitCssModule(files[cssPath] ?? "");
  delete files[cssPath];
  if (react) {
    files["src/site-global.css"] = result.global;
    files["src/site.module.css"] = result.module;
    files["src/main.tsx"] = files["src/main.tsx"].replace('"./site.css"', '"./site-global.css"');
    files["src/App.tsx"] = 'import siteStyles from "./site.module.css";\n' +
      files["src/App.tsx"].replace('    <>\n', '    <div className={siteStyles.tsumuRoot}>\n')
        .replace('    </>\n', '    </div>\n');
  } else {
    files["styles/site-global.css"] = result.global;
    files["styles/site.module.css"] = result.module;
    files["app/layout.tsx"] = files["app/layout.tsx"]
      .replace('import "../styles/site.css";', 'import "../styles/site-global.css";\nimport siteStyles from "../styles/site.module.css";')
      .replace(/(<body(?:\s[^>]*)?>)/, '$1\n        <div className={siteStyles.tsumuRoot}>')
      .replace("</body>", "</div>\n      </body>");
  }
}

function addTailwind(files: Record<string, string>, framework: ExportFormat) {
  const react = framework === "react";
  const css = react ? "src/globals.css" : "app/globals.css";
  // Do not import Preflight: it changes the user's existing layout, headings and forms.
  files[css] = '@import "tailwindcss/theme.css";\n@import "tailwindcss/utilities.css";\n\n' + files[css];
  const pkg = JSON.parse(files["package.json"]) as {
    devDependencies: Record<string, string>;
  };
  pkg.devDependencies.tailwindcss = "^4.1.0";
  if (react) {
    pkg.devDependencies["@tailwindcss/vite"] = "^4.1.0";
    files["vite.config.ts"] = files["vite.config.ts"].replace(
      'import { defineConfig } from "vite";',
      'import { defineConfig } from "vite";\nimport tailwindcss from "@tailwindcss/vite";'
    ).replace("export default defineConfig({", "export default defineConfig({\n  plugins: [tailwindcss()],");
  } else {
    pkg.devDependencies["@tailwindcss/postcss"] = "^4.1.0";
    files["postcss.config.mjs"] = [
      "export default {", '  plugins: { "@tailwindcss/postcss": {} },', "};", "",
    ].join("\n");
  }
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
}

export function applyExportStyle(
  project: GeneratedProject,
  framework: ExportFormat,
  style: Exclude<ExportStyle, "css">,
): GeneratedProject {
  const files = { ...project.files };
  if (style === "css-modules") addCssModules(files, framework);
  else addTailwind(files, framework);
  files["README.md"] += style === "css-modules"
    ? "\nCSS Modules: generated node styles are scoped to the site root; body rules and animation keyframes remain global.\n"
    : "\nTailwind CSS 4 utilities are enabled. Tsumu's generated CSS is retained to preserve authored visual styles.\n";
  return { ...project, files };
}
