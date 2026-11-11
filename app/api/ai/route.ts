import { NextResponse } from "next/server";
import { serverTr } from "../../../lib/i18n-server";
import { requireAuth } from "../../../lib/server";
import { applyAiOps, MAX_AI_ADDED_NODES, type AiOp } from "../../../lib/aiOps";
import { AI_NOT_ENABLED, aiConfig } from "../../../lib/ai/config";
import { AiApiError, runAi } from "../../../lib/ai/run";
import { parseAiRequest, readAiRequest } from "../../../lib/ai/request";
import { aiStreamResponse, type AiProgress, type AiResult } from "../../../lib/ai/progress";

export const maxDuration = 300;

/**
 * AIに頼んで編集する（チャット）。設定は lib/ai/config.ts を参照。
 * AIは edit_site の操作を返し、ここでページの写しに試しに適用して誤りをAIへ返す。
 * 適用できた操作（新しい要素のIDを確定させたもの）をブラウザへ返し、ブラウザが同じ処理で適用する
 */

/** AI機能が使えるか（画面にボタンを出すかの判定） */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const conf = aiConfig();
  // 有効にしようとしているのに設定が足りないときは、理由をサーバーのログに出す（画面には出さない）
  if (conf.reason && conf.reason !== AI_NOT_ENABLED) console.warn("AI is unavailable:", conf.reason);
  return NextResponse.json({
    enabled: conf.enabled,
    provider: conf.enabled ? conf.provider : null,
    model: conf.enabled ? conf.model : null,
  });
}

export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  const conf = aiConfig();
  if (!conf.enabled) {
    console.warn("AI is unavailable:", conf.reason);
    return NextResponse.json(
      { error: tr("AI isn't enabled") },
      { status: 503 }
    );
  }

  let parsed: ReturnType<typeof parseAiRequest>;
  try {
    parsed = parseAiRequest(await readAiRequest(req));
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError
      ? tr("This page is too large to send to AI") : trc("invalid_request_variant_1", "Invalid request") },
      { status: error instanceof RangeError ? 413 : 400 });
  }
  const { turns, context } = parsed;
  const failure = (e: unknown): string => {
    if (e instanceof AiApiError) {
      console.error("AI request failed", { kind: e.kind, status: e.status });
      if (e.kind === "timeout") return tr("The AI response timed out. Please try again.");
      if (e.kind === "incomplete") return tr("The AI couldn't complete the edit. No changes were applied. Try a smaller request.");
      if (e.kind === "auth") return tr("Couldn't connect to the AI service. Contact your administrator");
      if (e.kind === "rate") return tr("AI is busy right now. Please try again in a moment");
      return tr("Couldn't reach AI ({status})", { status: e.status ?? "?" });
    }
    console.error("AI request failed unexpectedly", { kind: e instanceof Error ? e.name : typeof e });
    return tr("Couldn't reach AI");
  };
  const execute = async (emit: (event: AiProgress) => void, signal: AbortSignal): Promise<AiResult> => {
    const refs = new Map<string, string>();
    const operations: AiOp[] = [];
    const initialNodeCount = Object.keys(context.doc.nodes).length;
    const reply = await runAi(conf, turns, (input) => {
      const ops = (input as { operations?: unknown })?.operations;
      if (!Array.isArray(ops)) return { content: "operations must be an array", isError: true };
      const { applied, errors } = applyAiOps(context.doc, ops as AiOp[], context.target, refs);
      operations.push(...applied);
      if (Object.keys(context.doc.nodes).length > initialNodeCount + MAX_AI_ADDED_NODES) {
        throw new AiApiError("incomplete", undefined, "AI element growth limit reached");
      }
      if (operations.length > 400) throw new AiApiError("incomplete", undefined, "Operation limit reached");
      const counts: Partial<Record<AiOp["op"], number>> = {};
      for (const op of applied) counts[op.op] = (counts[op.op] ?? 0) + 1;
      emit({ type: "operations", counts, total: applied.length, errors: errors.length });
      const createdIds = applied.flatMap((op) =>
        op.op === "insert" ? [op.node.id] : op.op === "duplicate" ? [op.newId] : []
      );
      return {
        content: JSON.stringify({
          applied: applied.length,
          refs: Object.fromEntries(refs),
          ...(createdIds.length ? { createdIds } : {}),
          ...(errors.length ? { errors } : {}),
        }),
        isError: errors.length > 0,
      };
    }, signal, emit);
    return {
      reply: reply === null ? tr("I couldn't help with this request.")
        : reply || (operations.length ? tr("Done.") : tr("Nothing was changed.")),
      operations,
    };
  };
  return aiStreamResponse(execute, failure, req.signal);
}
