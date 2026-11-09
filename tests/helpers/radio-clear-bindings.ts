import { createRequire } from "node:module";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { generateProject } from "../../lib/generator";
import { makeBox, makeText } from "../../lib/presets";
import type { DocNode, ScriptStep, SiteDoc } from "../../lib/types";

export const radioState = "size={size}; small={small}; medium={medium}; index={size.index}; color={color}";

export function radioClearDoc(clearOnChange = false): SiteDoc {
  const radio = (id: string, group: string, label: string, checked = false): DocNode => ({
    ...makeBox(), id, attrId: id, type: "field", field: { kind: "radio", label, group, checked },
    scripts: [{ id: `${id}-change`, trigger: "change", pos: { x: 0, y: 0 }, steps: [
      { id: `default-${id}`, kind: "transform", source: `${id}Changes`, into: `${id}Changes`, transform: { kind: "fallback", text: "0" } },
      { id: `parse-${id}`, kind: "transform", source: `${id}Changes`, into: `${id}Changes`, transform: { kind: "parse" } }, { id: `${id}-count`, kind: "transform", source: `${id}Changes`, into: `${id}Changes`, transform: { kind: "math", operation: "add", operand: 1 } },
      ...(clearOnChange && id === "small" ? [{ id: "self-clear", kind: "set-value", target: "small", value: "false" } as ScriptStep] : []),
    ] }],
  });
  const button = (id: string, target: string, value: string): DocNode => ({
    ...makeText(id), id, attrId: id, semantic: "button", scripts: [{
      id: `${id}-script`, trigger: "click", pos: { x: 0, y: 0 },
      steps: [{ id: `${id}-set`, kind: "set-value", target, value }],
    }],
  });
  const radios = [radio("small", "size", "S", true), radio("medium", "size", "M"), radio("red", "color", "red", true)];
  const forms: DocNode[] = [
    { ...makeBox(), id: "sizes", semantic: "form", children: ["small", "medium"] },
    { ...makeBox(), id: "colors", semantic: "form", children: ["red"] },
  ];
  const nodes: DocNode[] = [
    ...radios, ...forms,
    ...["false", "0", "off", "no", ""].map((v, i) => button(`clear-item-${i}`, "small", v)),
    button("clear-group", "size", ""), button("unknown-group", "size", "unknown"),
    button("select-small", "small", "true"), button("select-medium", "size", "M"),
    { ...makeText(radioState), id: "result", attrId: "result" },
    { ...makeText("{smallChanges}|{mediumChanges}|{redChanges}"), id: "counts", attrId: "counts" },
    { ...makeBox(), id: "dependent", attrId: "dependent", type: "field", field: {
      kind: "input", defaultValue: "Selected: {size}", placeholder: "Index: {size.index}",
    } },
  ];
  return {
    schemaVersion: 1, siteName: "Radio clear bindings", assets: {}, pageOrder: ["home"],
    pages: { home: { id: "home", name: "Home", title: "Home", description: "", slug: "",
      children: nodes.filter((node) => !radios.includes(node)).map((node) => node.id),
    } },
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  };
}

/** 公開用の実際のReactページと、必要な機能だけを残したランタイムを使う。 */
export async function publishedRadioClear(clearOnChange = false) {
  const { files } = generateProject(radioClearDoc(clearOnChange));
  const require = createRequire(resolve("package.json"));
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    const code = transformSync(files[file], { loader: "tsx", jsx: "automatic", format: "cjs" }).code;
    new Function("require", "module", "exports", code)((id: string) => {
      if (id.startsWith("@/lib/")) return load(id.replace("@/", "") + ".ts");
      if (id.startsWith("@/components/")) return load(id.replace("@/", "") + ".tsx");
      if (id === "next/navigation") return { useRouter: () => ({}) };
      return require(id);
    }, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  };
  const tree = await load("app/page.tsx").default({ searchParams: Promise.resolve({}) });
  return { html: renderToStaticMarkup(tree), script: files["public/scripts.js"] };
}
