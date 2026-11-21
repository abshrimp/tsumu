import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultSearch, firstSearch, nextSearch, searchFormFiles } from "../tests/helpers/search-form-navigation";
import { searchFormValuesBundle } from "../tests/helpers/search-form-values";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

for (const format of ["nextjs", "react"] as const) {
  test(`${format} search forms preserve empty and repeated successful fields @form-values`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const script = await searchFormValuesBundle(format);
    await page.route("http://form.export.test/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: '<div id="app"></div>' });
    });
    await page.goto("http://form.export.test/search?tab=products&tab=offers&q=typed&tag=on&tag=b&color=red&color=blue&sort=&size=S");
    await page.addScriptTag({ content: script });
    await expect(page.locator("#q")).toHaveValue("typed");
    await expect(page.locator("#tag-a")).not.toBeChecked();
    await expect(page.locator("#tag-b")).toBeChecked();
    await expect(page.locator("#tag-on")).toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["red", "blue"]);
    await expect(page.locator("#sort")).toHaveValue("");
    await expect(page.locator("#size-s")).toBeChecked();

    await page.locator("#q").fill("");
    await page.locator("#note").fill("");
    await page.locator("#tag-a").check();
    await page.locator("#tag-on").uncheck();
    await page.locator("#color").selectOption(["green", "blue"]);
    await page.locator("#upload").setInputFiles({ name: "fixture.txt", mimeType: "text/plain", buffer: Buffer.from("fixture") });
    await page.locator("#submit").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("");
    const params = new URL(page.url()).searchParams;
    expect(params.getAll("tab")).toEqual(["products", "offers"]);
    expect(params.getAll("tag")).toEqual(["a", "b"]);
    expect(params.getAll("color")).toEqual(["green", "blue"]);
    expect(params.get("note")).toBe("");
    expect(params.get("sort")).toBe("");
    expect(params.get("size")).toBe("S");
    expect(params.getAll("intent")).toEqual(["search"]);
    expect(params.has("disabled")).toBe(false);
    expect(params.has("fieldset-disabled")).toBe(false);
    expect(params.has("upload")).toBe(false);
    expect(params.has("")).toBe(false);
    if (format === "react") await page.addScriptTag({ content: script });
    await expect(page.locator("#q")).toHaveValue("");
    await expect(page.locator("#note")).toHaveValue("");
    await expect(page.locator("#tag-a")).toBeChecked();
    await expect(page.locator("#tag-b")).toBeChecked();
    await expect(page.locator("#tag-on")).not.toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["green", "blue"]);

    // 同じ DOM を保ったままの履歴の移動でも、URL に無い選択を残さない。
    await page.evaluate(() => {
      window.history.pushState(null, "", "?tab=products&q=&tag=on&color=red");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.locator("#tag-a")).not.toBeChecked();
    await expect(page.locator("#tag-b")).not.toBeChecked();
    await expect(page.locator("#tag-on")).toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["red"]);
    await page.goBack();
    await expect(page.locator("#tag-a")).toBeChecked();
    await expect(page.locator("#tag-b")).toBeChecked();
    await expect(page.locator("#color")).toHaveValues(["green", "blue"]);
    await page.goForward();
    await expect(page.locator("#color")).toHaveValues(["red"]);
    const saved = page.waitForRequest(request => request.url() === "http://form.export.test/saved" && request.method() === "POST");
    await page.locator("#save").click();
    expect(new URLSearchParams((await saved).postData()!).getAll("intent")).toEqual(["save"]);
    expect(errors).toEqual([]);
  });
}

