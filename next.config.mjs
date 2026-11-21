import { existsSync } from "node:fs";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { configuredHostedEditorOrigin, trustedMcpOrigin, OFFICIAL_SITE_DIRECTORY_PATH } from "./lib/external-edit/official.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker では、必要なファイルだけを .next/standalone にまとめる（Dockerfile）
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    const origin = configuredHostedEditorOrigin();
    const relay = trustedMcpOrigin();
    const trusted = origin && relay ? new URL(origin) : null;
    const hostPattern = trusted ?
      "^" + RegExp.escape(trusted.host) +
      (trusted.protocol === "https:" && !trusted.port ? "(?::443)?" : "") + "$" : null;
    return [
      {
        // エディタは、検索エンジンに一切載せない
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      ...(hostPattern ? [{
        // Only the configured host may frame its directory for the relay.
        source: OFFICIAL_SITE_DIRECTORY_PATH,
        has: [{ type: "host", value: hostPattern }],
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors ${relay}` },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      }] : []),
      {
        // On all other hosts, the directory remains subject to the same
        // clickjacking protection as normal editor pages.
        source: OFFICIAL_SITE_DIRECTORY_PATH,
        ...(hostPattern ? { missing: [{ type: "host", value: hostPattern }] } : {}),
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        // 他のサイトの iframe や埋め込みからの遷移でエディタを重ねて押させること（クリックジャッキング）を防ぐ
        source: "/((?!(?:api/assets/file|mcp/sites-bridge)/?$).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default async function config(phase) {
  // next dev の間も、wrangler.jsonc のバインディング（D1・KV など）を使えるようにする。
  // 自分の ID を書いた wrangler.local.jsonc（Git の管理外）があれば、そちらを使う。
  // next build・next start（Node.js・Docker で動かすとき）では、Cloudflare の再現を起動しない
  // （開発用の依存なので、本番の Node.js・Docker では読み込まない）
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
    const wranglerConfig =
      process.env.WRANGLER_CONFIG || (existsSync("wrangler.local.jsonc") ? "wrangler.local.jsonc" : undefined);
    initOpenNextCloudflareForDev(wranglerConfig ? { configPath: wranglerConfig } : undefined);
  }
  return nextConfig;
}
