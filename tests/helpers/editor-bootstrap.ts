import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** Run the real Editor/store/sync lifecycle; only unrelated presentation panels are omitted. */
export async function editorBootstrapFixture() {
  const repo = resolve(".");
  const result = await build({
    stdin: {
      contents: `export { default as Editor } from './components/Editor'; export { useEditor } from './lib/store'; export { createInitialDoc } from './lib/presets';`,
      resolveDir: repo, loader: "tsx",
    },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{
      name: "bootstrap-presentation",
      setup(build) {
        build.onResolve({ filter: /^\.\// }, (args) => {
          if (args.importer !== resolve("components/Editor.tsx") || ["./SafeBoundary", "./EditorLoading"].includes(args.path)) return;
          return { path: args.path, namespace: "presentation" };
        });
        build.onLoad({ filter: /.*/, namespace: "presentation" }, (args) => ({
          contents: args.path === "./Canvas"
            ? `import { createElement } from "react"; import { useEditor } from "./lib/store";
               export default function Canvas() { const name = useEditor((s) => s.doc.siteName);
                 return createElement("div", { "data-bootstrap-document": true }, name); }`
            : "export default function Presentation() { return null; }",
          loader: "tsx", resolveDir: repo,
        }));
      },
    }],
  });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    createRequire(resolve("package.json")), module, module.exports,
  );
  return module.exports;
}
