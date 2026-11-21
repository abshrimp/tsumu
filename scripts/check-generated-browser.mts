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
  for (let i = 0; i < 180; i++) {
    if (child.exitCode !== null) throw new Error("Generated server exited: " + output);
    try { running = (await fetch(url)).ok; } catch { /* server starting */ }
    if (running) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!running) throw new Error("Generated server failed to start: " + output);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(error.message); });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push("console." + message.type() + ": " + message.text());
  });
  page.on("requestfailed", (request) => {
    errors.push("failed " + request.url() + ": " + request.failure()?.errorText);
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  async function check(name: string, action: () => Promise<unknown>) {
    try { await action(); }
    catch (error) {
      const facts = await page.evaluate(() => ({
        title: document.title,
        body: document.body.innerText.slice(0, 3000),
        html: document.body.innerHTML.slice(0, 6000),
        scripts: Array.from(document.scripts).map((s) => ({ src: s.src, type: s.type })),
      }));
      console.error("Generated browser failure:", framework, name,
        JSON.stringify({ facts, errors, exception: String(error) }, null, 2));
      throw error;
    }
  }
  await check("heading", () => page.getByText("Smoke test", { exact: true }).first().waitFor({ timeout: 7000 }));
  await page.getByText("Literal {1 + 2} and {{ 3 + 4 }}", { exact: true })
    .first().waitFor({ timeout: 15000 });
  await check("page robots", () => page.locator('head meta[name="robots"][content*="noindex"]').first().waitFor({ state: "attached" }));
  await check("Alpha row", () => page.getByText("Alpha", { exact: true }).first().waitFor({ timeout: 7000 }));
  await check("Beta row", () => page.getByText("Beta", { exact: true }).first().waitFor({ timeout: 7000 }));
  const tapButton = page.getByRole("button", { name: "Tap" });
  await check("button", () => tapButton.waitFor({ timeout: 7000 }));
  // イベントのランタイムはハイドレーション後に登録されるため、状態変化が確認できるまで短周期で再試行する。
  await check("status after click", async () => {
    for (let attempt = 0; attempt < 35; attempt++) {
      await tapButton.click();
      try {
        await page.getByText("Status: done", { exact: true }).first().waitFor({ timeout: 200 });
        return;
      } catch {
        // Hydrating; retry on next tick.
      }
    }
    await page.getByText("Status: done", { exact: true }).first().waitFor({ timeout: 1000 });
  });
  await check("named submit target", async () => {
    await page.route("**/preview?*", route => route.fulfill({ contentType: "text/html", body: "<p>Preview results</p>" }));
    await page.locator("#searchTerm").fill("green tea");
    const preview = page.frame({ name: "previewPane" });
    if (!preview) throw new Error("Missing search preview frame");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await preview.waitForURL(target => target.pathname === "/preview" &&
      target.searchParams.get("searchTerm") === "green tea" && target.searchParams.getAll("intent").join(",") === "preview",
      { timeout: 7000 });
    if (page.url() !== url) throw new Error("Preview replaced the search page");
    if (framework === "sveltekit") {
      const original = await page.evaluateHandle(() => document);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.waitForURL(target => target.pathname === "/" && target.searchParams.get("intent") === "search");
      if (!await page.evaluate(previous => previous === document, original)) throw new Error("Search reloaded the document");
    }
  });
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
