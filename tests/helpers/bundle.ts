import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const REPO_ROOT = resolve(".");
const CACHE_DIR = join(tmpdir(), "tsumu-test-esbuild-cache-v2");
const memoryCache = new Map<string, string>();
let cachedTreeStamp: string | null = null;

function computeTreeStamp(): string {
  if (cachedTreeStamp !== null) return cachedTreeStamp;
  let maxMtime = 0;
  let fileCount = 0;
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === "node_modules" || name === ".next" || name === ".open-next" || name === ".git") continue;
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else {
          fileCount++;
          if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        }
      } catch { /* ignore transient files */ }
    }
  };
  for (const sub of ["app", "components", "lib", "tests/helpers"]) walk(join(REPO_ROOT, sub));
  cachedTreeStamp = `${fileCount}:${Math.trunc(maxMtime)}`;
  return cachedTreeStamp;
}

function readCache(key: string): string | null {
  const hit = memoryCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const file = join(CACHE_DIR, `${key}.js`);
    if (existsSync(file)) {
      const code = readFileSync(file, "utf8");
      memoryCache.set(key, code);
      return code;
    }
  } catch { /* best effort */ }
  return null;
}

function writeCache(key: string, code: string): string {
  memoryCache.set(key, code);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, `${key}.js`), code);
  } catch { /* best effort */ }
  return code;
}

export function cachedTransform(source: string, options: TransformOptions = {}): string {
  const key = createHash("sha256")
    .update("transform:")
    .update(JSON.stringify(options))
    .update("\0")
    .update(source)
    .digest("hex");
  const hit = readCache(key);
  if (hit !== null) return hit;
  return writeCache(key, esbuildTransformSync(source, options).code);
}

export function transformSync(source: string, options: TransformOptions = {}): { code: string } {
  return { code: cachedTransform(source, options) };
}

function asOutputResult(text: string): BuildResult<{ write: false }> {
  return {
    errors: [],
    warnings: [],
    outputFiles: [{ path: "<cached>", contents: Buffer.from(text, "utf8"), hash: "", text }],
    metafile: undefined,
    mangleCache: undefined,
  };
}

export function buildSync(options: BuildOptions & { write: false }): BuildResult<{ write: false }>;
export function buildSync(options: BuildOptions): BuildResult;
export function buildSync(options: BuildOptions): BuildResult {
  if (options.write !== false || options.plugins?.length) {
    return esbuildBuildSync(options);
  }
  const key = createHash("sha256")
    .update("buildSync:")
    .update(computeTreeStamp())
    .update("\0")
    .update(JSON.stringify(options))
    .digest("hex");
  const hit = readCache(key);
  if (hit !== null) return asOutputResult(hit);
  const res = esbuildBuildSync(options);
  const text = (res as BuildResult<{ write: false }>).outputFiles[0].text;
  writeCache(key, text);
  return res;
}

export async function build(options: BuildOptions & { write: false }): Promise<BuildResult<{ write: false }>>;
export async function build(options: BuildOptions): Promise<BuildResult>;
export async function build(options: BuildOptions): Promise<BuildResult> {
  if (options.write !== false || options.plugins?.length) {
    return esbuildBuild(options);
  }
  const key = createHash("sha256")
    .update("build:")
    .update(computeTreeStamp())
    .update("\0")
    .update(JSON.stringify(options))
    .digest("hex");
  const hit = readCache(key);
  if (hit !== null) return asOutputResult(hit);
  const res = await esbuildBuild(options);
  const text = (res as BuildResult<{ write: false }>).outputFiles[0].text;
  writeCache(key, text);
  return res;
}
