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
      // CSS Modules localizes animation names even when the keyframes were
      // placed in another stylesheet. Keep a local definition too; the global
      // copy remains necessary for document-wide rules such as body animations.
      if (/^@(?:-[a-z]+-)?keyframes\b/i.test(outer)) module.push(prelude + " {" + body + "}");
      continue;
    }
    const globalSelectors: string[] = [], moduleSelectors: string[] = [];
    for (const selector of splitSelectors(prelude)) {
      if (/^\.[\w-]|^\[data-instance-hidden/.test(selector)) {
        moduleSelectors.push(".siteRoot :global(" + selector + ")");
      } else globalSelectors.push(selector);
    }
    if (globalSelectors.length) global.push(globalSelectors.join(",\n") + " {" + body + "}");
    if (moduleSelectors.length) module.push(moduleSelectors.join(",\n") + " {" + body + "}");
  }
  return { global: global.join("\n\n") + "\n", module: ".siteRoot { display: contents; }\n\n" + module.join("\n\n") + "\n" };
}

function addCssModules(files: Record<string, string>, framework: ExportFormat) {
  const path = framework === "vue" || framework === "sveltekit" || framework === "react"
    ? "src/site.css" : framework === "nuxt" ? "app/assets/site.css" : "styles/site.css";
  const result = splitCssModule(files[path] ?? "");
  delete files[path];
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  files[dir + "site-global.css"] = result.global;
  files[dir + "site.module.css"] = result.module;

  if (framework === "react") {
    files["src/main.tsx"] = files["src/main.tsx"].replace('"./site.css"', '"./site-global.css"');
    files["src/App.tsx"] = 'import siteStyles from "./site.module.css";\n' +
      files["src/App.tsx"].replace('    <>\n', '    <div className={siteStyles.siteRoot}>\n')
        .replace('    </>\n', '    </div>\n');
  } else if (framework === "vue" || framework === "nuxt") {
    if (framework === "vue") {
      for (const name of ["src/entry-client.ts", "src/entry-client.js", "src/main.ts", "src/main.js"]) {
        if (files[name]) files[name] = files[name].replace('"./site.css"', '"./site-global.css"');
      }
      files["src/App.vue"] = files["src/App.vue"]
        .replace(/(<script setup(?: lang="ts")?>)/,
          '$1\nimport siteStyles from "./site.module.css";')
        .replace("<template>", '<template>\n  <div :class="siteStyles.siteRoot" style="display:contents">')
        .replace("</template>", "  </div>\n</template>");
    } else {
      for (const config of ["nuxt.config.ts", "nuxt.config.js"]) {
        if (files[config]) files[config] = files[config]
          .replace("~/assets/site.css", "~/assets/site-global.css");
      }
      files["app/app.vue"] = [
        '<script setup>',
        'import siteStyles from "./assets/site.module.css";',
        '</script>',
        '<template>',
        '  <div :class="siteStyles.siteRoot" style="display:contents">',
        '    <NuxtPage />',
        '  </div>',
        '</template>', '',
      ].join("\n");
    }
  } else if (framework === "sveltekit") {
    files["src/routes/+layout.svelte"] = files["src/routes/+layout.svelte"]
      .replace('import "../site.css";',
        'import "../site-global.css";\nimport siteStyles from "../site.module.css";')
      .replace('{@render children()}',
        '<div class={siteStyles.siteRoot} style="display:contents">{@render children()}</div>');
  } else {
    files["app/layout.tsx"] = files["app/layout.tsx"]
      .replace('import "../styles/site.css";', 'import "../styles/site-global.css";\nimport siteStyles from "../styles/site.module.css";')
      .replace(/(<body(?:\s[^>]*)?>)/, '$1\n        <div className={siteStyles.siteRoot}>')
      .replace("</body>", "</div>\n      </body>");
  }
}

function addTailwind(files: Record<string, string>, framework: ExportFormat) {
  const css = framework === "react" || framework === "vue" || framework === "sveltekit"
    ? "src/globals.css" : framework === "nuxt" ? "app/assets/globals.css" : "app/globals.css";
  // Do not import Preflight: it changes authored headings, layouts and form defaults.
  files[css] = '@import "tailwindcss/theme.css";\n@import "tailwindcss/utilities.css";\n\n' + files[css];
  const pkg = JSON.parse(files["package.json"]) as { devDependencies: Record<string, string> };
  pkg.devDependencies.tailwindcss = "^4.1.0";
  if (framework === "react" || framework === "vue" || framework === "sveltekit") {
    pkg.devDependencies["@tailwindcss/vite"] = "^4.1.0";
    const config = framework === "sveltekit"
      ? Object.hasOwn(files, "vite.config.ts") ? "vite.config.ts" : "vite.config.js"
      : Object.hasOwn(files, "vite.config.ts") ? "vite.config.ts" : "vite.config.js";
    files[config] = 'import tailwindcss from "@tailwindcss/vite";\n' + files[config];
    if (framework === "vue") files[config] = files[config]
      .replace("plugins: [vue()]", "plugins: [vue(), tailwindcss()]");
    else if (framework === "sveltekit") {
      // SvelteKit's scaffold calls sveltekit({ adapter: adapter() }), not
      // sveltekit(). Matching only the zero-argument call silently left
      // Tailwind's Vite plugin disabled and utility classes ungenerated.
      const vitePlugins = "plugins: [sveltekit(";
      if (!files[config].includes(vitePlugins)) {
        throw new Error("Cannot enable Tailwind: missing SvelteKit Vite plugin");
      }
      files[config] = files[config].replace(
        vitePlugins, "plugins: [tailwindcss(), sveltekit(");
    }
    if (framework === "react") files[config] = files[config]
      .replace('export default defineConfig({', 'export default defineConfig({\n  plugins: [tailwindcss()],');
  } else if (framework === "nuxt") {
    pkg.devDependencies["@tailwindcss/vite"] = "^4.1.0";
    const config = Object.hasOwn(files, "nuxt.config.ts") ? "nuxt.config.ts" : "nuxt.config.js";
    files[config] = 'import tailwindcss from "@tailwindcss/vite";\n' + files[config]
      .replace("defineNuxtConfig({", "defineNuxtConfig({\n  vite: { plugins: [tailwindcss()] },");
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
    : "\nTailwind CSS 4 utilities are enabled. The original generated CSS is retained to preserve authored visual styles.\n";
  return { ...project, files };
}
