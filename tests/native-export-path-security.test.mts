import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(slug: string): SiteDoc {
  return {
    siteName: "Native export route audit",
    pageOrder: ["home"],
    pages: {
      home: {
        id: "home", name: "Home", title: "Home", slug,
        description: "", children: ["content"],
        pageScripts: [{
          id: "load", trigger: "load", pos: { x: 0, y: 0 },
          steps: [{ id: "get", kind: "fetch", url: "https://api.example.test/data", as: "records" }],
        }],
      },
    },
    nodes: { content: { ...makeBox(), id: "content" } },
    assets: {},
  };
}

for (const framework of ["vue", "nuxt", "sveltekit"] as const) {
  const base = framework === "vue" ? "src/" :
    framework === "nuxt" ? "app/generated/" : "src/lib/";

  test(framework + " native routes match percent-encoded Unicode without decoding encoded slashes", async () => {
    const files = generateExportProject(fixture("資料/ご案内"), framework).files;
    const routes = files[base + "site-routes.js"];
    assert.ok(routes);
    const module = await import("data:text/javascript;base64," +
      Buffer.from(routes).toString("base64")) as {
        pages: Array<{ id: string }>;
        selectPage: (pathname: string, query: string) => { id: string } | null;
      };

    assert.equal(module.selectPage("/%E8%B3%87%E6%96%99/%E3%81%94%E6%A1%88%E5%86%85/", "")?.id, "home");
    assert.equal(module.selectPage("/資料/ご案内", "")?.id, "home");
    assert.equal(module.selectPage("/%E8%B3%87%E6%96%99%2F%E3%81%94%E6%A1%88%E5%86%85", ""), null);
    assert.equal(module.selectPage("/%broken", ""), null);
  });

  test(framework + " generated SSR rejects reserved IPv4 ranges and home.arpa", () => {
    const files = generateExportProject(fixture(""), framework).files;
    const code = files[base + "server-request.js"];
    assert.ok(code);
    const policy = /^function publicHost\(host\) \{[\s\S]*?^\}/m.exec(code);
    assert.ok(policy);
    const isPublic = new Function(policy[0] + "\nreturn publicHost;")() as (host: string) => boolean;

    for (const host of [
      "192.0.0.9", "192.0.8.1", "192.168.1.1", "127.0.0.1",
      "169.254.169.254", "api.home.arpa", "home.arpa", "localhost",
    ]) {
      assert.equal(isPublic(host), false, framework + " allowed " + host);
    }
    assert.equal(isPublic("api.example.test"), true);
  });
}

test("generated SSR blocks recursive requests to a percent-encoded Unicode page path", async () => {
  const code = generateExportProject(fixture("資料/ご案内"), "sveltekit")
    .files["src/lib/server-request.js"];
  const module = await import("data:text/javascript;base64," +
    Buffer.from(code).toString("base64")) as {
      requestPublic: (
        uri: string, init: RequestInit, base: string,
        localFetch: (url: string, init: RequestInit) => Promise<Response>,
      ) => Promise<Response>;
    };
  let requests = 0;
  await assert.rejects(
    module.requestPublic("/%E8%B3%87%E6%96%99/%E3%81%94%E6%A1%88%E5%86%85/", {},
      "https://site.example", async () => {
        requests++;
        return new Response("{}");
      }),
    /Recursive generated page fetch/,
  );
  assert.equal(requests, 0, "a recursive route must be rejected before it reaches localFetch");
});
