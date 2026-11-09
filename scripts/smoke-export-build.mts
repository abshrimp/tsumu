import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { prepareExportProject, type ExportFormat, type ExportOptions, type ExportStyle } from "../lib/export-formats";

const framework = process.argv[2] as ExportFormat | undefined;
if (!framework || !["nextjs", "react", "vue", "nuxt", "sveltekit"].includes(framework)) {
  throw new Error("Expected framework: nextjs, react, vue, nuxt or sveltekit");
}
const defaultStyle = framework === "vue" ? "css" : framework === "nuxt" ? "tailwind" : "css-modules";
const style: ExportStyle = (process.argv[4] as ExportStyle | undefined) ?? defaultStyle;
if (!["css", "css-modules", "tailwind"].includes(style)) {
  throw new Error("Expected style: css, css-modules or tailwind");
}
const language = (process.argv[3] === "javascript" || process.argv[3] === "typescript")
  ? process.argv[3] : framework === "nuxt" ? "javascript" : "typescript";
const options: ExportOptions = { framework, language, style, scope: "project" };
const doc: SiteDoc = {
  siteName: "Build smoke {1 + 2} test",
  pageOrder: ["home"],
  pages: {
    home: { id: "home", name: "Home", slug: "", title: "Home", description: "",
      children: ["heading", "literal-text", "picture", "search", "items", "action-button", "status-text", "component-instance"],
      pageScripts: [{
        id: "load", trigger: "load", pos: { x: 0, y: 0 },
        steps: [
          { id: "constant", kind: "set-var", into: "csv", value: "Alpha,Beta" },
          { id: "split", kind: "transform", source: "csv", into: "names",
            transform: { kind: "split", separator: "," } },
        ],
      }] as unknown as NonNullable<SiteDoc["pages"][string]["pageScripts"]>,
    },
  },
  nodes: {
    heading: { ...makeBox(), id: "heading", text: { content: "Smoke test", heading: 1 } },
    "literal-text": { ...makeBox(), id: "literal-text",
      text: { content: "Literal {1 + 2} and {{ 3 + 4 }}", heading: 0 } },
    picture: { ...makeBox(), id: "picture", type: "image",
      image: { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        alt: "Pixel", width: 1, height: 1 } },
    search: { ...makeBox(), id: "search", type: "field", attrId: "searchTerm",
      field: { kind: "input", inputType: "text", defaultValue: "", placeholder: "Search {1 + 2}" } },
    items: { ...makeBox(), id: "items", type: "list", list: { from: "names" }, children: ["row"] },
    row: { ...makeBox(), id: "row", text: { content: "{値}", heading: 0 } },
    "action-button": { ...makeBox(), id: "action-button", attrId: "action-button",
      semantic: "button", text: { content: "Tap", heading: 0 },
      scripts: [{ id: "tap", trigger: "click", pos: { x: 0, y: 0 },
        steps: [{ id: "set-status", kind: "set-var", into: "status", value: "done" }] }],
    },
    "status-text": { ...makeBox(), id: "status-text",
      text: { content: "Status: {status}", heading: 0 } },
    "component-instance": { ...makeBox(), id: "component-instance",
      type: "instance", componentId: "card" },
    card: { ...makeBox(), id: "card", text: { content: "Reusable", heading: 0 } },
  },
  components: { card: { id: "card", name: "Reusable card", rootId: "card" } },
  assets: {},
};
// Exercise the complete user-facing export pipeline (including JS conversion).
const project = await prepareExportProject(doc, options);
if (framework === "react" && language === "javascript" && !project.files["src/App.jsx"]) {
  throw new Error("JavaScript export must emit JSX rather than TypeScript");
}
if (Object.keys(project.remoteAssets).length) {
  throw new Error("Build fixture cannot depend on remote editor assets");
}
const root = join(process.cwd(), ".generated-export-smoke");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const [path, content] of Object.entries(project.files)) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
for (const [path, base64] of Object.entries(project.binaries)) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(base64, "base64"));
}
console.log(framework + " " + language + " " + style + ": generated " +
  Object.keys(project.files).length + " source files in " + root);
