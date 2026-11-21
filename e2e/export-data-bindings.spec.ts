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
