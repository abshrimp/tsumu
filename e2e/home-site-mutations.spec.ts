import { expect, test } from "@playwright/test";
import { createInitialDoc } from "../lib/presets";
import { DOC_STORAGE_KEY, emptyDest, siteKey } from "../lib/site";
import { storageKey } from "../lib/storage-keys";
import { homeSiteStorageBundle } from "../tests/helpers/home-site-storage";

const listKey = storageKey("sites-v1");
const sourceDocKey = siteKey(DOC_STORAGE_KEY, "source");
const source = { ...emptyDest(), id: "source", name: "Original", createdAt: 1, updatedAt: 2 };
let bundle: string;
test.beforeAll(async () => { bundle = await homeSiteStorageBundle(); });

type Action = "create" | "rename" | "duplicate" | "delete";
type Failure = "list" | "document" | "read" | "corrupt";
const cases: [Action, Failure][] = [
  ["create", "list"], ["create", "document"], ["rename", "list"], ["delete", "list"],
  ...(["create", "rename", "duplicate", "delete"] as const).flatMap((action): [Action, Failure][] => [
    [action, "read"], [action, "corrupt"],
  ]),
];

for (const [action, failure] of cases) {
  test(`local ${action} keeps original content and retry input after ${failure} failure`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Isolated origin and intercepted requests: no real sites, auth, or external services.
    await page.route("http://tsumu-home.test/**", (route) => {
      if (new URL(route.request().url()).pathname === "/api/sites") {
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({ contentType: "text/html", body: '<html><body><div id="app"></div></body></html>' });
    });
    await page.goto("http://tsumu-home.test/");
    const doc = createInitialDoc();
    doc.siteName = "Original public title";
    doc.customHeadHtml = "<style>/* Authored source content */</style>";
    const raw = JSON.stringify(doc);
    const list = JSON.stringify([source]);
    await page.evaluate(({ listKey, sourceDocKey, list, raw }) => {
      localStorage.setItem("tsumu-lang", "ja");
      localStorage.setItem(listKey, list);
      localStorage.setItem(sourceDocKey, raw);
    }, { listKey, sourceDocKey, list, raw });
    await page.addScriptTag({ content: bundle });
    await expect(page.locator(".home-card")).toHaveCount(1);

    const openAction = async () => {
      if (action === "create") await page.getByRole("button", { name: "新しいサイト", exact: true }).click();
      else {
        await page.getByRole("button", { name: "サイトの操作" }).click();
        await page.getByRole("menuitem", { name: action === "rename" ? "設定" : action === "duplicate" ? "複製" : "削除", exact: true }).click();
      }
      if (action === "delete") await page.locator(".dialog-input").fill("Original");
      else await page.locator("form.home-dialog input").first().fill("Retry name");
    };
    await openAction();
    await page.evaluate(({ failure, listKey, docKey }) => {
      const state = window as any;
      state.homeBlocked = true;
      state.homeRead = Storage.prototype.getItem;
      state.homeWrite = Storage.prototype.setItem;
      if (failure === "corrupt") localStorage.setItem(listKey, "{unreadable JSON");
      Storage.prototype.getItem = function (key) {
        if (state.homeBlocked && failure === "read" && key === listKey) throw new DOMException("Storage blocked", "SecurityError");
        return state.homeRead.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (state.homeBlocked && ((failure === "list" && key === listKey) || (failure === "document" && key.startsWith(`${docKey}:`)))) {
          throw new DOMException("Storage full", "QuotaExceededError");
        }
        state.homeWrite.call(this, key, value);
      };
    }, { failure, listKey, docKey: DOC_STORAGE_KEY });
    const submit = () => action === "delete"
      ? page.getByRole("dialog").getByRole("button", { name: "削除", exact: true }).click()
      : page.locator("form.home-dialog button[type=submit]").click();
    await submit();
    const error = page.locator(action === "delete" ? ".dialog-msg" : ".home-dialog-error");
    await expect(error).toContainText("ブラウザの保存容量や設定を確認して、もう一度");
    await expect(page).toHaveURL("http://tsumu-home.test/");
    await expect(page.locator(".home-card-name")).toHaveText("Original");
    expect(await page.evaluate(({ listKey, sourceDocKey }) => {
      const state = window as any;
      return {
        list: state.homeRead.call(localStorage, listKey),
        source: state.homeRead.call(localStorage, sourceDocKey),
        docKeys: Object.keys(localStorage).filter((key) => key.startsWith("tsumu-doc-v1:")),
      };
    }, { listKey, sourceDocKey })).toEqual({ list: failure === "corrupt" ? "{unreadable JSON" : list, source: raw, docKeys: [sourceDocKey] });
    if (action !== "delete") {
      await expect(page.locator("form.home-dialog input").first()).toHaveValue("Retry name");
      await expect(page.locator("form.home-dialog button[type=submit]")).toBeEnabled();
    }
    await page.evaluate(({ listKey, list }) => {
      const state = window as any;
      state.homeBlocked = false;
      state.homeWrite.call(localStorage, listKey, list);
    }, { listKey, list });
    if (action === "delete") {
      await page.getByRole("alertdialog").getByRole("button", { name: "OK", exact: true }).click();
      await openAction();
    }
    await submit();
    if (action === "create") await expect(page).toHaveURL(/\/sites\/[a-zA-Z0-9_-]+$/);
    else {
      await expect(page.locator("form.home-dialog,.dialog")).toHaveCount(0);
      await expect(page.locator(".home-card")).toHaveCount(action === "delete" ? 0 : action === "duplicate" ? 2 : 1);
    }
    const saved = await page.evaluate(({ listKey, sourceDocKey, docKey }) => {
      const sites = JSON.parse(localStorage.getItem(listKey)!);
      return { sites, source: localStorage.getItem(sourceDocKey), firstDoc: sites[0] ? localStorage.getItem(`${docKey}:${sites[0].id}`) : null };
    }, { listKey, sourceDocKey, docKey: DOC_STORAGE_KEY });
    if (action === "delete") expect(saved.sites).toEqual([]);
    else {
      expect(saved.sites[0].name).toBe("Retry name");
      if (action === "create") expect(JSON.parse(saved.firstDoc!).siteName).toBe("Retry name");
      else expect(saved.firstDoc).toBe(raw);
    }
    expect(saved.source).toBe(action === "delete" ? null : raw);
    expect(errors).toEqual([]);
  });
}
