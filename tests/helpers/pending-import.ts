import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build, transformSync } from "esbuild";
import { useEditor } from "../../lib/store";
import { readHtmlZip } from "../../lib/html-zip";
import * as assets from "../../lib/assets";

const require = createRequire(resolve("package.json"));

/** 実際のコールバックを、完了順と再描画を制御して実行する。DOMでの同じ操作はE2Eでも確認する。 */
export function importCallbacks(kind: "image" | "font" | "html" | "style" | "backup" | "breakpoints", upload = assets.uploadAsset, readZip = readHtmlZip) {
  let cursor = 0;
  let effects: (() => void)[] = [];
  const cells: any[] = [];
  const equal = (a: unknown[], b?: unknown[]) => !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useMemo(compute: () => unknown) { return compute(); },
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in cells)) cells[i] = { value: initial };
      return [cells[i].value, (value: unknown) => { cells[i].value = value; }];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      return cells[i] ??= { current: initial };
    },
    useCallback(fn: unknown, deps: unknown[]) {
      const i = cursor++;
      if (!equal(deps, cells[i]?.deps)) cells[i] = { fn, deps };
      return cells[i].fn;
    },
    useLayoutEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const i = cursor++;
      if (!equal(deps, cells[i]?.deps)) effects.push(() => {
        cells[i]?.cleanup?.();
        cells[i] = { deps, cleanup: effect() };
      });
    },
  };
  const inspector = () => {
    const s = useEditor.getState();
    const id = s.selection!;
    return {
      editTarget: JSON.stringify([id, s.breakpoint, s.styleState, s.selectedIds]),
      get: (prop: string) => ({ value: s.doc.nodes[id]?.styles[s.breakpoint]?.[s.styleState]?.[prop] }),
      set: (props: Record<string, string>) => s.setStyleProps(id, props),
    };
  };
  const alerts: unknown[] = [];
  const confirmations: { resolve: (value: boolean) => void }[] = [];
  function evaluate(path: string, append = "") {
    const code = transformSync(readFileSync(resolve(path), "utf8") + append, { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", code)((name: string) => {
      if (name === "react") return hooks;
      if (name.endsWith("/use-pending-import")) return evaluate("lib/use-pending-import.ts");
      if (name.endsWith("/store")) return { useEditor: Object.assign((select: (s: ReturnType<typeof useEditor.getState>) => unknown) => select(useEditor.getState()), { getState: useEditor.getState, subscribe: useEditor.subscribe }) };
      if (name.endsWith("/html-zip")) return { readHtmlZip: readZip };
      if (name.endsWith("/assets")) return { ...assets, uploadAsset: upload };
      if (name.endsWith("/controls")) return { useInspector: inspector, InspectorCtx: { Provider: "inspector" } };
      if (name.endsWith("/dialog")) return {
        showAlert: (...args: unknown[]) => { alerts.push(args); },
        showConfirm: () => new Promise<boolean>(resolve => { confirmations.push({ resolve }); }),
      };
      if (name.endsWith("/BackgroundSec") || name.endsWith("/shared")) return {};
      return name.startsWith(".") ? require(resolve(path, "..", name)) : require(name);
    }, module, module.exports);
    return module.exports;
  }
  const component = kind === "image"
    ? evaluate("components/ImagePicker.tsx").default
    : kind === "breakpoints" ? evaluate("components/SitePanel.tsx", "\nexport { BreakpointSettings }; ").BreakpointSettings
    : kind === "backup" ? evaluate("components/SitePanel.tsx").default
    : kind === "html" ? evaluate("components/PagePanel.tsx").default
    : kind === "style" ? evaluate("components/StylePanel.tsx").default
    : evaluate("components/style-panel/TypographySec.tsx", "\nexport { FontPicker };").FontPicker;
  return {
    alerts,
    confirmations,
    render(props: Record<string, unknown> = {}) {
      cursor = 0;
      effects = [];
      const tree = component(props);
      for (const effect of effects) effect();
      return tree;
    },
    unmount() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

export function elements(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children), ...elements(tree.props?.lead)];
}

/** 実際のパネル・ストア・画像アップロード処理をブラウザで動かす。 */
export async function pendingImportBundle() {
  return (await build({
    stdin: {
      contents: `
import React from "react";
import { createRoot } from "react-dom/client";
import RightPanel from "./components/RightPanel";
import { useEditor } from "./lib/store";
import { makeText } from "./lib/presets";
const doc = { siteName: "Pending imports", assets: {
  old: { id: "old", name: "old.svg", dataUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', width: 1, height: 1 },
}, pageOrder: ["p", "q"], pages: {
  p: { id: "p", name: "P", slug: "", title: "", description: "", children: ["a", "b"] },
  q: { id: "q", name: "Q", slug: "q", title: "", description: "", children: [] },
}, nodes: {
  a: { ...makeText("A"), id: "a", styles: { base: { default: { backgroundImage: 'url("https://example.test/a.png")', fontFamily: "Arial" } } } },
  b: { ...makeText("B"), id: "b", styles: { base: { default: { backgroundImage: 'url("https://example.test/b.png")', fontFamily: "Arial" } } } },
}};
useEditor.getState().replaceDoc(doc);
useEditor.getState().select("a");
useEditor.getState().setRightTab("style");
window.importEditor = useEditor;
const root = createRoot(document.getElementById("app"));
window.unmountImportEditor = () => root.unmount();
root.render(<RightPanel />);
`,
      loader: "tsx", sourcefile: "pending-import-browser.tsx", resolveDir: resolve("."),
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  })).outputFiles[0].text;
}
