import { applyAiOps, buildAiContext, type AiContext, type AiOp } from "../aiOps";
import type { SiteDoc } from "../types";

export class AiEditConflict extends Error {}

/** updateDoc の中で呼ぶ。途中で失敗したら、どの操作も適用せず履歴にも残さない */
export function applyAiEdits(doc: SiteDoc, context: AiContext, ops: AiOp[]): number {
  const componentId = context.target.rootId
    ? Object.keys(context.doc.components ?? {}).find((id) => context.doc.components?.[id].rootId === context.target.rootId)
    : undefined;
  const current = buildAiContext(doc, { pageId: context.target.pageId, componentId });
  if (JSON.stringify(current.doc) !== JSON.stringify(context.doc)) throw new AiEditConflict("The edited document changed");
  // AIはツールを何回か呼ぶことがあり、1回につき最大200件の操作を返す
  if (!Array.isArray(ops) || ops.length > 400) throw new Error("Invalid operations");
  const draft = structuredClone(doc);
  let count = 0;
  for (let i = 0; i < ops.length; i += 200) {
    const result = applyAiOps(draft, ops.slice(i, i + 200), context.target);
    if (result.errors.length || result.applied.length !== Math.min(200, ops.length - i)) throw new AiEditConflict("The AI edits could not be applied");
    count += result.applied.length;
  }
  Object.assign(doc, draft);
  return count;
}
