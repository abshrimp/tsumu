import { makeText } from "../../lib/presets";
import type { SiteDoc } from "../../lib/types";
export const literalFieldItems = [
  { name: "Literal", "meta.name": "A & B", meta: { name: "Nested other" } },
  { name: "Nested", meta: { name: "A & B" } },
];
export function arrayFindFieldsDoc(items: unknown[] = literalFieldItems, field = "meta.name", key = "A & B", client = false): SiteDoc {
  const find = { id: "find", kind: "array-find" as const, array: client ? "working" : "items", field, value: key, into: "chosen" };
  return { siteName: "Find literal fields", assets: {}, pageOrder: ["p"], pages: {
    p: { id: "p", name: "Home", title: "Home", slug: "", description: "", children: client ? ["act", "result"] : ["result"],
      pageScripts: [{ id: "load", trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: "fetch", kind: "fetch", url: "https://example.test/items", as: "items", sample: items },
        ...(client ? [] : [find]),
      ] }] },
  }, nodes: {
    result: { ...makeText("{chosen.name}"), id: "result", attrId: "result" },
    ...(client ? { act: { ...makeText("Find"), id: "act", attrId: "act", semantic: "button", scripts: [{
      id: "act-script", trigger: "click", pos: { x: 0, y: 0 }, steps: [
        { id: "copy", kind: "set-var", value: "{items}", into: "working" }, find,
      ],
    }] } } : {}),
  } };
}
