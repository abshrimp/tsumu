import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prepareExportProject } from "../lib/export-formats";
import { rollbackPwaRetirement } from "../lib/publish-pwa";
import type { SiteDoc } from "../lib/types";

// 使い捨てのローカル配信だけで、登録済み Worker の 404 更新と終了処理を確かめる。
// GitHub・公開 API・ユーザーの保存データにはアクセスしない。
test("Rolling back a generated PWA retires its offline worker instead of leaving a 404 update", async ({ page, context }) => {
  const home = { id: "home", name: "Home", slug: "", title: "Before PWA", description: "", children: [] };
  const before: SiteDoc = { schemaVersion: 1, siteName: "PWA rollback", nodes: {}, assets: {}, pages: { home }, pageOrder: ["home"] };
  const later: SiteDoc = { ...before, pwa: { enabled: true }, pages: {
    home: { ...home, title: "After PWA" },
    later: { ...home, id: "later", name: "Later", slug: "later", title: "Later cached page" },
  }, pageOrder: ["home", "later"] };
  const current = (await prepareExportProject(later, "html")).files;
  const restored = (await prepareExportProject(before, "html")).files;
  const manifest = (output: Record<string, string>) => Object.fromEntries(Object.entries(output).map(([path, text]) => [
    path, createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex"),
  ]));
  const retirement = await rollbackPwaRetirement(manifest(current), Object.keys(restored), Object.keys(restored), manifest(restored));
  expect(retirement?.path).toBe("sw.js");
  let phase: "current" | "removed" | "retired" = "current";
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const path = url.pathname.replace(/^\//, "").replace(/\/$/, "/index.html") || "index.html";
    const output = phase === "current" ? current : restored;
    const content = phase === "retired" && path === retirement!.path ? retirement!.content : output[path];
    response.writeHead(content === undefined ? 404 : 200, {
      "Content-Type": path.endsWith(".js") ? "application/javascript; charset=utf-8"
        : path.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": path === "sw.js" ? "no-store" : "public, max-age=0",
    });
    response.end(content ?? "Not found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture server address");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect(await page.evaluate(() => fetch("/later/").then(response => response.text()))).toContain("Later cached page");
    await expect.poll(() => page.evaluate(async () => !!await (await caches.open("site-pwa-v2")).match("/later/"))).toBe(true);
    await page.evaluate(async () => { await (await caches.open("customer-cache")).put("/unrelated", new Response("keep")); });

    phase = "removed";
    expect(await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      try { await registration!.update(); return "updated"; } catch { return "404 update failed"; }
    })).toBe("404 update failed");
    expect(await page.evaluate(async () => !!await navigator.serviceWorker.getRegistration())).toBe(true);
    await context.setOffline(true);
    expect(await page.evaluate(() => fetch("/later/").then(response => response.text()))).toContain("Later cached page");
    await context.setOffline(false);

    phase = "retired";
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => !!await navigator.serviceWorker.getRegistration())).toBe(false);
    await expect.poll(() => page.evaluate(() => caches.has("site-pwa-v2"))).toBe(false);
    expect(await page.evaluate(() => caches.has("customer-cache"))).toBe(true);
    await page.reload();
    await expect(page).toHaveTitle("Before PWA");
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  } finally {
    await context.setOffline(false);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
