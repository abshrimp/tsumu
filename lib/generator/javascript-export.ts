import type { GeneratedProject } from "../generator";
import type { ExportFormat } from "../export-formats";

/**
 * TypeScript -> JavaScript is a real syntax transformation, not regex stripping.
 * Load the compiler only when JavaScript is selected in the export dialog.
 */
export async function toJavaScriptProject(
  project: GeneratedProject,
  framework: ExportFormat,
): Promise<GeneratedProject> {
  const { default: ts } = await import("@typescript/typescript6");
  const files: Record<string, string> = {};
  for (const [path, source] of Object.entries(project.files)) {
    if (!/\.(?:tsx?|mts|cts)$/.test(path)) {
      files[path] = source;
      continue;
    }
    const jsx = /\.tsx$/.test(path);
    const result = ts.transpileModule(source, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        isolatedModules: true,
        removeComments: false,
      },
    });
    const failures = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (failures.length) {
      throw new Error("JavaScript export failed for " + path + ": " +
        failures.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; "));
    }
    const ext = jsx ? ".jsx" : ".js";
    const outPath = path.replace(/\.(?:tsx?|mts|cts)$/, ext);
    files[outPath] = result.outputText;
  }

  // Keep the original framework tooling, but replace source language configs.
  if (files["tsconfig.json"]) {
    const tsconfig = JSON.parse(files["tsconfig.json"]) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = tsconfig.compilerOptions?.paths;
    files["jsconfig.json"] = JSON.stringify({
      compilerOptions: {
        ...(paths ? { baseUrl: ".", paths } : {}),
        checkJs: false,
      },
      exclude: ["node_modules", ".next", "dist", "out"],
    }, null, 2) + "\n";
    delete files["tsconfig.json"];
  }
  const pkg = JSON.parse(files["package.json"]) as {
    scripts: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (framework === "react") {
    // Vite reads this entry from index.html; transpiling main.tsx to main.jsx
    // without rewriting the entry leaves a ZIP that cannot be built.
    if (files["index.html"]) {
      files["index.html"] = files["index.html"].replace(
        'src/main.tsx', 'src/main.jsx',
      );
    }
    pkg.scripts.build = "vite build";
    delete pkg.devDependencies?.typescript;
    delete pkg.devDependencies?.["@types/react"];
    delete pkg.devDependencies?.["@types/react-dom"];
    delete pkg.devDependencies?.["@types/node"];
  }
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  files["README.md"] += "\nJavaScript source files (.js/.jsx) are provided instead of TypeScript (.ts/.tsx).\n";
  return { ...project, files };
}
