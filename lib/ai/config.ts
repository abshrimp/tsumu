import { envVar } from "../env";

/**
 * AIに頼む機能の設定（環境変数）。
 *
 * AI_ENABLED=true … 機能を有効にする
 * AI_PROVIDER    … anthropic（既定）/ gemini / openai / openai-compatible
 * AI_API_KEY     … API キー（プロバイダごとの ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY でもよい。両方あれば AI_API_KEY を優先）
 * AI_MODEL       … モデル（anthropic・gemini では省略できる）
 * AI_BASE_URL    … openai-compatible のときの API の URL（例: https://openrouter.ai/api/v1）
 * AI_EFFORT      … 推論の量（low / medium / high / xhigh / max。既定は medium）
 */

export type AiProvider = "anthropic" | "gemini" | "openai" | "openai-compatible";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  apiKey: string | undefined;
  model: string;
  /** OpenAI 互換 API の URL（末尾の / は付けない） */
  baseUrl: string | undefined;
  effort: Effort;
  /** 有効にならない理由（設定の確認に使う） */
  reason: string | null;
}

const PROVIDERS: Record<AiProvider, { keyVar?: string; model?: string; baseUrl?: string }> = {
  anthropic: { keyVar: "ANTHROPIC_API_KEY", model: "claude-opus-5-5" },
  gemini: {
    keyVar: "GEMINI_API_KEY",
    model: "gemini-3.8-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  openai: { keyVar: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  "openai-compatible": {},
};

function isProvider(v: string): v is AiProvider {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, v);
}

/** AI_ENABLED を指定していないとき（使わない設定で、誤りではない）の reason */
export const AI_NOT_ENABLED = "AI_ENABLED is not true";

export function aiConfig(): AiConfig {
  const enabled = /^(1|true|on|yes)$/i.test((envVar("AI_ENABLED") ?? "").trim());
  const raw = (envVar("AI_PROVIDER") ?? "anthropic").trim().toLowerCase();
  const provider: AiProvider = isProvider(raw) ? raw : "anthropic";
  const preset = PROVIDERS[provider];
  const apiKey = envVar("AI_API_KEY")?.trim() || (preset.keyVar ? envVar(preset.keyVar)?.trim() : undefined);
  const model = envVar("AI_MODEL")?.trim() || preset.model || "";
  const baseUrl = (envVar("AI_BASE_URL")?.trim() || preset.baseUrl)?.replace(/\/+$/, "");
  const effort = envVar("AI_EFFORT")?.trim().toLowerCase() as Effort | undefined;
  let validUrl = true;
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      validUrl = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { validUrl = false; }
  }
  const reason = !enabled
    ? AI_NOT_ENABLED
    : !isProvider(raw)
      ? `Unknown AI_PROVIDER: ${raw}`
      : !apiKey
        ? `Set AI_API_KEY${preset.keyVar ? ` or ${preset.keyVar}` : ""}`
        : !model
          ? "Set AI_MODEL"
          : provider !== "anthropic" && !baseUrl
            ? "Set AI_BASE_URL"
            : !validUrl
              ? "AI_BASE_URL must be an HTTP(S) API base URL without credentials, query or fragment"
            : null;
  return {
    enabled: !reason,
    provider,
    apiKey,
    model,
    baseUrl,
    effort: effort && ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : "medium",
    reason,
  };
}
