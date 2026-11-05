import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** サイト確認・遅延 import・実際のエディタ同期を通し、表示だけのパネルは省く。 */
export async function siteBootstrapBundle(browser = false) {
  const repo = resolve(".");
  return (await build({
    stdin: {
      contents: browser ? `
        import React from 'react'; import { createRoot } from 'react-dom/client';
        import SitePage from './app/sites/[id]/page';
        import ErrorPage from './app/error';
        import { createInitialDoc } from './lib/presets';
        class Boundary extends React.Component {
          state = { error: null };
          static getDerivedStateFromError(error) { return { error }; }
          render() { return this.state.error
            ? <ErrorPage error={this.state.error} reset={() => this.setState({ error: null })} />
            : this.props.children; }
        }
        const root = createRoot(document.getElementById('app'));
        window.bootstrapDoc = createInitialDoc;
        window.mountBootstrap = (strict = true) => root.render(strict
          ? <React.StrictMode><Boundary><SitePage /></Boundary></React.StrictMode>
          : <Boundary><SitePage /></Boundary>);
        window.leaveBootstrap = () => root.render(<div data-left-editor>home</div>);
        window.disposeBootstrap = () => root.unmount();
        window.mountBootstrap(window.bootstrapStrict !== false);
      ` : `export { default as SitePage } from './app/sites/[id]/page'; export { createInitialDoc } from './lib/presets';`,
      resolveDir: repo, loader: "tsx",
    },
    bundle: true, platform: browser ? "browser" : "node", format: browser ? "iife" : "cjs",
    packages: browser ? undefined : "external", write: false, jsx: "automatic",
    define: browser ? { "process.env.NODE_ENV": '"development"' } : undefined,
    plugins: [{
      name: "site-bootstrap",
      setup(build) {
        build.onLoad({ filter: /app\/sites\/\[id\]\/page\.tsx$/ }, (args) => ({
          // import の完了順だけを制御し、実際のページとエディタは差し替えない。
          contents: readFileSync(args.path, "utf8").replace(
            'import("../../../components/Editor")',
            'Promise.resolve(globalThis.bootstrapModule).then(() => import("../../../components/Editor"))',
          ),
          loader: "tsx", resolveDir: resolve(args.path, ".."),
        }));
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
  })).outputFiles[0].text;
}

export async function siteBootstrapFixture() {
  const module = { exports: {} as any };
  new Function("require", "module", "exports", await siteBootstrapBundle())(
    createRequire(resolve("package.json")), module, module.exports,
  );
  return module.exports;
}
