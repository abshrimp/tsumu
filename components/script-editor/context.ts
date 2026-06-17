/**
 * スクリプト画面の部品が共有する文脈（編集中のスクリプト・要素・繰り返しの中か）
 */

import { createContext } from "react";
import { type PageScript } from "../../lib/script";
import { type PageArray } from "../../lib/data";
import { type ScriptStep, type SiteDoc } from "../../lib/types";
import { type Loc } from "./step-tree";
import { type MenuTarget, type Target, type TreeRow } from "./targets";

/* ---------- 描画コンテキスト ---------- */

export interface EdCtx {
  doc: SiteDoc;
  pageId: string;
  targets: Target[];
  /** 要素選択で見せる、ページの要素の階層 */
  tree: TreeRow[];
  /** ページのスクリプト（絞り込みの番号を選ぶのに使う） */
  scripts: PageScript[];
  /** きっかけにできる要素（ページ内の全要素） */
  elements: { id: string; label: string }[];
  /** 要素設定から開いたときの要素 */
  focusNodeId: string | null;
  /** ドラッグ中の見た目など、操作できない描画 */
  readOnly: boolean;
  activeSlot: string | null;
  /** 選択中のブロック（"step:<ID>" / "script:<ID>"） */
  selected: Set<string>;
  /** スクリプトの重なり順（スクリプトID → z-index。最後に選んだものほど手前） */
  zOrder: Map<string, number>;
  updateStep: (stepId: string, fn: (s: ScriptStep) => ScriptStep) => void;
  updateScript: (scriptId: string, patch: Partial<PageScript>) => void;
  /** 「このページ｜ページを開いたとき」の直下か（データの読み込みが動く位置） */
  isPageLoadRoot: (loc: Loc) => boolean;
  /** 変数・配列・取得したデータの名前を変える（ページ内で使っている箇所も書き換える） */
  renameVar: (stepId: string, from: string, to: string) => void;
  /** 取得したデータを表で見る小窓を開く */
  openPeek: (fetchStepId: string) => void;
  /** ページの配列 */
  arrays: PageArray[];
  /** 見本で実行したときの変数の値（配列の中身を選ぶのに使う） */
  samples: Record<string, unknown>;
  beginSteps: (e: React.PointerEvent, loc: Loc, stepId: string) => void;
  beginScript: (e: React.PointerEvent, script: PageScript) => void;
  openMenu: (e: React.MouseEvent, target: MenuTarget, key: string) => void;
}

export const Ctx = createContext<EdCtx>(null!);

/** スクリプトがきっかけにしている要素（"" = ページ・未選択）。変数の候補をその位置で出す */
export const ScriptNodeCtx = createContext<string>("");

/** 囲んでいる「要素ごとにくり返す」（内側が先頭）。中の入力で要素の項目を候補に出す */
interface LoopInfo {
  array: string;
  fields: string[];
  samples: Record<string, string>;
}
export const LoopCtx = createContext<LoopInfo[]>([]);
