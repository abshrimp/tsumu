import { readLines } from "./progress";

/** ストリームの途中で上流が返したエラー（HTTP の状態は 200 のまま届く） */
export class ModelStreamError extends Error {
  constructor(readonly status: number | undefined, message: string) {
    super(message);
  }
}

/** チャット補完のストリームを組み立てる（Gemini がツール呼び出しに付ける追加情報も残す） */
export async function readCompletionStream(res: Response, onText: (text: string) => void, onTools: () => void) {
  if (!res.body) throw new Error("Missing model response stream");
  let content = "";
  let refusal = "";
  let finish: string | undefined;
  const calls = new Map<number, Record<string, any>>();
  let frame: string[] = [];
  let done = false;
  const consume = () => {
    const raw = frame.join("\n");
    frame = [];
    if (!raw) return;
    if (raw === "[DONE]") { done = true; return; }
    const parsed = JSON.parse(raw);
    // Gemini は途中のエラーを配列で包んで送ることがある
    const data = Array.isArray(parsed) ? parsed[0] ?? {} : parsed;
    if (data.error) {
      const code = Number(data.error.code ?? data.error.status);
      throw new ModelStreamError(Number.isInteger(code) && code >= 400 ? code : undefined,
        `Model stream reported an error: ${String(data.error.message ?? JSON.stringify(data.error)).slice(0, 500)}`);
    }
    const choice = data.choices?.find((c: { index?: number }) => c.index === 0 || c.index === undefined);
    if (!choice) return; // 使用量だけのフレーム
    const delta = choice.delta ?? {};
    if (typeof delta.content === "string") { content += delta.content; onText(delta.content); }
    if (typeof delta.refusal === "string") refusal += delta.refusal;
    if (delta.tool_calls?.length) onTools();
    for (const part of delta.tool_calls ?? []) {
      // Gemini は index を付けずに、呼び出しごとにまとめて送ることがある。そのときは id で見分ける
      const index: number = Number.isInteger(part.index) ? part.index
        : part.id ? ([...calls].find(([, c]) => c.id === part.id)?.[0] ?? calls.size)
        : Math.max(calls.size - 1, 0);
      if (index < 0 || index > 100) throw new Error("Invalid tool index");
      const current = calls.get(index) ?? { type: "function", function: { name: "", arguments: "" } };
      if (part.id) current.id = part.id;
      if (part.type) current.type = part.type;
      if (typeof part.function?.name === "string") current.function.name += part.function.name;
      if (typeof part.function?.arguments === "string") current.function.arguments += part.function.arguments;
      // 署名などの追加情報は、ツール呼び出しに付ける（画面に表示する文には混ぜない）
      if (part.extra_content) current.extra_content = mergeMetadata(current.extra_content, part.extra_content);
      calls.set(index, current);
    }
    if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
  };
  for await (const line of readLines(res.body)) {
    if (line === "") consume();
    else if (line.startsWith("data:")) frame.push(line.slice(5).replace(/^ /, ""));
    if (done) break;
  }
  if (frame.length) consume();
  if (!finish) throw new ModelStreamError(undefined, "Model stream ended before completion");
  return { choices: [{ finish_reason: finish, message: {
    role: "assistant", content: content || null, ...(refusal ? { refusal } : {}),
    ...(calls.size ? { tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } : {}),
  } }] };
}

function mergeMetadata(previous: any, incoming: any): any {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  const result = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    result[key] = mergeMetadata(result[key], value);
  }
  return result;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: unknown;
  [key: string]: unknown;
}

export interface AnthropicStreamMessage {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  invalidTools?: Set<string>;
}

const ANTHROPIC_ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

/** Anthropic Messages の SSE ストリームを組み立てる（思考・署名の非公開ブロックもそのまま保持する） */
export async function readAnthropicStream(
  res: Response,
  onText: (text: string) => void,
  onTools: () => void,
): Promise<AnthropicStreamMessage> {
  if (!res.body) throw new Error("Missing model response stream");
  const blocks = new Map<number, AnthropicContentBlock>();
  const jsonInputs = new Map<number, string>();
  const invalidTools = new Set<string>();
  let stopReason: string | null = null;
  let started = false;
  let stopped = false;
  let frame: string[] = [];

  const consume = () => {
    const raw = frame.join("\n");
    frame = [];
    if (!raw) return;
    const data = JSON.parse(raw) as Record<string, any>;
    if (data.type === "ping") return;
    if (data.type === "error" || data.error) {
      const err = data.error ?? {};
      const mapped = typeof err.type === "string" ? ANTHROPIC_ERROR_STATUS[err.type] : undefined;
      const numeric = Number(err.status ?? err.code);
      const status = mapped ?? (Number.isInteger(numeric) && numeric >= 400 ? numeric : undefined);
      throw new ModelStreamError(
        status,
        `Model stream reported an error: ${String(err.message ?? JSON.stringify(err)).slice(0, 500)}`,
      );
    }
    if (data.type === "message_start") {
      started = true;
      stopReason = data.message?.stop_reason ?? null;
      if (Array.isArray(data.message?.content)) {
        data.message.content.forEach((b: AnthropicContentBlock, idx: number) => {
          blocks.set(idx, structuredClone(b));
        });
      }
      return;
    }
    if (data.type === "content_block_start") {
      const index = Number(data.index);
      if (!Number.isInteger(index) || index < 0 || index > 200) throw new Error("Invalid content block index");
      const block = structuredClone((data.content_block ?? {}) as AnthropicContentBlock);
      blocks.set(index, block);
      if (block.type === "tool_use") {
        onTools();
        jsonInputs.set(index, "");
      }
      return;
    }
    if (data.type === "content_block_delta") {
      const index = Number(data.index);
      const block = blocks.get(index);
      const delta = data.delta ?? {};
      if (!block) return;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        block.text = (typeof block.text === "string" ? block.text : "") + delta.text;
        onText(delta.text);
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        block.thinking = (typeof block.thinking === "string" ? block.thinking : "") + delta.thinking;
      } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
        block.signature = (typeof block.signature === "string" ? block.signature : "") + delta.signature;
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        jsonInputs.set(index, (jsonInputs.get(index) ?? "") + delta.partial_json);
      }
      return;
    }
    if (data.type === "content_block_stop") {
      const index = Number(data.index);
      const block = blocks.get(index);
      if (block?.type === "tool_use" && jsonInputs.has(index)) {
        const rawJson = jsonInputs.get(index)!;
        if (rawJson.trim()) {
          try {
            const parsed: unknown = JSON.parse(rawJson);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              block.input = parsed;
            } else {
              block.input = {};
              if (typeof block.id === "string") invalidTools.add(block.id);
            }
          } catch {
            block.input = {};
            if (typeof block.id === "string") invalidTools.add(block.id);
          }
        }
      }
      return;
    }
    if (data.type === "message_delta") {
      if (data.delta && "stop_reason" in data.delta) stopReason = data.delta.stop_reason ?? null;
      return;
    }
    if (data.type === "message_stop") {
      stopped = true;
    }
  };

  for await (const line of readLines(res.body)) {
    if (line === "") consume();
    else if (line.startsWith("data:")) frame.push(line.slice(5).replace(/^ /, ""));
    if (stopped) {
      if (frame.length) consume();
      break;
    }
  }
  if (frame.length) consume();
  if (!started || !stopped) throw new ModelStreamError(undefined, "Model stream ended before completion");
  return {
    content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block),
    stop_reason: stopReason,
    invalidTools,
  };
}
