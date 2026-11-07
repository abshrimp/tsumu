import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createInitialDoc } from "../lib/presets";
import { generateExportProject, type ExportFormat, type ExportOptions } from "../lib/export-formats";

const framework = process.argv[2] as ExportFormat | undefined;
if (!framework || !["vue", "nuxt", "sveltekit"].includes(framework)) {
  throw new Error("Expected framework: vue, nuxt or sveltekit");
}
const style = framework === "vue" ? "css" : framework === "nuxt" ? "tailwind" : "css-modules";
const language = framework === "nuxt" ? "javascript" : "typescript";
const options: ExportOptions = { framework, language, style, scope: "project" };
const doc = createInitialDoc();
doc.siteName = "Build smoke test";
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
