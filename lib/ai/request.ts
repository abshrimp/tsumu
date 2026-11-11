import { buildAiContext, type AiContext } from "../aiOps";
import { BODY_NODE_ID, type SiteDoc } from "../types";
import { pageLangOf, siteLangOf } from "../site-lang";
import { normalizeBreakpoints } from "../style";
import type { ChatTurn } from "./run";
import { readJsonLimited } from "../api-json";

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
  const safeSummary = summarizeContext(context, componentId).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  last.text = `<editor_state>\n${safeSummary}\n</editor_state>\n\n${last.text}`;
  return { turns, context };
}

const MAX_TEXT = 400;

/** 要素を、AIが読みやすい短い形にする */
function outline(doc: SiteDoc, id: string, depth: number): unknown {
  const n = doc.nodes[id];
  if (!n) return null;
  const o: Record<string, unknown> = { id: n.id, type: n.type, name: n.name };
  if (n.semantic === "custom") o.tag = n.customTag || "div";
  else if (n.semantic !== "auto") o.tag = n.semantic;
  if (n.text) {
    o.text = n.text.content.length > MAX_TEXT ? `${n.text.content.slice(0, MAX_TEXT)}…` : n.text.content;
    if (n.text.heading) o.heading = n.text.heading;
  }
  if (n.link) o.link = n.link.kind === "page" ? { pageId: n.link.pageId } : { url: n.link.url };
  if (n.image) o.image = { src: n.image.src.slice(0, 200), alt: n.image.alt };
  if (n.type === "instance") o.component = doc.components?.[n.componentId ?? ""]?.name;
  if (n.type === "code") o.html = (n.code?.html ?? "").slice(0, 200);
  if (n.type === "list") o.list = n.list;
  if (Object.keys(n.styles).length) o.styles = n.styles;
  if (n.customCss) o.customCss = n.customCss;
  if (n.hiddenOn?.length) o.hiddenOn = n.hiddenOn;
  if (n.locked) o.locked = true;
  if (n.scripts?.length) o.hasScripts = true;
  if (n.attrId) o.attrId = n.attrId;
  if (n.children.length) o.children = depth > 40 ? "…" : n.children.map((c) => outline(doc, c, depth + 1));
  return o;
}

function summarizeContext(context: AiContext, componentId?: string): string {
  const { doc, target } = context;
  const comp = componentId ? doc.components?.[componentId] : undefined;
  const page = doc.pages[target.pageId];
  const rootIds = comp ? [comp.rootId] : page.children;
  const bps = normalizeBreakpoints(doc.breakpoints);
  const summary = {
    site: doc.siteName,
    // 新しく書く文章の言語（編集中のページの言語。コンポーネントはサイトの言語）
    language: comp ? siteLangOf(doc) : pageLangOf(doc, page),
    breakpoints: [
      { id: "base", appliesTo: "all widths (desktop design)" },
      ...bps.map((b) => ({ id: b.id, label: b.label, appliesTo: `max-width ${b.maxWidth}px` })),
    ],
    colorPalette: doc.colorPalette,
    fonts: doc.customFonts?.map((f) => f.family),
    pages: doc.pageOrder.map((id) => ({ id, name: doc.pages[id]?.name, url: `/${doc.pages[id]?.slug ?? ""}` })),
    editing: comp
      ? { component: comp.name, rootId: comp.rootId }
      : {
          page: { id: page?.id, name: page?.name, url: `/${page?.slug ?? ""}`, title: page?.title, description: page?.description },
          bodyStyles: page?.bodyStyles,
        },
    viewingBreakpoint: context.breakpoint ?? "base",
    selectedElementId: context.selection && (Object.hasOwn(doc.nodes, context.selection) || context.selection === BODY_NODE_ID) ? context.selection : null,
    elements: rootIds.map((id) => outline(doc, id, 0)),
  };
  return JSON.stringify(summary);
}

/** AI requests share the same streaming byte bound as other untrusted JSON inputs. */
export async function readAiRequest(req: Request): Promise<unknown> {
  return readJsonLimited(req, MAX_REQUEST_BYTES);
}
