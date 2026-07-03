import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** Run the real Editor/store/sync lifecycle; only unrelated presentation panels are omitted. */
export async function editorBootstrapBundle(browser = false) {
  const repo = resolve(".");
  const result = await build({
    stdin: {
      contents: browser ? `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import Editor from './components/Editor'; import { useEditor } from './lib/store';
        const root = createRoot(document.getElementById('app'));
        window.pasteEditor = useEditor; window.unmountPasteEditor = () => root.unmount();
        root.render(<React.StrictMode><Editor /></React.StrictMode>);
      ` : `export { default as Editor } from './components/Editor'; export { useEditor } from './lib/store'; export { createInitialDoc } from './lib/presets';`,
      resolveDir: repo, loader: "tsx",
    },
    bundle: true, platform: browser ? "browser" : "node", format: browser ? "iife" : "cjs",
    packages: browser ? undefined : "external", write: false, jsx: "automatic",
    define: browser ? { "process.env.NODE_ENV": '"development"' } : undefined,
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
  return result.outputFiles[0].text;
}

export async function editorBootstrapFixture() {
  const source = await editorBootstrapBundle();
  const module = { exports: {} as any };
  new Function("require", "module", "exports", source)(
    createRequire(resolve("package.json")), module, module.exports,
  );
  return module.exports;
}
