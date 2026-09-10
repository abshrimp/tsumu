import { build, type Plugin } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as React from "react";
import type { SiteInput, SiteRecord } from "../../lib/sites";
import { fakeIndexedDB } from "./fake-indexeddb";

const require = createRequire(resolve("package.json"));
const repo = resolve(".");

/** ホームの操作と保存処理は実物を使い、認証・設定表示だけを切り離す。 */
const homeMocks: Plugin = {
  name: "home-site-storage",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer !== resolve("components/Home.tsx")) return;
      if ((args.path.startsWith("./") && args.path !== "./DialogHost") || ["../lib/status", "../lib/no-dblclick-select", "next-auth/react"].includes(args.path)) {
        return { path: args.path, namespace: "home-presentation" };
      }
    });
    build.onLoad({ filter: /.*/, namespace: "home-presentation" }, (args) => ({
      contents: args.path.endsWith("/status") ? "export const useServerStatus = () => ({ auth: false, db: false });"
        : args.path.endsWith("no-dblclick-select") ? "export const installNoDblClickSelect = () => () => {};"
        : args.path === "next-auth/react" ? "export const signOut = async () => {};"
        : "export default function Presentation() { return null; }",
      loader: "js",
    }));
  },
};

/** フックの状態だけを保持し、実 Home が SiteDialog に渡す onSave を直接実行する。 */
export async function homeSiteFixture(storage: Storage) {
  const result = await build({
    stdin: {
      contents: "export { default as Home } from './components/Home'; export { loadLocalSites } from './lib/site'; export { useDialogs, closeDialog } from './lib/dialog';",
      resolveDir: repo, loader: "tsx",
    },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [homeMocks],
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  const location = { pathname: "/", search: "", href: "/" };
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage, indexedDB: fakeIndexedDB(), location, history: { replaceState() {} },
      addEventListener() {}, removeEventListener() {}, }, configurable: true,
  });
  globalThis.fetch = async () => Response.json({}, { status: 503 });
  let cursor = 0;
  let initial = true;
  const states: any[] = [];
  const effects: (() => unknown)[] = [];
  const hooks = {
    ...React,
    useState(value: any) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof value === "function" ? value() : value;
      return [states[index], (next: any) => {
        states[index] = typeof next === "function" ? next(states[index]) : next;
      }];
    },
    useEffect(fn: () => unknown) { if (initial) effects.push(fn); },
    useCallback(fn: unknown) { return fn; },
    useMemo(fn: () => unknown) { return fn(); },
    useRef(value: unknown) { return { current: value }; },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    (name: string) => name === "react" ? hooks : require(name), module, module.exports,
  );
  let tree: any;
  function render() { cursor = 0; tree = module.exports.Home(); initial = false; }
  function find(predicate: (element: any) => boolean, element = tree): any {
    if (!element || typeof element !== "object") return null;
    if (predicate(element)) return element;
    for (const child of [element.props?.children].flat(Infinity)) {
      if (child == null) continue;
      const found = find(predicate, child);
      if (found) return found;
    }
    return null;
  }
  render();
  effects.forEach((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  render();
  return {
    location,
    sites: () => module.exports.loadLocalSites() as SiteRecord[],
    cards: () => {
      render();
      return find((e) => e.props?.className === "home-grid")?.props.children ?? [];
    },
    duplicate(id: string) {
      render();
      find((e) => e.props?.site?.id === id && e.props.onDuplicate).props.onDuplicate();
      render();
    },
    settings(id: string) {
      render();
      find((e) => e.props?.site?.id === id && e.props.onSettings).props.onSettings();
      render();
    },
    remove(id: string) {
      render();
      find((e) => e.props?.site?.id === id && e.props.onDelete).props.onDelete();
    },
    flush: () => new Promise<void>((resolve) => setImmediate(resolve)),
    prompt: () => module.exports.useDialogs.getState().queue[0],
    answer(value?: string | null) {
      const prompt = module.exports.useDialogs.getState().queue[0];
      if (!prompt) throw new Error("No confirmation dialog");
      module.exports.closeDialog(prompt.id);
      prompt.resolve(value);
    },
    create() {
      render();
      find((e) => e.props?.className === "btn btn-primary home-new").props.onClick();
      render();
    },
    dialogOpen: () => { render(); return !!find((e) => e.props?.onSave); },
    async save(input: SiteInput) {
      const dialog = find((e) => e.props?.onSave);
      try { await dialog.props.onSave(input); } finally { render(); }
    },
    dispose() {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
      globalThis.fetch = previousFetch;
    },
  };
}

/** 同じホームを、ブラウザの本物のダイアログ・ボタンで操作する。 */
export async function homeSiteStorageBundle() {
  return (await build({
    stdin: {
      contents: `import React from "react"; import { createRoot } from "react-dom/client";
        import { loadLocale } from "./lib/i18n";
        void loadLocale().then(async () => {
  const { default: Home } = await import("./components/Home");
  window.homeRoot = createRoot(document.getElementById("app"));
          window.homeRoot.render(<Home />);
});`,
      resolveDir: repo, loader: "tsx",
    },
    bundle: true, platform: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [homeMocks],
  })).outputFiles[0].text;
}
