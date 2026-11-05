import { makeBox, makeText } from "../../lib/presets";
import { previewRefreshDoc } from "./preview-refresh";

/** 件数をリンクとリスト条件にも使う。デザイン画面の本文は変数のまま表示する。 */
export function previewCountDoc() {
  const doc = previewRefreshDoc();
  doc.siteName = "Preview sample counts";
  doc.nodes.result.link = { kind: "url", url: "/count/{total}" };
  doc.nodes.rows = { ...makeBox(), id: "rows", type: "list", list: { from: "response.rows" }, children: ["row"] };
  doc.nodes.row = { ...makeText("Matching row"), id: "row" };
  doc.nodes.nested = { ...makeText("Nested count"), id: "nested", link: { kind: "url", url: "/nested/{nestedTotal}" } };
  doc.pages.home.children.push("rows", "nested");
  const steps = doc.pages.home.pageScripts![0].steps;
  const fetch = steps[0];
  if (fetch.kind === "fetch") fetch.sample = countedRows("home saved", 1);
  steps.push(
    { id: "nested-alias", kind: "set-var", value: "{response.nested}", into: "nestedData" },
    { id: "nested-count", kind: "count", array: "nestedData.rows", into: "nestedTotal" },
    { id: "count-filter", kind: "filter-array", array: "response.rows", field: "batchSize", op: "eq", value: "{total}" },
  );
  return doc;
}

export function countedRows(label: string, length: number, nestedLength = length) {
  return {
    label,
    rows: Array.from({ length }, (_, id) => ({ id, batchSize: length })),
    nested: { rows: Array.from({ length: nestedLength }, (_, id) => ({ id })) },
  };
}
