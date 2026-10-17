import type { AiOp } from "../aiOps";

export type AiPhase = "preparing" | "planning" | "generating" | "validating" | "repairing" | "reviewing";
export type AiProgress =
  | { type: "phase"; phase: AiPhase; turn?: number }
  | { type: "text"; text: string; turn: number }
  | { type: "operations"; counts: Partial<Record<AiOp["op"], number>>; total: number; errors: number };
export interface AiResult { reply: string; operations: AiOp[] }
export type AiStreamEvent = AiProgress | { type: "result"; result: AiResult } | { type: "error"; error: string } | { type: "ping" };
export const AI_STREAM_TYPE = "application/x-ndjson";

/** ブラウザへ送るのは、画面に出す説明と実行の経過だけ（AIの思考や署名は送らない） */
export function aiStreamResponse(
  work: (emit: (event: AiProgress) => void, signal: AbortSignal) => Promise<AiResult>,
  errorMessage: (error: unknown) => string,
  requestSignal: AbortSignal
): Response {
  const aborter = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let close: (() => void) | undefined;
  const cancel = () => {
    aborter.abort();
    close?.();
  };
  const cleanup = () => {
    clearInterval(heartbeat);
    requestSignal.removeEventListener("abort", cancel);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };
      const emit = (event: AiStreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      requestSignal.addEventListener("abort", cancel, { once: true });
      if (requestSignal.aborted) { cancel(); return; }
      emit({ type: "phase", phase: "preparing" });
      heartbeat = setInterval(() => emit({ type: "ping" }), 15_000);
      void Promise.resolve().then(() => work(emit, aborter.signal))
        .then((result) => { if (!aborter.signal.aborted) emit({ type: "result", result }); })
        .catch((error) => { if (!aborter.signal.aborted) emit({ type: "error", error: errorMessage(error) }); })
        .finally(() => close?.());
    },
    cancel() {
      closed = true;
      aborter.abort();
      cleanup();
    },
  });
  return new Response(body, { headers: {
    "Content-Type": `${AI_STREAM_TYPE}; charset=utf-8`,
    "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

/** 受信の区切りが文字や行の途中でも、UTF-8 を正しく1行ずつ読む */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 16 * 1024 * 1024) throw new Error("AI response is too large");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        yield pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
      }
      if (done) break;
    }
    if (pending) yield pending.replace(/\r$/, "");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readAiResponse(res: Response, onProgress: (event: AiProgress) => void): Promise<AiResult> {
  const validResult = (data: unknown): data is AiResult => !!data && typeof data === "object" &&
    typeof (data as AiResult).reply === "string" && Array.isArray((data as AiResult).operations);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `AI request failed (${res.status})`);
  }
  if (!res.headers.get("content-type")?.includes(AI_STREAM_TYPE)) throw new Error("Invalid AI response format");
  if (!res.body) throw new Error("AI response is missing");
  for await (const line of readLines(res.body)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as AiStreamEvent;
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "result") {
      if (!validResult(event.result)) throw new Error("Invalid AI result");
      return event.result;
    }
    if (["phase", "text", "operations"].includes(event.type)) onProgress(event as AiProgress);
  }
  // 経過だけ届いて結果が無いときは、途中までの編集を適用しない
  throw new Error("AI response ended before completion");
}

/** 少しずつ届く文をまとめ、読みやすい長さの経過の一覧にする */
export function appendAiProgress(events: AiProgress[], next: AiProgress): AiProgress[] {
  const last = events.at(-1);
  if (next.type === "text") {
    if (!next.text) return events;
    if (last?.type === "text" && last.turn === next.turn) {
      return [...events.slice(0, -1), { ...last, text: (last.text + next.text).slice(0, 8000) }];
    }
    next = { ...next, text: next.text.slice(0, 8000) };
  }
  if (next.type === "phase" && last?.type === "phase" && next.phase === last.phase && next.turn === last.turn) return events;
  return [...events, next].slice(-100);
}
