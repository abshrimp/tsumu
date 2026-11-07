import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const framework = process.argv[2];
if (!["vue", "nuxt", "sveltekit", "react"].includes(framework)) {
  throw new Error("Expected vue, nuxt, sveltekit or react");
}
const cwd = resolve(".generated-export-smoke");
const port = framework === "vue" ? "48730" : framework === "nuxt" ? "48731" :
  framework === "sveltekit" ? "48732" : "48733";
const command = framework === "vue" ? "server.mjs" : framework === "nuxt" ?
  ".output/server/index.mjs" : framework === "sveltekit" ? "build/index.js" :
  "node_modules/vite/bin/vite.js";
const argv = framework === "react"
  ? [command, "preview", "--host", "127.0.0.1", "--port", port]
  : [command];
const child = spawn(process.execPath, argv, {
  cwd,
  env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1",
    PORT: port, NITRO_PORT: port, NITRO_HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout?.on("data", (buffer) => { output += buffer.toString(); });
child.stderr?.on("data", (buffer) => { output += buffer.toString(); });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const url = "http://127.0.0.1:" + port + "/";
  let running = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error("Generated server exited: " + output);
    try { running = (await fetch(url)).ok; } catch { /* server starting */ }
    if (running) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!running) throw new Error("Generated server failed to start: " + output);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByText("Smoke test", { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByText("Literal {1 + 2} and {{ 3 + 4 }}", { exact: true })
    .first().waitFor({ timeout: 15000 });
  await page.getByText("Alpha", { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByText("Beta", { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Tap" }).waitFor({ timeout: 15000 });
  // Event runtimes install after hydration and script loading, not just DOM readiness.
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Tap" }).click();
  await page.getByText("Status: done", { exact: true }).first().waitFor({ timeout: 10000 });
  if (errors.length) throw new Error("Generated browser JavaScript errors:\n" + errors.join("\n"));
  console.log(framework + " generated browser: hydrated and updated a variable after click");
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) {
    await Promise.race([once(child, "exit"), new Promise((done) => setTimeout(done, 1000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