test("a static search form keeps its query-selected page after submission @form-values", async ({ page }) => {
  const home = { id: "home", name: "Home", slug: "", title: "Home", description: "", children: ["title"] };
  const doc: SiteDoc = {
    schemaVersion: 1, siteName: "Catalog", assets: {}, pageOrder: ["home", "search"],
    pages: { home, search: { ...home, id: "search", title: "Products", query: "tab=products", children: ["form"] } },
    nodes: {
      title: { ...makeText("Home"), id: "title" },
      form: { ...makeBox(), id: "form", semantic: "form", children: ["query", "send", "post"] },
      query: { ...makeBox(), id: "query", attrId: "q", type: "field", field: { kind: "input" } },
      send: { ...makeBox(), id: "send", type: "field", field: { kind: "submit", label: "Search" } },
      post: { ...makeBox(), id: "post", type: "field", field: { kind: "submit", label: "Save" },
        htmlAttrs: { formaction: "/save", formmethod: "post" } },
    },
  };
  const { files } = generateExportProject(doc, "html");
  await page.route("https://search.test/**", route => {
    const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
    return route.fulfill({ contentType: path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
      body: files[path] ?? "" });
  });
  await page.goto("https://search.test/?tab=products&lang=ja&lang=en&q=old");
  await page.locator("#q").fill("chair");
  await page.evaluate(() => document.querySelector("form")!.addEventListener("submit", e => e.preventDefault(), { once: true }));
  await page.getByRole("button", { name: "Search" }).click();
  expect(new URL(page.url()).searchParams.get("q")).toBe("old");
  expect(await page.evaluate(() => new FormData(document.querySelector("form")!).has("tab"))).toBe(false);
  await page.evaluate(() => {
    // A form listener may inspect the payload before the browser builds the actual submission.
    const form = document.querySelector("form")!;
    form.addEventListener("submit", () => { new FormData(form); });
  });
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveTitle("Products");
  const query = new URL(page.url()).searchParams;
  expect(query.getAll("q")).toEqual(["chair"]);
  expect(query.getAll("lang")).toEqual(["ja", "en"]);
  expect(query.get("tab")).toBe("products");
  const posted = page.waitForRequest(req => req.method() === "POST");
  await page.getByRole("button", { name: "Save" }).click();
  expect(new URLSearchParams((await posted).postData()!).has("tab")).toBe(false);
});

test.describe("Next.js search form navigation", () => {
  const loadDependency = createRequire(resolve("package.json"));
  const nextBin = loadDependency.resolve("next/dist/bin/next");
  let directory = "";
  let server: ChildProcess | undefined;
  let origin = "";
  let output = "";

  // 生成した Next.js のアプリを動かし、Link・RSC・履歴を通した状態の復元を確かめる。
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
    // useSearchParams を加えても、静的なフォームが隠れたり、ページ全体が CSR になったりしてはならない。
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

  test("Back and Forward revisit submitted searches, their fields, and the original fragment @export-navigation", async ({ page }) => {
    await page.goto(`${origin}/search${firstSearch}#search-form`);
    await expect(page.locator("#q")).toHaveValue("first");
    const initialLength = await page.evaluate(() => history.length);
    for (const value of ["green tea", "black tea"]) {
      await page.locator("#q").fill(value);
      await page.locator("#submit").click();
      await expect(page.locator("#result")).toHaveText("API: " + value);
    }
    const revision = await page.locator("#render-revision").textContent();
    await page.locator("#submit").click();
    await expect(page.locator("#render-revision")).not.toHaveText(revision!);
    expect(await page.evaluate(() => history.length)).toBe(initialLength + 2);
    for (const [direction, query] of [["back", "green tea"], ["back", "first"], ["forward", "green tea"], ["forward", "black tea"]]) {
      if (direction === "back") await page.goBack();
      else await page.goForward();
      await expect(page.locator("#result")).toHaveText("API: " + query);
      await expect(page.locator("#q")).toHaveValue(query);
      const url = new URL(page.url());
      expect(url.searchParams.get("q")).toBe(query);
      expect(url.hash).toBe("#search-form");
    }
  });

  test("delayed actions from an earlier search do not hide the next results", async ({ page }) => {
    await page.clock.install();
    await page.goto(origin + "/search" + firstSearch);
    await expect(page.locator("#result")).toHaveText("API: first");
    await page.locator("#delay").click();
    await expect(page.locator("#ready")).toBeHidden();

    await page.locator("#next-link").click();
    await expect(page.locator("#result")).toHaveText("API: next");
    await page.clock.fastForward(31_000);
    await expect(page.locator("#result")).toBeVisible();

    // An anchor within the same results keeps the new page's own action alive.
    await page.locator("#delay").click();
    await page.evaluate(() => { location.hash = "result"; });
    await page.clock.fastForward(31_000);
    await expect(page.locator("#result")).toBeHidden();
  });

  test("Search forms follow client-side navigation and history while preserving input on same-URL renders", async ({ page }) => {
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

    // 同じクエリを再送信したときの応答で、リクエストの間に入力した文字を上書きしてはならない。
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
});

