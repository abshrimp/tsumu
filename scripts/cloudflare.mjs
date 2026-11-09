/**
 * opennextjs-cloudflare を、自分の D1・KV の ID が入った設定で動かす。
 * 使う設定は次の順に決める:
 *   1. 環境変数 WRANGLER_CONFIG で指定したファイル
 *   2. wrangler.local.jsonc（手元のデプロイ用。Git 管理外）
 *   3. wrangler.jsonc をもとに作る wrangler.generated.jsonc。
 *      環境変数 D1_DATABASE_ID・KV_NAMESPACE_ID（Cloudflare Workers Builds のビルド変数）があれば
 *      プレースホルダを置き換え、無いものはバインディングごと外す。
 *      保存先の構成が揃わない場合、ブラウザ内の保存に切り替える
 *
 *   node scripts/cloudflare.mjs build
 *   node scripts/cloudflare.mjs deploy
 *   node scripts/cloudflare.mjs preview   （ローカルで起動。クラウドのプレビューは scripts/cloudflare-preview.mjs）
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const GENERATED = "wrangler.generated.jsonc";
const D1_PLACEHOLDER = "<YOUR_D1_DATABASE_ID>";
const KV_PLACEHOLDER = "<YOUR_KV_NAMESPACE_ID>";

/** JSONC のコメントと末尾のカンマを取り除いて読む（文字列の中はそのまま） */
export function parseJsonc(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      const start = i;
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === "\\") i++;
      out += src.slice(start, i + 1);
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new SyntaxError("Unterminated block comment in Wrangler configuration");
      i = end + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, closing) => closing ?? match));
}

/** The server document store requires D1, KV and the SQLite Durable Object. */
export function storageBindings(config) {
  const db = (config.d1_databases ?? []).find(b => b.binding === "DB");
  const kv = (config.kv_namespaces ?? []).find(b => b.binding === "ASSETS_KV");
  const doc = (config.durable_objects?.bindings ?? []).some(
    b => b.name === "DOC_STORE" && b.class_name === "DocumentRoom" && !b.script_name && !b.environment
  );
  const declaredClass = (config.migrations ?? []).some(
    m => (m.new_sqlite_classes ?? []).includes("DocumentRoom")
  );
  // Wrangler supports both explicit class migrations and declarative exports.
  // A configured, SQLite-backed DocumentRoom is required for server storage.
  const exportedClass = config.exports?.DocumentRoom?.type === "durable-object" &&
    config.exports.DocumentRoom.storage === "sqlite";
  const validId = id => typeof id === "string" && !!id.trim() &&
    id === id.trim() && !/[<>]/.test(id);
  return {
    db: validId(db?.database_id),
    kv: validId(kv?.id),
    doc: doc && (declaredClass || exportedClass) &&
      !((config.migrations ?? []).length && Object.keys(config.exports ?? {}).length),
  };
}

/** An incomplete server configuration is a browser-only deployment. */
export function normalizeStorageConfig(config) {
  const bindings = storageBindings(config);
  const server = bindings.db && bindings.kv && bindings.doc;
  if (server) return { config, mode: "server" };
  const normalized = structuredClone(config);
  if (normalized.d1_databases) normalized.d1_databases = normalized.d1_databases.filter(b => b.binding !== "DB");
  if (normalized.kv_namespaces) normalized.kv_namespaces = normalized.kv_namespaces.filter(b => b.binding !== "ASSETS_KV");
  return { config: normalized, mode: "browser" };
}

/** Preserve any storage binding used by the active Worker version. */
export function assertNoStorageDowngrade(currentBindings, nextConfig) {
  if (!Array.isArray(currentBindings)) throw new Error("Cannot inspect deployed Worker bindings");
  const next = storageBindings(nextConfig);
  const lost = [];
  if (!next.db && currentBindings.some(b => b.name === "DB" && b.type === "d1"))
    lost.push("D1 (DB)");
  if (!next.kv && currentBindings.some(b => b.name === "ASSETS_KV" && b.type === "kv_namespace"))
    lost.push("KV (ASSETS_KV)");
  if (!next.doc && currentBindings.some(b => b.name === "DOC_STORE" && b.type === "durable_object_namespace"))
    lost.push("Durable Object DOC_STORE");
  if (lost.length) throw new Error(
    "Refusing deployment: the existing Worker would lose " + lost.join(", ") +
    ". Restore the storage configuration before deploying."
  );
}

