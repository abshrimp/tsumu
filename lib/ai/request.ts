import { buildAiContext, type AiContext } from "../aiOps";
import type { SiteDoc } from "../types";
import type { ChatTurn } from "./run";
import { readJsonRequestLimited } from "../read-json-request";

export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** 形の崩れた要素の木は、たどる前に弾く。AIに見せる状態は、送られてきた編集データから作り直す */
export function parseAiRequest(body: unknown): { turns: ChatTurn[]; context: AiContext } {
  const invalid = () => { throw new Error("Invalid AI request"); };
  if (!record(body) || !Array.isArray(body.messages) || !record(body.context)) return invalid();
  const input = body.context;
  const doc = input.doc;
  const target = input.target;
  if (!record(doc) || !record(doc.pages) || !record(doc.nodes) || !Array.isArray(doc.pageOrder) ||
    !record(target) || typeof target.pageId !== "string" || !Object.hasOwn(doc.pages, target.pageId)) return invalid();
  if (Object.keys(doc.nodes).length > 5000) return invalid();
  for (const [id, page] of Object.entries(doc.pages)) {
    if (!record(page) || page.id !== id || !Array.isArray(page.children) || page.children.some((c: unknown) => typeof c !== "string")) return invalid();
  }
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!record(node) || node.id !== id || typeof node.type !== "string" || !record(node.styles) ||
      !Array.isArray(node.children) || node.children.some((c: unknown) => typeof c !== "string") ||
      (node.text && (!record(node.text) || typeof node.text.content !== "string"))) return invalid();
  }
  let componentId: string | undefined;
  if (target.rootId != null) {
    if (typeof target.rootId !== "string" || !record(doc.components)) return invalid();
    componentId = Object.keys(doc.components).find((id) => doc.components[id]?.rootId === target.rootId);
    if (!componentId) return invalid();
  }
  const seen = new Set<string>();
  function visit(id: string, depth: number) {
    const node = doc.nodes[id];
    if (depth > 50 || seen.has(id) || !Object.hasOwn(doc.nodes, id) || !node) return invalid();
    seen.add(id);
    node.children.forEach((child: string) => visit(child, depth + 1));
  }
  const roots = target.rootId ? [target.rootId] : doc.pages[target.pageId].children;
  roots.forEach((id: string) => visit(id, 0));
  const turns: ChatTurn[] = body.messages.slice(-20).map((m: unknown) => {
    if (!record(m) || !["user", "assistant"].includes(m.role) || typeof m.text !== "string" || !m.text.trim() || m.text.length > 32_000) return invalid();
    return { role: m.role as ChatTurn["role"], text: m.text.trim() };
  });
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns.at(-1)?.role !== "user") return invalid();
  const context = buildAiContext(doc as SiteDoc, {
    pageId: target.pageId, componentId,
    selection: typeof input.selection === "string" ? input.selection : null,
    breakpoint: typeof input.breakpoint === "string" ? input.breakpoint : "base",
  });
  const last = turns[turns.length - 1];
  // Prevent a site element from forging closing tags and impersonating a chat instruction.
  const safeSummary = context.summary.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  last.text = `<editor_state>\n${safeSummary}\n</editor_state>\n\n${last.text}`;
  return { turns, context };
}

/** AI requests share the same streaming byte bound as other untrusted JSON inputs. */
export async function readAiRequest(req: Request): Promise<unknown> {
  return readJsonRequestLimited(req, MAX_REQUEST_BYTES);
}
