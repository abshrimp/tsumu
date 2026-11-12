/**
 * スクリプトのすべての入力欄で共有する、入力欄の情報。ワークスペースには条件のブロックが
 * たくさんあることがあるため、一度だけ索引を作り、入力欄ごとにすべてのノードを調べないようにする。
 */
import { fieldVarName, isRadioItem } from "../../lib/fields";
import type { DocNode, FieldContent, SiteDoc } from "../../lib/types";
import type { TreeRow } from "./targets";

export interface FieldTargetInfo {
  kind: FieldContent["kind"];
  choices: string[];
  bool: boolean;
}

export interface FieldTargetIndex {
  byNode: ReadonlyMap<string, FieldTargetInfo | null>;
  byAttr: ReadonlyMap<string, FieldTargetInfo | null>;
}

export function indexFieldTargets(
  doc: Pick<SiteDoc, "nodes">,
  tree: readonly Pick<TreeRow, "id">[]
): FieldTargetIndex {
  const nodes = tree
    .map(({ id }) => doc.nodes[id])
    .filter((node): node is DocNode => !!node);
  const radioChoices = new Map<string, string[]>();
  const radioSeen = new Map<string, Set<string>>();

  for (const node of nodes) {
    if (node.field?.kind !== "radio") continue;
    const group = fieldVarName(node);
    const label = node.field.label ?? "";
    if (!group || !label) continue;
    const seen = radioSeen.get(group) ?? new Set<string>();
    if (seen.has(label)) continue;
    seen.add(label);
    radioSeen.set(group, seen);
    const labels = radioChoices.get(group) ?? [];
    labels.push(label);
    radioChoices.set(group, labels);
  }

  const byNode = new Map<string, FieldTargetInfo | null>();
  const byAttr = new Map<string, FieldTargetInfo | null>();
  for (const node of nodes) {
    const field = node.type === "field" ? node.field : null;
    let info: FieldTargetInfo | null = null;
    if (field) {
      const bool = field.kind === "checkbox" || isRadioItem(node);
      info = {
        kind: field.kind,
        bool,
        choices: bool ? [] : field.kind === "select"
          ? (field.options ?? []).map((o) => o.value).filter(Boolean)
          : field.kind === "radio"
            ? (radioChoices.get(fieldVarName(node)) ?? [])
            : [],
      };
    }
    byNode.set(node.id, info);
    // 入力欄でなくても、その ID を持つ最初の要素を優先する。
    if (node.attrId && !byAttr.has(node.attrId)) byAttr.set(node.attrId, info);
  }
  return { byNode, byAttr };
}