function wranglerJson(args) {
  const proc = spawnSync("npx", ["--no-install", "wrangler", ...args, "--json"], {
    encoding: "utf8", shell: process.platform === "win32",
  });
  if (proc.status !== 0) {
    const message = [proc.stdout, proc.stderr].filter(Boolean).join("\n");
    // An explicitly absent Worker is a new installation, not a downgrade.
    if (/worker(?: script)? (?:does not exist|not found)|script not found|code:? 10007/i.test(message))
      return null;
    throw new Error("Cannot verify existing Worker storage; deployment aborted. " + message);
  }
  try { return JSON.parse(proc.stdout); }
  catch { throw new Error("Cannot parse Wrangler deployment inspection output; deployment aborted."); }
}

/** Read the live version, not merely local files, before a browser-only deployment. */
export function assertRemoteStorageContinuity(config, configPath) {
  if (storageBindings(config).db && storageBindings(config).kv && storageBindings(config).doc) return;
  if (typeof config.name !== "string" || !config.name.trim())
    throw new Error("Cannot inspect existing deployment without a Worker name.");
  const flags = ["--config", configPath, "--name", config.name];
  const deployed = wranglerJson(["deployments", "status", ...flags]);
  if (deployed === null) return;
  const entries = deployed.versions ?? deployed.deployment?.versions;
  if (!Array.isArray(entries) || entries.length === 0)
    throw new Error("Cannot determine active Worker versions; deployment aborted.");
  for (const entry of entries) {
    const id = entry.version_id ?? entry.id ?? entry.version?.id;
    if (typeof id !== "string")
      throw new Error("Cannot determine active Worker version ID; deployment aborted.");
    const version = wranglerJson(["versions", "view", id, ...flags]);
    const bindings = version?.resources?.bindings ?? version?.bindings;
    assertNoStorageDowngrade(bindings, config);
  }
}

/** Resolve the same configuration for building and production deployments. */
export function wranglerConfigPath({ deploy = false } = {}) {
  const explicit = process.env.WRANGLER_CONFIG || (existsSync("wrangler.local.jsonc") ? "wrangler.local.jsonc" : null);
  const source = explicit ?? "wrangler.jsonc";
  const config = parseJsonc(readFileSync(source, "utf8"));
  if (!explicit) {
    const d1 = process.env.D1_DATABASE_ID;
    const kv = process.env.KV_NAMESPACE_ID;
    if (config.d1_databases) {
      config.d1_databases = config.d1_databases
        .map(db => db.database_id === D1_PLACEHOLDER && d1 ? { ...db, database_id: d1 } : db)
        .filter(db => db.database_id !== D1_PLACEHOLDER);
    }
    if (config.kv_namespaces) {
      config.kv_namespaces = config.kv_namespaces
        .map(ns => ns.id === KV_PLACEHOLDER && kv ? { ...ns, id: kv } : ns)
        .filter(ns => ns.id !== KV_PLACEHOLDER);
    }
  }
  const { config: finalConfig, mode } = normalizeStorageConfig(config);
  if (mode === "browser") console.warn("Server storage is incomplete; using browser-only storage.");
  // Keep custom configs in place when complete so relative paths still resolve correctly.
  if (explicit && mode === "server") return source;
  // For a custom config in a different directory, keep generated paths relative to that directory.
  const generated = explicit ? join(dirname(source), GENERATED) : GENERATED;
  writeFileSync(generated, JSON.stringify(finalConfig, null, "\t") + "\n");
  return generated;
}

/** Prevent command-line overrides from bypassing the production binding audit. */
export function assertSafeDeployArgs(args) {
  for (const arg of args) {
    if (arg === "--" ||
        /^--(?:config|cwd|env|env-file|environment|profile|name|var|define|secrets-file|ignore-base-config|route|routes|zone-id|zone-ids|assets|site|compatibility-date|compatibility-flag|compatibility-flags)(?:=|$)/.test(arg) ||
        /^-[cen](?:=|$|[^-])/.test(arg)) {
      throw new Error(`Unsupported production deploy override: ${arg}. Use WRANGLER_CONFIG with reviewed top-level bindings instead.`);
    }
  }
}
const [command, ...rest] = process.argv.slice(2);
if (command && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (command === "deploy") assertSafeDeployArgs(rest);
  const config = wranglerConfigPath({ deploy: command === "deploy" });
  if (command === "deploy") {
    const finalConfig = parseJsonc(readFileSync(config, "utf8"));
    assertRemoteStorageContinuity(finalConfig, config);
  }
  const args = [command, ...(config ? ["--config", config] : []), ...rest];
  console.log(`Using ${config ?? "wrangler.jsonc"}`);
  const r = spawnSync("npx", ["--no-install", "opennextjs-cloudflare", ...args], { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(r.status ?? 1);
}
