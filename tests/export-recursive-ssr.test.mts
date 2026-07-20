import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

test("generated Vue/Nuxt/SvelteKit SSR cannot recursively fetch its own page routes", async () => {
  const doc: SiteDoc = {
    siteName: "Guard self-fetch", pageOrder: ["home", "about"],
    pages: {
      home: { id: "home", name: "Home", title: "Home", slug: "", description: "",
        children: ["box"], pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [{ id: "f", kind: "fetch", url: "/api/items", as: "items" }] }] },
      about: { id: "about", name: "About", title: "About", slug: "about",
        description: "", children: [] },
    },
    nodes: { box: { ...makeBox(), id: "box" } }, assets: {},
  };
  for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
    const project = generateExportProject(doc, framework);
    const modulePath = framework === "vue" ? "src/server-request.js"
      : framework === "nuxt" ? "app/generated/server-request.js" : "src/lib/server-request.js";
    const source = project.files[modulePath];
    assert.ok(source, modulePath);
    const { requestPublic } = await import("data:text/javascript;base64," +
      Buffer.from(source).toString("base64")) as {
      requestPublic: (uri: string, init: RequestInit, base: string,
        local: (uri: string) => Promise<Response>) => Promise<Response>;
    };
    let localRequests = 0;
    const local = async () => {
      localRequests++;
      return new Response("{}", { status: 200 });
    };
    for (const uri of ["/", "/?refresh=1", "/about", "/about/", "/about/?query=x"]) {
      await assert.rejects(
        requestPublic(uri, {}, "https://published.example", local),
        /Recursive generated page fetch/, framework + ": " + uri,
      );
    }
    assert.equal(localRequests, 0, framework);
    await requestPublic("/api/items?limit=2", {}, "https://published.example", local);
    assert.equal(localRequests, 1, framework);
  }
});
