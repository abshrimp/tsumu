import { createRequire } from "node:module";
import { dirname, posix, resolve } from "node:path";
import { transformSync } from "esbuild";

/** 書き出した実際のページと相対の import を読み込み、本文とメタデータを検証する。 */
export function loadGeneratedRoute(files: Record<string, string>, path: string): any {
  const require = createRequire(resolve("package.json"));
  const loaded = new Map<string, any>();
  const load = (path: string): any => {
    if (loaded.has(path)) return loaded.get(path);
    const module = { exports: {} };
    const code = transformSync(files[path], { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    new Function("require", "module", "exports", code)((name: string) => {
      if (name.startsWith(".")) return load(posix.normalize(`${dirname(path)}/${name}.tsx`));
      return require(name);
    }, module, module.exports);
    loaded.set(path, module.exports);
    return module.exports;
  };
  return load(path);
}
