import { test, expect } from "@playwright/test";

test("invalid JSON shapes get a client error from fetch and publishing endpoints", async ({ request }) => {
  for (const [url, body] of [
    ["/api/fetch-json", '{"method":{},"url":"https://example.org"}'],
    ["/api/publish", "null"],
    ["/api/publish/history", "null"],
  ]) {
    const response = await request.post(url, {
      headers: { "Content-Type": "application/json" }, data: body,
    });
    expect(response.status(), url).toBe(400);
  }
});

test("a full save and a subsequent SQL patch use the same value for duplicate JSON keys", async ({ request }) => {
  const created = await request.post("/api/sites", { data: { name: "Duplicate keys" } });
  expect(created.ok()).toBeTruthy();
  const { site } = await created.json();
  const url = "/api/doc?site=" + site.id;
  try {
    const node = { id: "n", type: "box", name: "Original", semantic: "auto", children: [], styles: {} };
    const page = { id: "home", slug: "", name: "Home", title: "", description: "", children: ["n"] };
    const text = '{"siteName":"Duplicate keys","nodes":{},"nodes":' + JSON.stringify({ n: node }) +
      ',"pages":' + JSON.stringify({ home: page }) + ',"pageOrder":["home"],"assets":{}}';
    const saved = await request.put(url, { data: text, headers: { "Content-Type": "application/json" } });
    expect(saved.status()).toBe(200);
    const { rev } = await saved.json();
    const edit = { ...node, name: "Edited" };
    const update = await request.patch(url + "&base=" + rev, { data: [{ path: ["nodes", "n"], value: edit }] });
    expect(update.status()).toBe(200);
    const current = await (await request.get(url)).json();
    expect(current.doc.nodes.n.name).toBe("Edited");
  } finally { await request.delete("/api/sites/" + site.id); }
});
