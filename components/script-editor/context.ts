/**
 * スクリプト画面の部品が共有する文脈（編集中のスクリプト・要素・繰り返しの中か）
 */

import { createContext } from "react";
import { type PageScript } from "../../lib/script";
import { type PageArray, type PageVariableIndex } from "../../lib/data";
import { type ScriptStep, type SiteDoc } from "../../lib/types";
import { type Loc } from "./step-tree";
import { type MenuTarget, type Target, type TreeRow } from "./targets";

/* ---------- 描画コンテキスト ---------- */

/** テスト実行の出どころ。データ小窓へ移っても要素・くり返しの文脈を保つ。 */
export interface FetchPreviewScope {
  nodeId: string;
  localNames: string[];
  /** 実際にブロックを所有するスクリプト。変数の参照位置とは分ける。 */
  owner?: { scriptId: string; nodeId: string | null };
}

export interface EdCtx {
  doc: SiteDoc;
  pageId: string;
  /** ページ外でも明示的に編集中のコンポーネントroot。 */
  scriptRootIds?: string[];
  targets: Target[];
  /** Pre-indexed once per workspace, rather than scanning all rows per picker. */
  targetLookup?: {
    firstByAttr: ReadonlyMap<string, TreeRow>;
    firstNodeIds: ReadonlySet<string>;
  };
  /** 要素選択で見せる、ページの要素の階層 */
  tree: TreeRow[];
  /** ページのスクリプト（絞り込みの番号を選ぶのに使う） */
  scripts: PageScript[];
  /** Indexed once per document rather than rescanning scripts in every input. */
  variableIndex?: PageVariableIndex;
  /** Shared source-variable choices for transform blocks. */
  transformSources?: Record<string, unknown>;
  /** Page-load scripts and steps executable during pre-rendering (computed once). */
  pageLoadScriptIds: Set<string>;
  serverStepIds: Set<string>;
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
  openPeek: (fetchStepId: string, scope: FetchPreviewScope) => void;
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
export const ScriptOwnerCtx = createContext<FetchPreviewScope["owner"]>(undefined);

/** 入力候補から、自分がいま作ろうとしている出力だけを除く。 */
export const ScriptStepCtx = createContext<string>("");

/** 囲んでいる「要素ごとにくり返す」（内側が先頭）。中の入力で要素の項目を候補に出す */
interface LoopInfo {
  array: string;
  fields: string[];
  /** 空のリストも含めて、参照可能な項目名を列挙する。 */
  roots?: string[];
  samples: Record<string, string>;
}
export const LoopCtx = createContext<LoopInfo[]>([]);
