import { expect, test, type Page } from "@playwright/test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import type { FieldContent, SiteDoc } from "../lib/types";

function fixture(): SiteDoc {
  return {
    schemaVersion: 1, siteName: "Binding fixture", assets: {}, nodes: {}, pageOrder: ["p"],
    pages: { p: { id: "p", name: "Home", slug: "", title: "Home", description: "", children: [] } },
  };
}

async function openExport(page: Page, doc: SiteDoc, search = "", rows?: unknown[]) {
  const { files } = generateExportProject(doc, "html");
  await page.route("https://data.test/**", route => {
    const path = new URL(route.request().url()).pathname.slice(1) || "index.html";
    if (path === "rows.json" && rows) return route.fulfill({ json: rows });
    if (!(path in files)) return route.abort();
    const contentType = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html";
    return route.fulfill({ contentType, body: files[path] });
  });
  await page.goto("https://data.test/" + search);
}

test("an exported component owns a single anchor and visibility marker per instance", async ({ page }) => {
  const doc = fixture();
  doc.components = { card: { id: "card", name: "Card", rootId: "root" } };
  doc.nodes.root = { ...makeBox(), id: "root", children: ["heading", "caption"] };
  doc.nodes.heading = { ...makeText("Title"), id: "heading" };
  doc.nodes.caption = { ...makeText("Caption"), id: "caption", attrId: "master-caption" };
  doc.nodes.instance = { ...makeBox(), id: "instance", type: "instance", componentId: "card", hiddenOn: ["sm"], attrId: "card-anchor" };
  doc.pages.p.children = ["instance"];
  await openExport(page, doc);
  await expect(page.locator("#card-anchor")).toHaveCount(1);
  await expect(page.locator("[data-instance-hidden]")).toHaveCount(1);
  await expect(page.locator("#card-anchor #master-caption")).toHaveText("Caption");
});

test("exported form values, selections and range bounds follow their bound values", async ({ page }) => {
  const doc = fixture();
  const fields: Record<string, FieldContent> = {
    source: { kind: "input", defaultValue: "cobalt" },
    radio: { kind: "radio", group: "color", checked: true, label: "{source}" },
    select: { kind: "select", defaultValue: "{source}", options: [{value:"other", label:"Other"}, {value:"cobalt", label:"Cobalt"}, {value:"moss", label:"Moss"}] },
    size: { kind: "input", inputType: "range", defaultValue: "35", min: "{lower}", max: "{upper}", step: "{stride}" },
  };
  for (const [id, field] of Object.entries(fields)) doc.nodes[id] = { ...makeBox(), id, attrId: id, type: "field", field };
  doc.nodes.form = { ...makeBox(), id: "form", semantic: "form", children: Object.keys(fields) };
  doc.pages.p.children = ["form"];
  await openExport(page, doc, "?lower=25&upper=75&stride=5");
  const radio = page.locator("#radio input");
  await expect(page.locator("#radio")).toHaveText("cobalt");
  await expect(radio).toHaveValue("cobalt");
  await expect(page.locator("#select")).toHaveValue("cobalt");
  await expect(page.locator("#size")).toHaveAttribute("min", "25");
  await expect(page.locator("#size")).toHaveAttribute("max", "75");
  await expect(page.locator("#size")).toHaveAttribute("step", "5");
  await page.locator("#source").fill("moss");
  await expect(radio).toHaveValue("moss");
  await expect(page.locator("#select")).toHaveValue("moss");
  expect(await page.locator("form").evaluate(form => new FormData(form as HTMLFormElement).get("color"))).toBe("moss");
  await page.locator("#source").fill("unlisted");
  await expect(page.locator("#select")).toHaveValue("other");
  await page.locator("#select").press("End");
  await page.locator("#source").fill("cobalt");
  await expect(page.locator("#select")).toHaveValue("moss");
});

test("list fields resolve their own row and refresh shared bindings after input", async ({ page }) => {
  const doc = fixture();
  doc.pages.p.pageScripts = [{ id: "load", trigger: "load", steps: [
    { id: "get", kind: "fetch", url: "/rows.json", as: "rows" },
  ] }];
  doc.nodes.source = { ...makeBox(), id: "source", attrId: "source", type: "field", field: { kind: "input", defaultValue: "A" } };
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: ["choice"] };
  doc.nodes.choice = { ...makeBox(), id: "choice", type: "field", field: {
    kind: "select", defaultValue: "{name} {source}",
    options: [{ value: "other", label: "Other" }, { value: "{name} {source}", label: "{name} {source}" }],
  } };
  doc.pages.p.children = ["source", "list"];
  await openExport(page, doc, "", [{ name: "East" }, { name: "West" }]);
  const choices = page.locator("[data-row] select");
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toHaveValue("East A");
  await expect(choices.nth(1)).toHaveValue("West A");
  await page.locator("#source").fill("B");
  await expect(choices.nth(0)).toHaveValue("East B");
  await expect(choices.nth(1)).toHaveValue("West B");
});

test("slug tokens resolve in text, URLs and fields on an exported page", async ({ page }) => {
  const doc = fixture();
  doc.nodes.title = { ...makeText("Article [slug]"), id: "title", attrId: "title", link: { kind: "url", url: "/?article=[slug]" } };
  doc.nodes.input = { ...makeBox(), id: "input", attrId: "input", type: "field", field: { kind: "input", defaultValue: "[slug]" } };
  doc.pages.p.children = ["title", "input"];
  await openExport(page, doc, "?slug=sea%20glass");
  await expect(page.locator("#title")).toHaveText("Article sea glass");
  await expect(page.locator("#title")).toHaveAttribute("href", /article=sea%20glass$/);
  await expect(page.locator("#input")).toHaveValue("sea glass");
});

