import { defineConfig, devices } from "@playwright/test";

/**
 * 画面を通しで確かめるテスト（e2e/）。ビルド済みのエディタを Node.js で起動し、
 * 使い捨ての保存先（.e2e-data）とログインなしで動かす。
 *   npm run build && npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 1つのサーバーと保存先を共有するので、順に動かす
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    viewport,
    trace: "retain-on-failure",
  },
  // Keep the full Chromium suite; run the same core UI smoke cases on the other
  // engines. CDP multitouch tests remain in the full Chromium suite.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
    { name: "firefox", grep: /@(?:core-editing|form-values)\b/, use: { ...devices["Desktop Firefox"], viewport } },
    { name: "webkit", grep: /@(?:core-editing|form-values)\b/, use: { ...devices["Desktop Safari"], viewport } },
  ],
  webServer: {
    command: `rm -rf .e2e-data && npx --no-install next start -p ${PORT}`,
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // 手元の .env.local やシェルの GITHUB_TOKEN・AI の設定に左右されないよう、公開と AI は未設定にする
    env: {
      TSUMU_DATA_DIR: ".e2e-data", ALLOW_ANONYMOUS: "true", NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
      GITHUB_TOKEN: "", AI_ENABLED: "",
    },
  },
});
