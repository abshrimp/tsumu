import { makeBox, makeText } from "../../lib/presets";
import type { DocNode, SiteDoc } from "../../lib/types";

/** 実際のフォーム、リンク、ページスクリプトで再取得するプレビュー。取得先はテストで置き換える。 */
export function previewRefreshDoc(): SiteDoc {
  const nodes: DocNode[] = [
    { ...makeText("{response.label}: {total}"), id: "result" },
    { ...makeBox(), id: "query", attrId: "q", type: "field", field: { kind: "input", inputType: "search", defaultValue: "initial" } },
    { ...makeBox(), id: "submit", type: "field", field: { kind: "submit", label: "Search" } },
    { ...makeText("Open other"), id: "other-link", link: { kind: "url", url: "/other" } },
    { ...makeText("Go back"), id: "home-link", link: { kind: "url", url: "/posts/1" } },
    { ...makeText("{response.label}: {total}"), id: "other-result" },
  ];
  return {
    siteName: "Preview refresh ordering", assets: {}, pageOrder: ["home", "other"],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    pages: Object.fromEntries(["home", "other"].map((id) => [id, {
      id, name: id, title: id, description: "", slug: id === "home" ? "posts/[slug]" : "other",
      children: id === "home" ? ["result", "query", "submit", "other-link"] : ["other-result", "home-link"],
      pageScripts: [{ id: `${id}-load`, trigger: "load", pos: { x: 0, y: 0 }, steps: [
        { id: `${id}-fetch`, kind: "fetch", url: `https://example.test/${id}?q={q}&slug={slug}`, as: "response", sample: { label: `${id} saved`, rows: [{ id: "saved" }] } },
        { id: `${id}-value`, kind: "set-var", value: "{response}", into: "item" },
        { id: `${id}-count`, kind: "count", array: "response.rows", into: "total" },
      ] }],
    }])),
  };
}

export function previewRows(label: string, length = 30) {
  return { label, rows: Array.from({ length }, (_, id) => ({ id, label })) };
}
