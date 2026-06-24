import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { defaultSearch, firstSearch, nextSearch, searchFormFiles } from "../tests/helpers/search-form-navigation";

const loadDependency = createRequire(resolve("package.json"));
const nextBin = loadDependency.resolve("next/dist/bin/next");
let directory = "";
let server: ChildProcess | undefined;
let origin = "";
let output = "";

// テスト専用に生成した Next.js を実際に動かし、Link・RSC・履歴を通した状態復元を確かめる。
test.beforeAll(async () => {
  test.setTimeout(180_000);
  directory = await mkdtemp(join(tmpdir(), "tsumu-search-form-"));
  for (const [name, contents] of Object.entries(searchFormFiles())) {
    const path = join(directory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  const build = spawn(process.execPath, [nextBin, "build", "--webpack"], { cwd: directory, env });
  build.stdout!.on("data", (chunk) => { output += chunk; });
  build.stderr!.on("data", (chunk) => { output += chunk; });
  const [code] = await once(build, "exit");
  expect(code, output).toBe(0);
  // useSearchParams の追加で静的フォームが消えたり、ページ全体がCSRにならない。
  const html = await readFile(join(directory, ".next/server/app/index.html"), "utf8");
  expect(html).toContain('id="static-form"');
  expect(html).toContain('value="Static form"');
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", "0"], { cwd: directory, env });
  const capture = (chunk: Buffer) => {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) origin = match[0];
  };
  server.stdout!.on("data", capture);
  server.stderr!.on("data", capture);
  await expect.poll(async () => {
    if (!origin) return false;
    try { return (await fetch(origin)).ok; } catch { return false; }
  }, { timeout: 30_000, message: output }).toBe(true);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("検索フォームはソフトナビゲーションと履歴に追従し、同じURLの描画では入力を保つ", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/search${firstSearch}`);
  await expect(page.locator("#q")).toHaveValue("first");
  await page.evaluate(() => { (window as any).searchDocument = document; (window as any).searchForm = document.querySelector("#search-form"); });
  const check = async (search: string) => {
    const params = new URLSearchParams(search);
    await expect(page.locator("#result")).toHaveText(`API: ${params.get("q")}`);
    await expect(page.locator("#q")).toHaveValue(params.get("q")!);
    await expect(page.locator("#note")).toHaveValue(params.get("note")!);
    await expect(page.locator("#stock input")).toBeChecked({ checked: params.has("stock") });
    await expect(page.locator(`input[type="radio"][value="${params.get("size")}"]`)).toBeChecked();
    await expect(page.locator("#sort")).toHaveValue(params.get("sort")!);
    expect(await page.evaluate(() => (window as any).searchDocument === document)).toBe(true);
    expect(await page.evaluate(() => (window as any).searchForm === document.querySelector("#search-form"))).toBe(true);
  };
  await check(firstSearch);
  await page.locator("#next-link").click();
  await check(nextSearch);
  await page.goBack();
  await check(firstSearch);
  await page.goForward();
  await check(nextSearch);
  for (const [id, search] of [["first-link", firstSearch], ["next-link", nextSearch]]) {
    await page.locator(`#${id}`).click();
    await check(search);
  }
  await page.locator("#q").fill("日本語 & +");
  await page.locator("#submit").click();
  await expect(page.locator("#result")).toHaveText("API: 日本語 & +");
  const submitted = new URL(page.url());
  expect(submitted.searchParams.get("tab")).toBe("products");
  expect(submitted.searchParams.get("q")).toBe("日本語 & +");

  // 同じ条件を再送信した応答が来ても、その間に書き始めた値は戻さない。
  const revision = await page.locator("#render-revision").textContent();
  let release!: () => void;
  let intercepted!: () => void;
  const ready = new Promise<void>((done) => { intercepted = done; });
  const paused = new Promise<void>((done) => { release = done; });
  await page.route("**/*", async (route) => {
    if (route.request().headers().rsc === "1") { intercepted(); await paused; }
    await route.continue();
  });
  await page.locator("#submit").click();
  await ready;
  await page.locator("#q").fill("still typing");
  const response = page.waitForResponse((res) => res.request().headers().rsc === "1");
  release();
  await response;
  await expect(page.locator("#render-revision")).not.toHaveText(revision!);
  await page.unroute("**/*");
  await expect(page.locator("#q")).toHaveValue("still typing");

  await page.locator("#defaults-link").click();
  await expect(page).toHaveURL(`${origin}/search${defaultSearch}`);
  await expect(page.locator("#q")).toHaveValue("changed");
  await expect(page.locator("#note")).toHaveValue("changed note");
  await expect(page.locator("#stock input")).toBeChecked();
  await expect(page.locator('input[type="radio"][value="M"]')).toBeChecked();
  await expect(page.locator("#sort")).toHaveValue("B");
  await expect(page.locator("#upload")).toHaveValue("");
  expect(errors).toEqual([]);
});
