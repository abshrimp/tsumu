import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import {
  build as esbuildBuild,
  buildSync as esbuildBuildSync,
  transformSync as esbuildTransformSync,
  type BuildOptions,
  type BuildResult,
  type Plugin,
  type TransformOptions,
} from "esbuild";

export type { BuildOptions, BuildResult, Plugin, TransformOptions };

// Fixtures share results within one worker. A fresh worker always reads the current checkout.
const transforms = new Map<string, string>();
const builds = new Map<string, BuildResult>();

export function transformSync(source: string, options: TransformOptions = {}): { code: string } {
  const key = createHash("sha256").update(serialize(options)).update(source).digest("hex");
  let code = transforms.get(key);
  if (code === undefined) {
    code = esbuildTransformSync(source, options).code;
    transforms.set(key, code);
  }
  return { code };
}

function buildKey(options: BuildOptions): string {
  return createHash("sha256").update(serialize(options)).digest("hex");
}

export function buildSync(options: BuildOptions & { write: false }): BuildResult<{ write: false }>;
export function buildSync(options: BuildOptions): BuildResult;
export function buildSync(options: BuildOptions): BuildResult {
  if (options.write !== false || options.plugins?.length) return esbuildBuildSync(options);
  const key = buildKey(options);
  const cached = builds.get(key);
  if (cached) return cached;
  const result = esbuildBuildSync(options);
  builds.set(key, result);
  return result;
}

export function build(options: BuildOptions & { write: false }): Promise<BuildResult<{ write: false }>>;
export function build(options: BuildOptions): Promise<BuildResult>;
export async function build(options: BuildOptions): Promise<BuildResult> {
  if (options.write !== false || options.plugins?.length) return esbuildBuild(options);
  const key = buildKey(options);
  const cached = builds.get(key);
  if (cached) return cached;
  const result = await esbuildBuild(options);
  builds.set(key, result);
  return result;
}
