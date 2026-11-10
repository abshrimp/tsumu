import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { prepareExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

for (const language of ["typescript", "javascript"] as const) {
  for (const withScripts of [false, true]) {
    test(`React ${language} export compiles ${withScripts ? "with" : "without"} runtime scripts`, async () => {
      const doc: SiteDoc = {
        siteName: "Static React",
        pages: {
          home: { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["heading"] },
        },
        pageOrder: ["home"],
        nodes: { heading: { ...makeBox(), id: "heading", text: { content: "Hello", heading: 1 } } },
        assets: {},
      };
      if (withScripts) doc.pwa = { enabled: true };
      const project = await prepareExportProject(doc, { framework: "react", language, style: "css", scope: "project" });
      const extension = language === "typescript" ? "tsx" : "jsx";
      const app = project.files[`src/App.${extension}`];
      assert.match(app, withScripts ? /const scripts[^=]*=\s*\["\/pwa\.js"\]/ : /const scripts[^=]*=\s*\[\]/);
      assert.equal(Boolean(project.files["public/pwa.js"]), withScripts);

      const folder = mkdtempSync(join(tmpdir(), "tsumu-react-script-types-"));
      try {
        for (const [name, source] of Object.entries(project.files)) {
          const path = join(folder, name);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, source);
        }
        symlinkSync(resolve("node_modules"), join(folder, "node_modules"), "junction");
        if (language === "typescript") {
          const config = JSON.parse(project.files["tsconfig.json"]);
          // Vite 自体には依存せず、出力された React の全ソースを strict 設定で検証する。
          config.compilerOptions.types = ["node"];
          config.include = ["src"];
          writeFileSync(join(folder, "src/css.d.ts"), 'declare module "*.css";\n');
          writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(config));
          try {
            execFileSync(resolve("node_modules/.bin/tsc"), ["--project", folder], { encoding: "utf8" });
          } catch (cause) {
            const error = cause as { stdout?: string; stderr?: string; message?: string };
            assert.fail("Generated React failed strict TypeScript checking:\n" +
              (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""));
          }
        } else {
          assert.doesNotMatch(app, /const scripts\s*:/);
          buildSync({
            entryPoints: [join(folder, "src/main.jsx")],
            bundle: true, write: false, outdir: join(folder, "dist"), jsx: "automatic",
          });
        }
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });
  }
}
