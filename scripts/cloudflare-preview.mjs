/** Hosted Worker Previews, distinct from OpenNext's local `preview` command. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonc, storageBindings, wranglerConfigPath } from "./cloudflare.mjs";

const LOCAL_DO = { name: "COLLAB_ROOM", class_name: "CollaborationRoom" };

/** Pure transformation. Never provision storage or copy production bindings/vars. */
export function isolatedPreviewConfig(config, env = {}) {
  const result = structuredClone(config);
  const previews = result.previews ?? {};
  const productionConfigs = [result, ...Object.values(result.env ?? {})];
  const supported = new Set(["durable_objects", "d1_databases", "kv_namespaces", "vars", "placement", "limits", "observability", "logpush"]);
  for (const key of Object.keys(previews)) {
    if (!supported.has(key)) throw new Error(`Preview ${key} needs a separate isolation review before using this helper.`);
  }
  // Do not let named environments or CLI overrides select a different binding set.
  delete result.env;
  if (Object.values(result.exports ?? {}).some(
    (entry) => entry?.type === "durable-object" && entry.state && entry.state !== "created"
  )) {
    throw new Error("Preview must not change Durable Object class lifecycle.");
  }
  previews.durable_objects ??= { bindings: [LOCAL_DO] };
  if (!previews.durable_objects.bindings?.some((b) => b.name === LOCAL_DO.name && b.class_name === LOCAL_DO.class_name)) {
    throw new Error("Preview must bind COLLAB_ROOM to its own CollaborationRoom class.");
  }
  if (previews.durable_objects.bindings.some((b) => b.script_name || b.environment)) {
    throw new Error("Preview Durable Objects must not bind to another Worker or environment.");
  }
  for (const [key, idKey, envKey, productionEnv, fallback] of [
    ["d1_databases", "database_id", "PREVIEW_D1_DATABASE_ID", "D1_DATABASE_ID", { binding: "DB", database_name: "tsumu-preview" }],
    ["kv_namespaces", "id", "PREVIEW_KV_NAMESPACE_ID", "KV_NAMESPACE_ID", { binding: "ASSETS_KV" }],
  ]) {
    // Explicit Preview configuration wins. Missing Preview IDs mean browser-only storage.
    previews[key] ??= env[envKey] ? [{ ...fallback, [idKey]: env[envKey] }] : [];
    const productionIds = new Set(productionConfigs.flatMap((scope) => (scope[key] ?? []).map((b) => b[idKey])).concat(env[productionEnv] ?? [])
      .filter((id) => typeof id === "string").map((id) => id.trim().toLowerCase()));
    for (const binding of previews[key]) {
      const id = binding[idKey];
      if (typeof id !== "string" || !id.trim() || id !== id.trim() || /[<>]/.test(id)) {
        throw new Error(`Preview ${key} requires a real, separate resource ID.`);
      }
      if (productionIds.has(id.toLowerCase())) throw new Error(`Preview ${key} must not reuse a production resource ID.`);
    }
  }
  const storage = storageBindings({ ...previews, exports: result.exports });
  if (storage.db && !storage.doc) {
    throw new Error("Preview DB requires a local DOC_STORE binding to the SQLite-backed DocumentRoom export.");
  }
  // Wrangler "vars" are plain-text configuration, not encrypted secrets.
  // Do not let a public, anonymous Preview accidentally publish credential-like
  // values through its Preview configuration.
  for (const name of Object.keys(previews.vars ?? {})) {
    if (/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|^ANTHROPIC_|^OPENAI_|^GITHUB_)/i.test(name)) {
      throw new Error(`Preview ${name} must be configured as a secret, not a plain-text variable.`);
    }
  }
  // Explicit empty bindings remove old Preview storage too. Base settings are not inherited.
  previews.vars ??= {};
  result.previews = previews;
  return result;
}

/** Only metadata flags: no config/environment, source, variable or secret-file overrides. */
export function previewArguments(args) {
  const accepted = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { accepted.push(arg); continue; }
    const match = /^(--name|--tag|--message)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unsupported Preview argument: ${arg}`);
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${match[1]} requires a value.`);
    accepted.push(match[1], value);
  }
  return accepted;
}

export function assertSupportedOpenNextConfig(config) {
  if (Object.keys(config.functions ?? {}).length) {
    throw new Error("Hosted Preview requires a separate adapter setup for named OpenNext functions.");
  }
  for (const section of [config.default, config.middleware]) {
    for (const key of ["incrementalCache", "tagCache", "queue", "cdnInvalidation"]) {
      const value = section?.override?.[key];
      if (value !== undefined && value !== "dummy") {
        throw new Error(`Hosted Preview requires a separate adapter setup for OpenNext ${key}; no remote cache was modified.`);
      }
    }
  }
  if (config.cloudflare?.skewProtection?.enabled) {
    throw new Error("Hosted Preview requires a separate adapter setup for OpenNext skew protection.");
  }
}

export function previewLaunch(configPath, workerName, flags, env = {}) {
  if (typeof workerName !== "string" || !workerName.trim()) throw new Error("Preview requires an explicit Worker name.");
  if (env.WRANGLER_CI_OVERRIDE_NAME && env.WRANGLER_CI_OVERRIDE_NAME !== workerName) {
    throw new Error("Workers Builds targets a different Worker than this configuration; verify the Worker name before deploying.");
  }
  return {
    args: ["preview", "--config", configPath, "--env", "", "--ignore-base-config", ...flags],
    // Wrangler loads dotenv files itself. Pin the verified identity so a later
    // dotenv value cannot silently select another parent Worker.
    env: { ...env, WRANGLER_CI_OVERRIDE_NAME: workerName },
  };
}

export async function main(args = process.argv.slice(2)) {
  const flags = previewArguments(args);
  const source = wranglerConfigPath();
  const config = isolatedPreviewConfig(parseJsonc(readFileSync(source, "utf8")), process.env);
  const generated = join(dirname(source), "wrangler.preview.generated.jsonc");
  const launch = previewLaunch(generated, config.name, flags, process.env);
  // The editor currently uses dummy caches. Fail before deployment if future adapter
  // settings require populate-cache/skew operations rather than silently skipping them.
  const compiled = resolve(".open-next/.build/open-next.config.edge.mjs");
  if (!existsSync(compiled) || !existsSync(".open-next/worker.js") || !existsSync(".open-next/assets")) {
    throw new Error("Run npm run build:worker before deploying a hosted Preview.");
  }
  assertSupportedOpenNextConfig((await import(pathToFileURL(compiled).href)).default);
  // Keep paths relative to the source config, including WRANGLER_CONFIG outside cwd.
  writeFileSync(generated, JSON.stringify(config, null, "\t") + "\n");
  console.error(`Using ${generated}; this creates or updates a hosted Worker Preview, not production.`);
  // Use the installed CLI directly: no package install and no shell interpolation of names.
  const require = createRequire(import.meta.url);
  const wranglerPackage = require.resolve("wrangler/package.json");
  const cli = join(dirname(wranglerPackage), JSON.parse(readFileSync(wranglerPackage, "utf8")).bin.wrangler);
  const child = spawnSync(process.execPath, [cli, ...launch.args], {
    stdio: "inherit", env: launch.env,
  });
  return child.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
