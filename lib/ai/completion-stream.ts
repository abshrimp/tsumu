import { readLines } from "./progress";

/** ストリームの途中で上流が返したエラー（HTTPの状態は200のまま届く） */
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
      // 署名などの追加情報はツール呼び出しに付ける（画面に出す文には混ぜない）
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
