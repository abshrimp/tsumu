import { scriptDragDoc } from "./script-drag";

/** Fixed P4-05 data: both layouts contain exactly 4000 blocks. */
export function scriptWorkspaceDoc(layout: "single" | "stacks") {
  const doc = scriptDragDoc();
  const count = layout === "single" ? 1 : 160;
  const perScript = 4000 / count;
  doc.pages.p.pageScripts = Array.from({ length: count }, (_, i) => ({
    id: `stack-${i}`, trigger: "load" as const,
    pos: { x: 32, y: 32 + i * 1600 },
    steps: Array.from({ length: perScript }, (_, j) => ({
      id: `wait-${i * perScript + j}`, kind: "wait" as const, seconds: 1,
    })),
  }));
  return doc;
}
