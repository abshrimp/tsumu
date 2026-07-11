import Anthropic from "@anthropic-ai/sdk";
import type { AiConfig } from "./config";
import type { AiProgress } from "./progress";
import { ModelStreamError, readCompletionStream } from "./completion-stream";
import { editToolSchema, PORTABLE_NOTE, SYSTEM, TOOL_DESCRIPTION, TOOL_NAME } from "./prompt";

const MAX_TURNS = 8;
const REQUEST_TIMEOUT = 240_000;
/** 混雑（429・503 など）のときに待ってから再試行する間隔 */
const RETRY_DELAYS = [1_000, 3_000];
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}
export type ToolHandler = (input: unknown) => { content: string; isError: boolean };

export class AiApiError extends Error {
  constructor(
    readonly kind: "auth" | "rate" | "timeout" | "incomplete" | "other",
    readonly status?: number,
    message?: string
  ) {
    super(message ?? kind);
  }
}

interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  invalid?: boolean;
}
interface Step {
  text: string;
  calls: ToolCall[];
  refused: boolean;
  truncated: boolean;
  respond: (results: ReturnType<ToolHandler>[]) => void;
}

/** 時間の上限は、応答の読み込みも含めたツール呼び出しのくり返し全体にかける */
export async function runAi(
  conf: AiConfig,
  turns: ChatTurn[],
  onTool: ToolHandler,
  signal?: AbortSignal,
  onProgress?: (event: AiProgress) => void
): Promise<string | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT);
  let needsRepair = false;
  let currentTurn = 1;
  let generating = false;
  const onText = onProgress ? (text: string) => onProgress({ type: "text", text, turn: currentTurn }) : undefined;
  const onTools = () => {
    if (!generating) onProgress?.({ type: "phase", phase: "generating", turn: currentTurn });
    generating = true;
  };
  try {
    const next = conf.provider === "anthropic"
      ? anthropicSession(conf, turns, controller.signal, onText, onTools)
      : compatibleSession(conf, turns, controller.signal, onText, onTools);
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      controller.signal.throwIfAborted();
      currentTurn = turn + 1;
      generating = false;
      onProgress?.({ type: "phase", phase: turn === 0 ? "planning" : needsRepair ? "repairing" : "reviewing", turn: currentTurn });
      const step = await next();
      controller.signal.throwIfAborted();
      if (step.truncated) throw new AiApiError("incomplete", undefined, "Model output was truncated");
      if (step.refused) {
        if (turn > 0) throw new AiApiError("incomplete");
        return step.text || null;
      }
      if (!step.calls.length) {
        if (needsRepair) throw new AiApiError("incomplete", undefined, "Tool errors were not repaired");
        if (!step.text) throw new AiApiError("other", undefined, "The model returned an empty response");
        // 返すのは最後の応答の文だけ（ツールを動かす前に出した文は、完了の返答に使わない）
        return step.text;
      }
      onProgress?.({ type: "phase", phase: "validating", turn: currentTurn });
      const results = step.calls.map((call) => {
        if (call.name !== TOOL_NAME) return { content: `Unknown tool: ${call.name}`, isError: true };
        if (call.invalid) return { content: "Arguments must be a JSON object", isError: true };
        return onTool(call.input);
      });
      needsRepair = results.some((r) => r.isError);
      step.respond(results);
    }
    throw new AiApiError("incomplete", undefined, "Tool turn limit reached");
  } catch (error) {
    if (controller.signal.aborted) throw new AiApiError("timeout");
    if (error instanceof AiApiError) throw error;
    if (error instanceof Anthropic.APIError || error instanceof ModelStreamError) throw apiError(error.status, error.message);
    throw new AiApiError("other", undefined, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    signal.throwIfAborted();
    signal.addEventListener("abort", stop, { once: true });
  });
}

function apiError(status: number | undefined, detail: string): AiApiError {
  // 503・529 はモデルの混雑（Gemini の high demand など）
  return new AiApiError(status === 401 || status === 403 ? "auth" : status === 429 || status === 503 || status === 529 ? "rate" : "other", status, detail);
}

