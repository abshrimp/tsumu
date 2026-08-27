import { defineConfig } from "@playwright/test";

// These fixtures bundle the actual editor and need no application web server.
export default defineConfig({
  testDir: "../e2e",
  testMatch: ["script-large-workspace.spec.ts", "script-drag-lifecycle.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { browserName: "chromium", locale: "ja-JP", viewport: { width: 1440, height: 900 } },
});
