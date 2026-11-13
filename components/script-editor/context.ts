/**
 * スクリプトの画面の部品が共有する文脈（編集中のスクリプト・要素、くり返しの中か）
 */

import { createContext } from "react";
import { type PageScript } from "../../lib/script";
import { type PageArray, type PageVariableIndex } from "../../lib/data";
import { type ScriptStep, type SiteDoc } from "../../lib/types";
import { type Loc } from "./step-tree";
import { type MenuTarget, type Target, type TreeRow } from "./targets";
import type { FieldTargetIndex } from "./field-index";

/* ---------- 描画コンテキスト ---------- */

/** テスト実行をどこから行ったか。データの小窓へ移っても、要素とくり返しの文脈を保つ。 */
export interface FetchPreviewScope {
  nodeId: string;
  localNames: string[];
  /** 実際にブロックを持っているスクリプト。変数を参照する位置とは分ける。 */
  owner?: { scriptId: string; nodeId: string | null };
}

export interface EdCtx {
  doc: SiteDoc;
  pageId: string;
  /** ページの外でも、明示的に編集しているコンポーネントのルート。 */
  scriptRootIds?: string[];
  targets: Target[];
  /** 選択欄ごとにすべての行を調べず、ワークスペースごとに一度だけ作る索引。 */
  targetLookup?: {
    firstByAttr: ReadonlyMap<string, TreeRow>;
    firstNodeIds: ReadonlySet<string>;
  };
  /** 入力欄の種類と選択肢。条件ごとに計算し直さずに共有する。 */
  fieldLookup?: FieldTargetIndex;
  /** 要素の選択欄で表示する、ページの要素の階層 */
  tree: TreeRow[];
  /** ページのスクリプト（絞り込みの番号を選ぶときに使う） */
  scripts: PageScript[];
  /** ワークスペースが特に大きいときは、スクリプトのスタック全体のマウントを後回しにする。 */
  virtualizeStacks: boolean;
  /** 入力欄ごとにスクリプトを調べ直さず、文書ごとに一度だけ作る索引。 */
  variableIndex?: PageVariableIndex;
  /** 値の加工のブロックで共有する、元にする変数の候補。 */
  transformSources?: Record<string, unknown>;
  /** ページを開いたときのスクリプトと、事前描画で実行できる手順（一度だけ計算する）。 */
  pageLoadScriptIds: Set<string>;
  serverStepIds: Set<string>;
  /** きっかけにできる要素（ページ内のすべての要素） */
  elements: { id: string; label: string }[];
  /** 要素の設定から開いたときの要素 */
  focusNodeId: string | null;
  /** ドラッグ中の見た目など、操作できない描画 */
  readOnly: boolean;
  activeSlot: string | null;
  /** 選択中のブロック（"step:<ID>" / "script:<ID>"） */
  selected: Set<string>;
  /** スクリプトの重なり順（スクリプト ID → z-index。最後に選んだものほど手前） */
  zOrder: Map<string, number>;
  updateStep: (stepId: string, fn: (s: ScriptStep) => ScriptStep) => void;
  updateScript: (scriptId: string, patch: Partial<PageScript>) => void;
  /** 「このページ｜ページを開いたとき」の直下にあるか（データの読み込みが動く位置） */
  isPageLoadRoot: (loc: Loc) => boolean;
  /** 変数・配列・取得したデータの名前を変える（ページ内で使っている箇所も書き換える） */
  renameVar: (stepId: string, from: string, to: string) => void;
  /** 取得したデータを表で確認する小窓を開く */
  openPeek: (fetchStepId: string, scope: FetchPreviewScope) => void;
  /** ページの配列 */
  arrays: PageArray[];
  /** 見本で実行したときの変数の値（配列の中身を選ぶときに使う） */
  samples: Record<string, unknown>;
  /** 取得時に確認できたリストの要素数。 */
  listCounts?: Record<string, number>;
  beginSteps: (e: React.PointerEvent, loc: Loc, stepId: string) => void;
  beginScript: (e: React.PointerEvent, script: PageScript) => void;
  openMenu: (e: React.MouseEvent, target: MenuTarget, key: string) => void;
}

export const Ctx = createContext<EdCtx>(null!);

/** スクリプトがきっかけにしている要素（"" = ページ、または未選択）。変数の候補はその位置で表示する */
export const ScriptNodeCtx = createContext<string>("");
export const ScriptOwnerCtx = createContext<FetchPreviewScope["owner"]>(undefined);

/** 入力の候補から、このブロックがこれから作る出力だけを除くために使う。 */
export const ScriptStepCtx = createContext<string>("");

/** 囲んでいる「要素ごとにくり返す」（内側が先頭）。中の入力欄で、要素の項目を候補に表示する */
interface LoopInfo {
  array: string;
  fields: string[];
  /** 空のリストも含めて、参照できる項目名を並べる。 */
  roots?: string[];
  samples: Record<string, string>;
}
export const LoopCtx = createContext<LoopInfo[]>([]);