function anthropicSession(conf: AiConfig, turns: ChatTurn[], signal: AbortSignal, onText?: (text: string) => void, onTools?: () => void): () => Promise<Step> {
  const client = new Anthropic({ apiKey: conf.apiKey, maxRetries: 0 });
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  return async () => {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: conf.model,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: editToolSchema(false) as Anthropic.Tool["input_schema"] }],
      messages,
      output_config: { effort: conf.effort },
    };
    let res: Anthropic.Message;
    if (onText) {
      const stream = client.messages.stream(params, { signal });
      stream.on("text", onText);
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") onTools?.();
      });
      res = await stream.finalMessage();
    } else {
      res = await client.messages.create(params, { signal });
    }
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return {
      text: res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim(),
      calls: calls.map((c) => ({ id: c.id, name: c.name, input: c.input })),
      refused: res.stop_reason === "refusal",
      truncated: res.stop_reason === "max_tokens",
      respond(results) {
        messages.push({ role: "assistant", content: res.content });
        messages.push({ role: "user", content: calls.map((c, i) => ({
          type: "tool_result", tool_use_id: c.id, content: results[i].content, is_error: results[i].isError,
        })) });
      },
    };
  };
}

interface OaiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
  refusal?: string;
}

function compatibleSession(conf: AiConfig, turns: ChatTurn[], signal: AbortSignal, onText?: (text: string) => void, onTools?: () => void): () => Promise<Step> {
  const messages: OaiMessage[] = [
    { role: "system", content: SYSTEM + PORTABLE_NOTE },
    ...turns.map((t) => ({ role: t.role, content: t.text })),
  ];
  // 任意の互換APIは標準のツール呼び出しにだけ対応していればよいので、考える深さ（reasoning_effort）は送らない
  let sendEffort = conf.provider !== "openai-compatible";
  let sendStream = !!onText;
  return async () => {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${conf.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conf.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: conf.model,
          messages,
          tools: [{ type: "function", function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: editToolSchema(true) } }],
          tool_choice: "auto",
          ...(sendStream ? { stream: true } : {}),
          ...(sendEffort ? { reasoning_effort: ["xhigh", "max"].includes(conf.effort) ? "high" : conf.effort } : {}),
        }),
        signal,
      });
      if (res.ok) break;
      const detail = await res.text();
      if (RETRYABLE.has(res.status) && attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt], signal);
        continue;
      }
      if ((res.status === 400 || res.status === 422) && sendEffort && /reasoning[_ ]?effort/i.test(detail)) {
        sendEffort = false;
        continue;
      }
      if ((res.status === 400 || res.status === 422) && sendStream && /\bstream(?:ing)?\b/i.test(detail)) {
        sendStream = false;
        continue;
      }
      throw apiError(res.status, detail.slice(0, 500));
    }
    const streamed = res.headers.get("content-type")?.includes("text/event-stream");
    const data = (streamed
      ? await readCompletionStream(res, onText ?? (() => {}), onTools ?? (() => {}))
      : await res.json()) as { choices?: { message?: OaiMessage; finish_reason?: string }[] };
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message || (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) {
      throw new AiApiError("other", undefined, "Invalid model response");
    }
    if (!streamed && typeof message.content === "string") onText?.(message.content);
    const calls = message.tool_calls ?? [];
    if (calls.some((c) => !c?.id || !c.function?.name)) throw new AiApiError("other", undefined, "Invalid tool call");
    return {
      text: typeof message.content === "string" ? message.content.trim() : "",
      refused: choice?.finish_reason === "content_filter" || !!message.refusal,
      truncated: choice?.finish_reason === "length",
      calls: calls.map((c) => {
        try {
          const input: unknown = JSON.parse(c.function.arguments);
          return { id: c.id, name: c.function.name, input, invalid: !input || typeof input !== "object" || Array.isArray(input) };
        } catch {
          return { id: c.id, name: c.function.name, input: null, invalid: true };
        }
      }),
      respond(results) {
        // プロバイダの追加情報（Gemini の思考の署名など）もそのまま返す
        messages.push({ ...message, role: "assistant" });
        calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id,
          content: results[i].isError ? `Error: ${results[i].content}` : results[i].content }));
      },
    };
  };
}
