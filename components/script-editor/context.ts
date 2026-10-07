/**
 * スクリプトの画面の部品が共有する文脈（編集中のページ・スクリプト・要素、くり返しの中か）
 */

import { createContext } from "react";
import { type PageScript } from "../../lib/script";
import { type PageArray, type PageVariableIndex } from "../../lib/data";
import { type ScriptStep, type SiteDoc } from "../../lib/types";
import { type Target, type TreeRow } from "./targets";
import type { FieldTargetIndex } from "./field-index";

/** テスト実行をどこから行ったか。データの小窓へ移っても、要素とくり返しの文脈を保つ。 */
export interface FetchPreviewScope {
  nodeId: string;
  localNames: string[];
  /** 実際に動作を持っているスクリプト。変数を参照する位置とは分ける。 */
  owner?: { scriptId: string; nodeId: string };
}

export interface EdCtx {
  doc: SiteDoc;
  pageId: string;
  /** ページの外でも、明示的に編集しているコンポーネントのルート。 */
  scriptRootIds: string[];
  targets: Target[];
  /** 選択欄ごとにすべての行を調べず、画面ごとに一度だけ作る索引。 */
  targetLookup: {
    firstByAttr: ReadonlyMap<string, TreeRow>;
    firstNodeIds: ReadonlySet<string>;
  };
  /** 入力欄の種類と選択肢。条件ごとに計算し直さずに共有する。 */
  fieldLookup: FieldTargetIndex;
  /** 要素の選択欄で表示する、ページの要素の階層 */
  tree: TreeRow[];
  /** ページのスクリプト（絞り込みの番号を選ぶときに使う） */
  scripts: PageScript[];
  /** 入力欄ごとにスクリプトを調べ直さず、文書ごとに一度だけ作る索引。 */
  variableIndex: PageVariableIndex;
  /** 値の加工で共有する、元にする変数の候補。 */
  transformSources: Record<string, unknown>;
  /** ページを開いたときのスクリプトと、事前描画で実行できる動作（一度だけ計算する）。 */
  pageLoadScriptIds: Set<string>;
  serverStepIds: Set<string>;
  updateStep: (stepId: string, fn: (s: ScriptStep) => ScriptStep) => void;
  /** 変数・リスト・取得したデータの名前を変える（ページ内で使っている箇所も書き換える） */
  renameVar: (stepId: string, from: string, to: string) => void;
  /** 取得したデータを表で確認する小窓を開く */
  openPeek: (fetchStepId: string, scope: FetchPreviewScope) => void;
  /** ページのリスト */
  arrays: PageArray[];
  /** 見本で実行したときの変数の値（リストの中身を選ぶときに使う） */
  samples: Record<string, unknown>;
  /** 取得時に確認できたリストの項目数。 */
  listCounts: Record<string, number>;
}

export const Ctx = createContext<EdCtx>(null!);

/** スクリプトがきっかけにしている要素（"" = ページ）。変数の候補はその位置で表示する */
export const ScriptNodeCtx = createContext<string>("");
export const ScriptOwnerCtx = createContext<FetchPreviewScope["owner"]>(undefined);

/** 入力の候補から、この動作がこれから作る出力だけを除くために使う。 */
export const ScriptStepCtx = createContext<string>("");

/** 囲んでいる「項目ごとにくり返す」（内側が先頭）。中の入力欄で、項目の名前を候補に表示する */
export interface LoopInfo {
  array: string;
  fields: string[];
  /** 空のリストも含めて、参照できる項目名を並べる。 */
  roots?: string[];
  samples: Record<string, string>;
}
export const LoopCtx = createContext<LoopInfo[]>([]);
