import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const compiledBootstrapBundles = new Map<boolean, Promise<string>>();

/** 実際の Editor・ストア・同期の流れを動かす。省くのは、関係の無い表示のパネルだけ。 */
export async function editorBootstrapBundle(browser = false) {
  let cached = compiledBootstrapBundles.get(browser);
  if (cached) return cached;
  const repo = resolve(".");
  cached = build({
    stdin: {
      contents: browser ? `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import { loadLocale } from './lib/i18n'; import { useEditor } from './lib/store';
        void loadLocale().then(async () => {
          const { default: Editor } = await import('./components/Editor');
        const root = createRoot(document.getElementById('app'));
        window.pasteEditor = useEditor; window.unmountPasteEditor = () => root.unmount();
        root.render(<React.StrictMode><Editor /></React.StrictMode>);
        });
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
        // The editor itself is real; only the unrelated session status fetch is mocked.
        // An explicit editor role avoids relying on compatibility defaults.
        build.onResolve({ filter: /^\.\.\/lib\/status$/ }, (args) =>
          args.importer === resolve("components/Editor.tsx")
            ? { path: args.path, namespace: "presentation" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "presentation" }, (args) => ({
          contents: args.path === "../lib/status"
            ? `export function useServerStatus() { return { auth: false, db: false, assets: false, role: "editor" }; }`
            : args.path === "./Canvas"
            ? `import { createElement } from "react"; import { useEditor } from "./lib/store";
               export default function Canvas() { const name = useEditor((s) => s.doc.siteName);
                 return createElement("div", { "data-bootstrap-document": true }, name); }`
            : "export default function Presentation() { return null; }",
          loader: "tsx", resolveDir: repo,
        }));
      },
    }],
  }).then(result => result.outputFiles[0].text);
  compiledBootstrapBundles.set(browser, cached);
  return cached;
}

export async function editorBootstrapFixture() {
  const source = await editorBootstrapBundle();
  const module = { exports: {} as any };
  new Function("require", "module", "exports", source)(
    createRequire(resolve("package.json")), module, module.exports,
  );
  return module.exports;
}
