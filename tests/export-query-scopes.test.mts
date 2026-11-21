import assert from "node:assert/strict";
import test from "node:test";
import { generateExportProject } from "../lib/export-formats";
import { makeBox, makeText } from "../lib/presets";
import type { SiteDoc } from "../lib/types";

function fixture(listFirst: boolean): SiteDoc {
  const shared = makeText("{値}");
  shared.id = "shared-text";

  const inside = { ...makeBox(), id: "inside", type: "instance" as const,
    componentId: "shared", children: [] };
  const outside = { ...makeBox(), id: "outside", type: "instance" as const,
    componentId: "shared", children: [] };
  const list = { ...makeBox(), id: "collection", type: "list" as const,
    list: { from: "entries" }, children: ["inside"] };

  return {
    siteName: "Shared scope",
    pages: {
      home: { id: "home", name: "Home", slug: "", title: "Home", description: "",
        children: listFirst ? ["collection", "outside"] : ["outside", "collection"] },
    },
    pageOrder: ["home"],
    nodes: { "shared-text": shared, inside, outside, collection: list },
    components: { shared: { id: "shared", name: "Shared", rootId: shared.id } },
    assets: {},
    dataRevalidate: 60,
  };
}

test("shared component query variables are detected outside list item scopes", () => {
  for (const listFirst of [true, false]) {
    const page = generateExportProject(fixture(listFirst), "nextjs").files["app/page.tsx"];
    assert.match(page, /export const dynamic = "force-dynamic"/,
      "query-dependent pages must not cache without their search parameters");
    assert.match(page, /const sp = await searchParams;/,
      "the outside instance must receive the query value even when the list instance is visited first");
    assert.doesNotMatch(page, /export const revalidate = 60/);
  }
});
