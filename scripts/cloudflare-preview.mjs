/** クラウドで動かす Worker のプレビュー。OpenNext のローカルの `preview` コマンドとは別のもの。 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJsonc, storageBindings, wranglerConfigPath } from "./cloudflare.mjs";

const LOCAL_DO = { name: "COLLAB_ROOM", class_name: "CollaborationRoom" };

/** 純粋な変換。保存先を作成したり、本番のバインディングや変数を写したりはしない。 */
export function isolatedPreviewConfig(config, env = {}) {
  const result = structuredClone(config);
  const previews = result.previews ?? {};
  const productionConfigs = [result, ...Object.values(result.env ?? {})];
  const supported = new Set(["durable_objects", "d1_databases", "kv_namespaces", "vars", "placement", "limits", "observability", "logpush"]);
  for (const key of Object.keys(previews)) {
    if (!supported.has(key)) throw new Error(`Preview ${key} needs a separate isolation review before using this helper.`);
  }
  // 名前付きの環境やコマンドラインでの上書きで、別のバインディングの組を選ばせない。
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
    // プレビュー用の明示的な設定を優先する。プレビュー用の ID が無ければ、ブラウザの中にだけ保存する。
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
  // Wrangler の "vars" は平文の設定で、暗号化したシークレットではない。
  // 公開された匿名のプレビューが、そのプレビューの設定を通して、認証情報のような値を
  // 誤って公開しないようにする。
  for (const name of Object.keys(previews.vars ?? {})) {
    if (/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|^ANTHROPIC_|^OPENAI_|^GITHUB_)/i.test(name)) {
      throw new Error(`Preview ${name} must be configured as a secret, not a plain-text variable.`);
    }
  }
  // 明示的に空にしたバインディングは、古いプレビューの保存先も取り除く。基本の設定は引き継がない。
  previews.vars ??= {};
  result.previews = previews;
  return result;
}

/** メタデータのフラグだけを許す。設定・環境・ソース・変数・シークレットのファイルの上書きは許さない。 */
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
    // Wrangler は dotenv のファイルを自分で読み込む。確かめた名前を固定し、後から読まれた
    // dotenv の値で、別の親の Worker が気づかないうちに選ばれないようにする。
    env: { ...env, WRANGLER_CI_OVERRIDE_NAME: workerName },
  };
}

export async function main(args = process.argv.slice(2)) {
  const flags = previewArguments(args);
  const source = wranglerConfigPath();
  const config = isolatedPreviewConfig(parseJsonc(readFileSync(source, "utf8")), process.env);
  const generated = join(dirname(source), "wrangler.preview.generated.jsonc");
  const launch = previewLaunch(generated, config.name, flags, process.env);
  // エディタは現在、何もしないキャッシュを使っている。今後のアダプターの設定で
  // populate-cache や skew の処理が必要になったときは、黙って飛ばさず、デプロイの前に失敗させる。
  const compiled = resolve(".open-next/.build/open-next.config.edge.mjs");
  if (!existsSync(compiled) || !existsSync(".open-next/worker.js") || !existsSync(".open-next/assets")) {
    throw new Error("Run npm run build:worker before deploying a hosted Preview.");
  }
  assertSupportedOpenNextConfig((await import(pathToFileURL(compiled).href)).default);
  // 元の設定からの相対パスを保つ（作業ディレクトリの外にある WRANGLER_CONFIG の場合も含む）。
  writeFileSync(generated, JSON.stringify(config, null, "\t") + "\n");
  console.error(`Using ${generated}; this creates or updates a hosted Worker Preview, not production.`);
  // インストール済みの CLI を直接使う。パッケージのインストールも、名前のシェルでの展開も行わない。
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
