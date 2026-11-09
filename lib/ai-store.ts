"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { AiPhase, AiProgress } from "./ai/progress";
import type { SiteDoc } from "./types";

export interface AiChange {
  /** 要素のID（ページ設定の変更は null） */
  id: string | null;
  name: string;
  kinds: string[];
  deleted?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** 適用した操作の数 */
  ops?: number;
  /** 適用した直後の編集データ（現在の内容がこれと同じあいだだけ「元に戻す」を表示する） */
  appliedDoc?: SiteDoc;
  /** 変更した要素（押すとその要素を選ぶ） */
  changes?: AiChange[];
  undone?: boolean;
  error?: boolean;
  activity?: AiProgress[];
}

export interface AiState {
  /** サーバーでAI機能が有効か（null = 確認中） */
  enabled: boolean | null;
  open: boolean;
  messages: ChatMessage[];
  busy: boolean;
  phase: AiPhase;
  activity: AiProgress[];
  startedAt: number | null;
}

export const useAi = create<AiState>(() => ({
  enabled: null,
  open: false,
  messages: [],
  busy: false,
  phase: "preparing",
  activity: [],
  startedAt: null,
}));

export function toggleAi(open?: boolean) {
  useAi.setState((s) => ({ open: open ?? !s.open }));
}

/** エディタを開いたときだけAIの利用可否を取得する。再マウントでも重複させない。 */
let aiAvailabilityRequested = false;

export function useAiAvailability(): boolean {
  const enabled = useAi((s) => s.enabled);
  useEffect(() => {
    if (aiAvailabilityRequested || useAi.getState().enabled !== null) return;
    aiAvailabilityRequested = true;
    void fetch("/api/ai", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabled?: boolean } | null) => {
        useAi.setState({ enabled: !!data?.enabled });
      })
      .catch(() => {
        // 通信に失敗した場合は無効とし、次のページ読み込み時に再確認する。
        useAi.setState({ enabled: false });
      });
  }, []);
  return !!enabled;
}
