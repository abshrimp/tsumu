import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** JSXも含めて実際のフッターとストアをまとめ、同じ状態で表示を確かめる。 */
export async function localSaveStatusFixture() {
  const result = await build({
    stdin: { contents: `export { default as Footer } from "./components/Footer"; export { useEditor } from "./lib/store"; export { tr } from "./lib/i18n";`, resolveDir: resolve("."), loader: "tsx" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  });
  const module = { exports: {} as any };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    createRequire(resolve("package.json")), module, module.exports,
  );
  return module.exports;
}
