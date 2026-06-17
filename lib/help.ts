"use client";

/**
 * ヘルプ（Webマニュアル）と操作ガイドの表示状態。
 * どこからでも openHelp("記事ID") で記事を開き、startGuide で画面の場所を示しながら案内する
 */

import { create } from "zustand";

interface HelpState {
  /** ヘルプのパネルを開いているか */
  open: boolean;
  /** 開いている記事（null = 一覧） */
  topicId: string | null;
  /** 記事から記事へたどったときの戻り先 */
  back: string[];
  /** 実行中の操作ガイド（step = いまの手順の番号） */
  guide: { topicId: string; step: number } | null;
}

export const useHelp = create<HelpState>(() => ({
  open: false,
  topicId: null,
  back: [],
  guide: null,
}));

/** ヘルプを開く（topicId を渡すとその記事を開く）。操作ガイドの途中なら終える */
export function openHelp(topicId: string | null = null) {
  useHelp.setState({ open: true, topicId, back: [], guide: null });
}

/** ヘルプの中で別の記事へ進む（戻るボタンで前の記事に戻れる） */
export function showTopic(topicId: string | null) {
  useHelp.setState((s) => ({
    topicId,
    back: topicId && s.topicId ? [...s.back, s.topicId] : [],
  }));
}

/** 1つ前の記事（無ければ一覧）へ戻る */
export function goBack() {
  useHelp.setState((s) => ({
    topicId: s.back[s.back.length - 1] ?? null,
    back: s.back.slice(0, -1),
  }));
}

export function closeHelp() {
  useHelp.setState({ open: false });
}

export function toggleHelp() {
  const s = useHelp.getState();
  if (s.open) closeHelp();
  else useHelp.setState({ open: true, guide: null });
}

/** 記事の操作ガイドを始める（ヘルプのパネルは閉じて、画面の場所を示す） */
export function startGuide(topicId: string, step = 0) {
  useHelp.setState({ open: false, guide: { topicId, step } });
}

export function setGuideStep(step: number) {
  useHelp.setState((s) => (s.guide ? { guide: { ...s.guide, step } } : {}));
}

/** 操作ガイドを終える（backToTopic なら、その記事をヘルプで開き直す） */
export function stopGuide(backToTopic = false) {
  const g = useHelp.getState().guide;
  useHelp.setState({
    guide: null,
    ...(backToTopic && g ? { open: true, topicId: g.topicId, back: [] } : {}),
  });
}