function fetchedList(): SiteDoc {
  const doc = fixture();
  doc.pages.p.pageScripts = [{ id: "load", trigger: "load", steps: [
    { id: "loadRows", kind: "fetch", url: "/rows.json", as: "rows" },
  ] }];
  doc.nodes.region = { ...makeBox(), id: "region", attrId: "region", type: "field", field: { kind: "input", defaultValue: "east" } };
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: [] };
  doc.pages.p.children = ["region", "list"];
  return doc;
}

test("list text, links and images follow shared inputs while row data and edited fields stay intact", async ({ page }) => {
  const doc = fetchedList();
  doc.nodes.label = { ...makeText("{name} {region}"), id: "label", link: { kind: "url", url: "/read/{name}/{region}" } };
  doc.nodes.image = { ...makeBox(), id: "image", type: "image", image: { src: "/images/{name}/{region}.png", width: 20, height: 20, alt: "" } };
  doc.nodes.note = { ...makeBox(), id: "note", type: "field", field: { kind: "input", defaultValue: "note" } };
  doc.nodes.list.children = ["label", "image", "note"];
  await openExport(page, doc, "", [{ name: "Oak{a}" }, { name: "Elm", region: "local" }]);
  const rows = page.locator("[data-row]");
  await expect(rows.locator("a")).toHaveText(["Oak{a} east", "Elm local"]);
  await rows.first().locator("input").fill("my note");
  await page.locator("#region").fill("west");
  await expect(rows.locator("a")).toHaveText(["Oak{a} west", "Elm local"]);
  await expect(rows.first().locator("a")).toHaveAttribute("href", /\/read\/Oak%7Ba%7D\/west$/);
  await expect(rows.first().locator("img")).toHaveAttribute("src", /\/images\/Oak\{a\}\/west\.png$/);
  await expect(rows.first().locator("input")).toHaveValue("my note");
});

test("row fetches read current fields and typed row values when the action runs", async ({ page }) => {
  const doc = fetchedList();
  doc.nodes.action = { ...makeText("Fetch {name}"), id: "action", scripts: [{ id: "click", trigger: "click", steps: [
    { id: "request", kind: "fetch", method: "POST", url: "/details/{region}/{name}", as: "result",
      headers: [{ name: "X-Region", value: "{region}" }], body: '{"id":{id},"tags":{tags},"region":"{region}"}' },
    { id: "accept", kind: "set-var", value: "{result.label} {region}", into: "status" },
  ] }] };
  doc.nodes.status = { ...makeText("{status}"), id: "status", attrId: "result-status" };
  doc.nodes.list.children = ["action"];
  doc.pages.p.children.push("status");
  await openExport(page, doc, "", [{ name: "Oak tree", id: 42, tags: ["green", "large"] }]);
  await expect(page.locator("[data-row]")).toHaveCount(1);
  await page.locator("#region").fill("west");
  let sent: unknown;
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/details/**", async route => {
    sent = { path: new URL(route.request().url()).pathname, header: route.request().headers()["x-region"], body: route.request().postDataJSON() };
    await response;
    await route.fulfill({ json: { label: "Received" } });
  });
  await page.getByText("Fetch Oak tree", { exact: true }).click();
  await expect.poll(() => sent).toEqual({ path: "/details/west/Oak%20tree", header: "west", body: { id: 42, tags: ["green", "large"], region: "west" } });
  await expect(page.locator("#result-status")).toBeEmpty();
  await page.locator("#region").fill("south");
  release();
  await expect(page.locator("#result-status")).toHaveText("Received south");
});

test("a late row response cannot replace results from a newer query on a reused page", async ({ page }) => {
  const doc = fixture();
  doc.nodes.reload = { ...makeText("Reload"), id: "reload", attrId: "reload", scripts: [{ id: "click", trigger: "click", steps: [
    { id: "get", kind: "fetch", url: "/results/{phase}", as: "rows" },
  ] }] };
  doc.nodes.list = { ...makeBox(), id: "list", type: "list", list: { from: "rows" }, children: ["name"] };
  doc.nodes.name = { ...makeText("{name}"), id: "name" };
  doc.pages.p.children = ["reload", "list"];
  await openExport(page, doc, "?phase=old");
  const nativeBridge = generateExportProject(doc, "sveltekit").files["src/lib/browser-start.js"];
  await page.route("**/browser-start.js", route => route.fulfill({ contentType: "text/javascript", body: nativeBridge }));
  await page.evaluate(() => {
    const state = window as typeof window & { finishOld?: () => void; oldRequest?: AbortSignal | null };
    window.fetch = async (input, init) => {
      if (String(input).endsWith("/old")) {
        state.oldRequest = init?.signal;
        await new Promise<void>(resolve => { state.finishOld = resolve; });
        return Response.json([{ name: "Old" }]);
      }
      return Response.json([{ name: "New" }]);
    };
  });
  await page.locator("#reload").click();
  await page.waitForFunction(() => Boolean((window as any).finishOld));
  // SvelteKit reuses this DOM on query navigation and delivers its new server data through the generated bridge.
  await page.evaluate(async path => {
    const bridge = await import(path);
    history.pushState(null, "", "?phase=new");
    bridge.syncPageVars({ phase: "new" });
  }, "/browser-start.js");
  await page.locator("#reload").click();
  await expect(page.locator("[data-row]")).toHaveText("New");
  const cancelled = await page.evaluate(async () => {
    const state = window as typeof window & { finishOld: () => void; oldRequest: AbortSignal };
    state.finishOld();
    await new Promise(requestAnimationFrame);
    return state.oldRequest.aborted;
  });
  expect(cancelled).toBe(true);
  await expect(page.locator("[data-row]")).toHaveText("New");
});
