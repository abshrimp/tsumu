import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import {
  expectedCreate, expectedDocument, expectedTransaction, transactionCases,
} from "../tests/helpers/indexeddb-transactions";

let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({
    entryPoints: ["tests/helpers/indexeddb-transactions.ts"],
    bundle: true, platform: "browser", format: "iife", globalName: "storageScenarios", write: false,
  })).outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("http://tsumu-storage.test/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Storage regressions</title>",
  }));
  await page.goto("http://tsumu-storage.test/");
  await page.addScriptTag({ content: bundle });
});

for (const mode of transactionCases) {
  test(`native IndexedDB: ${mode} preserves transaction atomicity`, async ({ page }) => {
    const result = await page.evaluate(mode =>
      (window as any).storageScenarios.transactionScenario(indexedDB, mode), mode);
    expect(result).toEqual(expectedTransaction(mode));
  });
}

test("native IndexedDB protects real document creates from competing callers", async ({ page }) => {
  const result = await page.evaluate(() => (window as any).storageScenarios.browserDocumentCreateScenario());
  expect(result).toEqual(expectedCreate);
});

test("native IndexedDB rejects stale document saves and preserves unrelated documents", async ({ page }) => {
  const result = await page.evaluate(() => (window as any).storageScenarios.browserDocumentScenario());
  expect(result).toEqual(expectedDocument);
});

for (const abort of [false, true]) {
  test(`native IndexedDB cursor ${abort ? "aborts queued reads" : "completes without continue"}`, async ({ page }) => {
    const result = await page.evaluate(abort =>
      (window as any).storageScenarios.cursorScenario(indexedDB, abort), abort);
    expect(result).toEqual({ outcome: abort ? "abort" : "complete", seen: ["one"] });
  });
}
