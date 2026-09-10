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
      { error: tr("AI機能は有効になっていません") },
      { status: 503 }
    );
  }

  let parsed: ReturnType<typeof parseAiRequest>;
  try {
    parsed = parseAiRequest(await readAiRequest(req));
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError
      ? tr("ページが大きすぎるため、AIに送れません") : tr("リクエストが正しくありません") },
      { status: error instanceof RangeError ? 413 : 400 });
  }
  const { turns, context } = parsed;
  const failure = (e: unknown): string => {
    if (e instanceof AiApiError) {
      console.error("AI request failed", { kind: e.kind, status: e.status });
      if (e.kind === "timeout") return tr("AIの応答が時間内に完了しませんでした。もう一度お試しください。");
      if (e.kind === "incomplete") return tr("AIの編集を完了できませんでした。変更は適用していません。依頼を小さく分けてお試しください。");
      if (e.kind === "auth") return tr("AIサービスに接続できませんでした。管理者に確認してください");
      if (e.kind === "rate") return tr("AIの利用が混み合っています。少し待ってからお試しください");
      return tr("AIに問い合わせできませんでした（{status}）", { status: e.status ?? "?" });
    }
    console.error("AI request failed unexpectedly", { kind: e instanceof Error ? e.name : typeof e });
    return tr("AIに問い合わせできませんでした");
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
      reply: reply === null ? tr("この依頼には対応できませんでした。")
        : reply || (operations.length ? tr("変更しました。") : tr("変更はありませんでした。")),
      operations,
    };
  };
  return aiStreamResponse(execute, failure, req.signal);
}
