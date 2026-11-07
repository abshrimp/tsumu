import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";
import { generateExportProject, type ExportFormat, type ExportOptions } from "../lib/export-formats";

const framework = process.argv[2] as ExportFormat | undefined;
if (!framework || !["vue", "nuxt", "sveltekit"].includes(framework)) {
  throw new Error("Expected framework: vue, nuxt or sveltekit");
}
const style = framework === "vue" ? "css" : framework === "nuxt" ? "tailwind" : "css-modules";
const language = framework === "nuxt" ? "javascript" : "typescript";
const options: ExportOptions = { framework, language, style, scope: "project" };
const doc: SiteDoc = {
  siteName: "Build smoke test",
  pageOrder: ["home"],
  pages: {
    home: { id: "home", name: "Home", slug: "", title: "Home", description: "",
      children: ["heading", "picture", "search", "items", "component-instance"],
      pageScripts: [{
        id: "load", trigger: "load", pos: { x: 0, y: 0 },
        steps: [{ id: "split", kind: "split", source: "Alpha,Beta", sep: ",", into: "names" }],
      }],
    },
  },
  nodes: {
    heading: { ...makeBox(), id: "heading", text: { content: "Smoke test", heading: 1 } },
    picture: { ...makeBox(), id: "picture", type: "image",
      image: { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        alt: "Pixel", width: 1, height: 1 } },
    search: { ...makeBox(), id: "search", type: "field", attrId: "searchTerm",
      field: { kind: "input", inputType: "text", defaultValue: "", placeholder: "Search" } },
    items: { ...makeBox(), id: "items", type: "list", list: { from: "names" }, children: ["row"] },
    row: { ...makeBox(), id: "row", text: { content: "{値}", heading: 0 } },
    "component-instance": { ...makeBox(), id: "component-instance",
      type: "instance", componentId: "card" },
    card: { ...makeBox(), id: "card", text: { content: "Reusable", heading: 0 } },
  },
  components: { card: { id: "card", name: "Reusable card", rootId: "card" } },
  assets: {},
};
const project = generateExportProject(doc, options);
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
