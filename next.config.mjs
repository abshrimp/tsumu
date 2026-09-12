import { existsSync } from "node:fs";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker では、必要なファイルだけを .next/standalone にまとめる（Dockerfile）
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
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
      {
        // 他のサイトの iframe に入れて「公開」などを押させること（クリックジャッキング）を防ぐ
        source: "/((?!api/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
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
