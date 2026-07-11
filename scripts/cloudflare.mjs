/**
 * opennextjs-cloudflare を、自分の D1・KV の ID が入った設定で動かす。
 * 使う設定は次の順に決める:
 *   1. 環境変数 WRANGLER_CONFIG で指定したファイル
 *   2. wrangler.local.jsonc（手元のデプロイ用。Git 管理外）
 *   3. wrangler.jsonc をもとに作る wrangler.generated.jsonc。
 *      環境変数 D1_DATABASE_ID・KV_NAMESPACE_ID（Cloudflare Workers Builds のビルド変数）があれば
 *      プレースホルダを置き換え、無いものはバインディングごと外す。
 *      外した保存先は、エディタがブラウザ内の保存に切り替えて使う
 *
 *   node scripts/cloudflare.mjs build
 *   node scripts/cloudflare.mjs deploy
 *   node scripts/cloudflare.mjs upload    （本番以外のブランチのプレビュー版）
 *   node scripts/cloudflare.mjs preview
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const GENERATED = "wrangler.generated.jsonc";
const D1_PLACEHOLDER = "<YOUR_D1_DATABASE_ID>";
const KV_PLACEHOLDER = "<YOUR_KV_NAMESPACE_ID>";

/** JSONC のコメントと末尾のカンマを取り除いて読む（文字列の中はそのまま） */
function parseJsonc(src) {
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
      i = src.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function wranglerConfigPath() {
  if (process.env.WRANGLER_CONFIG) return process.env.WRANGLER_CONFIG;
  if (existsSync("wrangler.local.jsonc")) return "wrangler.local.jsonc";

  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
  const d1 = process.env.D1_DATABASE_ID;
  const kv = process.env.KV_NAMESPACE_ID;
  const missing = [];
  config.d1_databases = (config.d1_databases ?? [])
    .map((db) => (db.database_id === D1_PLACEHOLDER && d1 ? { ...db, database_id: d1 } : db))
    .filter((db) => db.database_id !== D1_PLACEHOLDER || (missing.push(`D1 (${db.binding})`), false));
  config.kv_namespaces = (config.kv_namespaces ?? [])
    .map((ns) => (ns.id === KV_PLACEHOLDER && kv ? { ...ns, id: kv } : ns))
    .filter((ns) => ns.id !== KV_PLACEHOLDER || (missing.push(`KV (${ns.binding})`), false));
  if (!config.d1_databases.length) delete config.d1_databases;
  if (!config.kv_namespaces.length) delete config.kv_namespaces;
  if (missing.length) {
    console.warn(
      `No ID for ${missing.join(", ")}: deploying without it. ` +
        "The editor saves that data in the browser instead. " +
        "Set D1_DATABASE_ID / KV_NAMESPACE_ID or create wrangler.local.jsonc to use server storage."
    );
  }
  // main・assets のパスは設定ファイルの場所から解決されるため、wrangler.jsonc と同じ場所に書く
  writeFileSync(GENERATED, JSON.stringify(config, null, "\t") + "\n");
  return GENERATED;
}

const [command, ...rest] = process.argv.slice(2);
if (command) {
  const config = wranglerConfigPath();
  const args = [command, ...(config ? ["--config", config] : []), ...rest];
  console.log(`Using ${config ?? "wrangler.jsonc"}`);
  const r = spawnSync("npx", ["opennextjs-cloudflare", ...args], { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(r.status ?? 1);
}
