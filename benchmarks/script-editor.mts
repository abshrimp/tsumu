/** Run from the repository root; see benchmarks/README.md for comparison rules. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus, platform, arch, release, totalmem, hostname } from "node:os";
import { chromium, type Page } from "@playwright/test";
import { scriptBenchmarkBundle } from "./script-editor-fixture";
import { scriptWorkspaceDoc } from "../tests/helpers/script-workspace";

const [output, baselinePath] = process.argv.slice(2);
assert.ok(output, "Usage: node --import tsx benchmarks/script-editor.mts OUTPUT.json [BASELINE.json]");
const samples = 20;
const warmups = 3;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
const browser = await chromium.launch();
const frame = (page: Page) => page.evaluate(() => new Promise<void>((done) =>
  requestAnimationFrame(() => requestAnimationFrame(() => done()))));
type Metrics = Record<string, number[]>;
try {
  const environment = {
    platform: platform(), arch: arch(), os: release(), cpu: cpus()[0].model,
    cores: cpus().length, ram: totalmem(), node: process.version,
    machine: hash(hostname()),
    browser: browser.version(), viewport: { width: 1440, height: 900 },
    lockfile: hash(await readFile("package-lock.json", "utf8")),
    installedLockfile: hash(await readFile("node_modules/.package-lock.json", "utf8")),
    harness: hash(await readFile("benchmarks/script-editor.mts", "utf8") +
      await readFile("benchmarks/script-editor-fixture.ts", "utf8")),
    samples, warmups, protocol: 1,
  };
  const results: Record<string, { data: string; metrics: Metrics; p95: Record<string, number> }> = {};
  for (const layout of ["single", "stacks"] as const) {
    const bundle = await scriptBenchmarkBundle(layout);
    const metrics: Metrics = { firstRenderMs: [], dragFrameMs: [], domElements: [],
      retainedHeapBytes: [], saveMs: [], exportMs: [] };
    for (let run = -warmups; run < samples; run++) {
      const context = await browser.newContext({ viewport: environment.viewport, locale: "ja-JP" });
      try {
        // A fresh isolated origin supplies real IndexedDB without a web server.
        await context.route("**/*", (route) => route.request().isNavigationRequest()
          ? route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' })
          : route.abort());
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("http://script-benchmark.test");
        await page.addScriptTag({ content: bundle });
        await page.waitForFunction(() => Number.isFinite((window as any).scriptBenchmark?.firstRenderMs));
        const firstRenderMs = await page.evaluate(() => (window as any).scriptBenchmark.firstRenderMs as number);

        // Exercise the focus-retention path before measuring resident DOM/heap.
        const workspace = page.locator(".se-ws");
        for (const index of [0, 40, 80, 120]) {
          const target = layout === "single" ? workspace.locator(".se-virtual-chunk").nth(index / 2)
            : workspace.locator(`[data-script-id="stack-${index}"]`);
          await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
          const field = target.locator("input.se-in").first();
          await field.focus();
          const last = layout === "single" ? workspace.locator(".se-virtual-chunk").last()
            : workspace.locator('[data-script-id="stack-159"]');
          await last.evaluate((el) => el.scrollIntoView({ block: "start" }));
          await last.locator("input.se-in").first().waitFor({ state: "visible" });
          await frame(page);
          assert.equal(await field.evaluate((el) => el === document.activeElement), true);
          await field.blur();
          await frame(page);
        }
        await workspace.evaluate((el) => { el.scrollTop = 0; });
        await workspace.locator('[data-sel-key="step:wait-0"]').waitFor({ state: "visible" });
        await frame(page);
        const domElements = await workspace.locator("*").count();
        const cdp = await context.newCDPSession(page);
        await cdp.send("HeapProfiler.collectGarbage");
        const { usedSize: retainedHeapBytes } = await cdp.send("Runtime.getHeapUsage");
        await cdp.detach();

        // Dispatch real editor pointer events; measure move-to-next-frame latency
        // inside the browser, excluding Playwright transport time.
        const dragFrames = await page.evaluate(async () => {
          const block = document.querySelector<HTMLElement>('[data-tutorial="se-block-wait"]')!;
          const origin = block.getBoundingClientRect();
          const ws = document.querySelector(".se-ws")!.getBoundingClientRect();
          const emit = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(
            new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y }));
          emit(block, "pointerdown", origin.left + 6, origin.top + 6);
          emit(window, "pointermove", ws.left + 40, ws.top + 100);
          await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          if (!document.querySelector(".se-ghost")) throw Error("Drag did not start");
          const durations: number[] = [];
          for (let i = 0; i < 60; i++) {
            const start = performance.now();
            emit(window, "pointermove", ws.left + 40 + i % 10, ws.top + 100 + i * 4);
            await new Promise<void>((done) => requestAnimationFrame(() => done()));
            durations.push(performance.now() - start);
          }
          emit(window, "pointercancel", ws.left + 40, ws.top + 100);
          return durations;
        });
        await page.locator(".se-ghost").waitFor({ state: "detached" });
        const saveMs = await page.evaluate(() => (window as any).scriptBenchmark.save() as Promise<number>);
        const download = page.waitForEvent("download");
        const exportMs = await page.evaluate(() => (window as any).scriptBenchmark.export() as Promise<number>);
        const archive = await download;
        assert.equal(await archive.failure(), null);
        await archive.delete();
        assert.deepEqual(errors, []);
        if (run >= 0) {
          for (const [key, value] of Object.entries({ firstRenderMs, domElements, retainedHeapBytes, saveMs, exportMs })) {
            metrics[key].push(value);
          }
          metrics.dragFrameMs.push(...dragFrames);
        }
      } finally { await context.close(); }
    }
    results[layout] = { data: hash(JSON.stringify(scriptWorkspaceDoc(layout))), metrics,
      p95: Object.fromEntries(Object.entries(metrics).map(([key, values]) => [key, p95(values)])) };
  }
  const implementation = hash(await readFile("components/script-editor/visibility.ts", "utf8") +
    await readFile("components/script-editor/blocks.tsx", "utf8"));
  const report = { environment, implementation, results };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([key, r]) => [key, r.p95])), null, 2));
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as typeof report;
    assert.deepEqual(environment, baseline.environment, "Benchmark environments must match");
    for (const [layout, result] of Object.entries(results)) {
      assert.equal(result.data, baseline.results[layout].data, "Benchmark data must match");
      for (const [metric, value] of Object.entries(result.p95)) {
        const before = baseline.results[layout].p95[metric];
        assert.ok(Number.isFinite(before) && before > 0, `Missing baseline for ${layout}/${metric}`);
        assert.ok(value <= before * 1.1, `${layout}/${metric}: ${value} exceeds baseline ${before} by >10%`);
      }
    }
  }
} finally { await browser.close(); }
