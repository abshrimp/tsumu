# C：スクリプトエディタ・実行エンジン監査

- 対象リポジトリ：`abshrimp/tsumu`
- 初期基準SHA：`1ba32974d4b5ecf441e36428e765d0542207c421`
- 作業ブランチ：`audit/C-script`
- 統合PR：[#23](https://github.com/abshrimp/tsumu/pull/23)
- 監査状態：**11件の修正・回帰テストを提出済み。最終CI・独立レビュー未判定。**

## 1. コード経路と担当境界

- UIと操作：`components/ScriptEditor.tsx`、`components/script-editor/`
- 表現・コンパイル：`lib/script.ts`、`lib/script-model/compose.ts`
- プレビュー／公開サイトの共通ランタイム：`lib/script-runtime.ts`
- 値の加工：`lib/script-model/recipe-runtime.ts`
- 条件比較・JSON値と代入：`lib/value-semantics.ts`
- 変数補間：`lib/vars.ts`
- 参照確認のみ：`lib/data.ts`、`lib/page-load-steps.ts`、`lib/generator/`、`lib/fetch-request.ts`

公開サイトの `scripts.js` は `SCRIPT_RUNTIME` を機能ごとに絞り込んで生成する。またページデータ取得と更新は `PAGE_DATA_RUNTIME` を共有し、これにも共通 `setVarPath` を埋め込む。そのため、実行エンジンの変更はプレビュー版と生成版の両方を対象にテストする。APIのSSRF防御、認証、保存方式、インポート、CI設定の変更は他担当の所有領域とし、このPRでは編集しない。

## 2. ブロック・テスト対応表（C-1〜C-5）

下表は**実装の経路とテストの対応**を示す。記載した既存テストの存在だけをもって、全異常系の検証完了とはみなさない。

| ブロック・きっかけ | 主要な検証観点 | 対応するテスト・確認先 |
| --- | --- | --- |
| クリック、値の変更 | バブリング、自己再発火、要素の破棄 | `script-runtime-reentrancy`、`script-input-value`、`script-cancellation` |
| ページを開いたとき | サーバー実行とクライアント実行の分割、再遷移 | `script-block-composition`、`script-data-export`、`script-cancellation` |
| ホバー開始・終了、表示要素上の継続 | 親子の境界、keep、タイマー解除 | `script-hover-cancellation`（ページ遷移中の停止）、`SCRIPT_RUNTIME` の `onOver/onOut`（境界の実ブラウザ検証が必要） |
| 画面に入ったとき | 交差観測、再描画、dispose | `SCRIPT_RUNTIME` の `IntersectionObserver`（ブラウザ試験は要追加） |
| 表示・非表示・切替、状態変更 | 非表示からの復元、状態名の検証 | `script-runtime-budget`、`value-transform-blocks.spec.ts` |
| ページ・URLを開く、スクロール | URL解決、ページID、対象要素不在 | `generator-script-query`、`script-navigation.spec.ts`（スクロールの独立試験は要追加） |
| 入力値の変更、有効・無効 | 実際に受理された値、radio/select/file、再帰 | `script-input-value`、`script-select-value`、`script-file-value`、`script-runtime-reentrancy` |
| 変数への代入、空リスト生成 | 文字列とJSON、未定義値、特殊キー、参照、壊れた代入先 | `script-block-composition`、`value-list-unification`、`script-nonfinite-values`、`script-malformed-runtime` |
| 値の加工（11種類） | 型・null・欠損、正規表現、制限、入れ子 | `value-recipe-ops`、`value-list-unification` |
| リストへの要素代入 | 連続添字、キー、型保持、元配列不変 | `value-list-unification`、`script-var-path-bounds` |
| リストの絞り込み・並べ替え・解除 | AND/OR、短絡、安定ソート、SSR一致 | `script-block-composition`、`filter-controls-preservation`、`script-conditions-shortcircuit` |
| 条件分岐、かつ／または | 優先順位、短絡、null・型不一致 | `script-block-composition`、`value-list-unification`、`script-runtime-budget` |
| 回数指定／無限の繰り返し、各要素で繰り返し、ループ終了 | スコープ・break・ネスト・実行量 | `value-list-unification`、`script-cancellation`、`script-runtime-budget` |
| 待機 | 変数による秒数指定、ページ移動、キャンセル | `script-cancellation`、`script-runtime-budget` |
| ストレージ保存・読込 | 型保持、容量超過、フォールバック | `script-storage-safety` |
| クリップボードコピー | 補間、許可拒否、フォールバック | `SCRIPT_RUNTIME` の `copy`（独立した拒否試験は要追加） |
| JSON取得（ページロード） | 初回取得・再取得、URL、SSRへの受け渡し | `fetch-preview`、`fetch-refetch`、`script-data-export`。通信の信頼境界は担当H |

### 値の加工11種類の照合

`field`、`fallback`、`math`、`split`、`replace`、`join`、`length`、`sort`、`append`、`stringify`、`parse` を `VALUE_TRANSFORM_KINDS`・`evaluateValueRecipe`・既存の `value-recipe-ops` と照合。プレビュー／SSR／生成コードは同一の純粋関数を利用する。入力例：欠損、null、真偽値、数値、文字列、辞書、配列、入れ子、特殊キー、不正正規表現、出力拡大。

## 3. 発見事項・修正

| ID | 重要度 | 再現・根本原因 | 修正・回帰テスト |
| --- | --- | --- | --- |
| AUD-C-001 | High（可用性） | 入れ子の `if` と有限多重ループに実行深度／ステップ総量の上限がなく、ページ表示・ユーザー操作が停止し得る | `script-runtime.ts`：ネスト上限16、1回の同期実行につき2万ステップ、待機で予算リセット。プレビューと生成サイトを `script-runtime-budget.test.mts` で検証 |
| AUD-C-002 | Medium | `wait` 中のタイマーがページ遷移／dispose後も解放されず、長い待機が不要なクロージャを保持する | 実行インスタンスごとのタイマー管理と即時中断。`script-cancellation.test.mts` |
| AUD-C-003 | Medium（データ消失） | 自分自身の子スロットへステップをドロップすると、元ステップを取り除いた後の挿入失敗をコミットし、ブロックが消える | `useScriptDrag.ts`：挿入先がない場合は元データをコミットしない。`script-drag-lifecycle.test.mts` |
| AUD-C-004 | Medium（可用性） | 値変更スクリプト内の複数 `set-value` が同期的に同一changeイベントを再発火し、無限再帰する | 要素・イベント単位の同期再入防止。`script-runtime-reentrancy.test.mts` |
| AUD-C-005 | Medium（データ整合性） | 非有限数やJSON非対応値を変数に入れられ、比較やJSON直列化で不整合になる | 比較と変数値の検証を強化。`script-nonfinite-values.test.mts` |
| AUD-C-006 | Low〜Medium（性能・整合性） | ブラウザ側リスト絞り込みがOR成立後やAND不成立後も、同一・別ブロックの不要な条件を評価していた | プレビュー／公開スクリプト／生成ページデータをSSRと同じ短絡評価に統一。`script-conditions-shortcircuit.test.mts` |
| AUD-C-007 | Medium（データ整合性・可用性） | `setVarPath` が飛び番添字や配列の文字列キーを受け入れ、疎な巨大配列や別のデータ型に変化させる | 既存添字の更新または末尾への追加だけ許可し、不正な書込は原子的に拒否。`script-var-path-bounds.test.mts` |
| AUD-C-008 | Medium（画面遷移・状態破壊） | hover-end遅延コールバックが元の要素をページ遷移で失っても発火し、新ページの要素を操作できる | 遷移時にhoverタイマーを破棄し、実行前に要素の接続とページ世代を再確認。`script-hover-cancellation.test.mts` |
| AUD-C-009 | Medium（堅牢性） | 不正な `data-scripts` JSON、欠損した条件・加工、非文字列の代入先がイベント処理を例外で終了させる | 非配列・不正エントリ・無効なブロックを除外し、正常な後続処理を維持。`script-malformed-runtime.test.mts` |
| AUD-C-010 | Medium（生成コードとの不一致） | 公開サイト用のページデータfetchが独立実装の変数書込を持ち、リストの `length` 等の非数値キーを受け付けて項目付きデータへ変換していた | `lib/generator/browser-data.ts` の重複実装を撤去して共通 `setVarPath` を埋め込み、プレビュー・SSR・ブラウザで不正パスの挙動を統一。`generated-page-data-array-write.test.mts` |
| AUD-C-011 | Low（不要コード） | スクリプトランタイムに使われない旧式の文字列比較 `cmp` が残り、現在の共通型付き判定と意味が異なっていた | 到達不能な比較関数を削除。`script-conditions-shortcircuit.test.mts` で不在を検証 |

実行量上限は悪意あるデータによるブラウザ停止の回避策であり、**意図的な長時間処理が上限で停止し得る仕様上の制約**が残る。明示的な待機または無限ループのインターバルで実行予算は更新される。

## 4. テスト・CIの確認状態

追加・拡張した回帰テスト：
- `tests/script-runtime-budget.test.mts`
- `tests/generated-page-data-array-write.test.mts`（Cの配列パス変更に合わせ、browser/native生成コードの契約を統一）
- `tests/script-malformed-runtime.test.mts`
- `tests/script-cancellation.test.mts`
- `tests/script-drag-lifecycle.test.mts`
- `tests/script-runtime-reentrancy.test.mts`
- `tests/script-nonfinite-values.test.mts`
- `tests/script-conditions-shortcircuit.test.mts`
- `tests/script-var-path-bounds.test.mts`

各テストは不具合が発生した状態を前提に設計し、修正後の挙動を検証する。GitHub Actionsの最終結果、個別E2E、生成形式別ビルド、CodeQLは**最終HEADの結果が出るまで未完了**とする。ローカル全テスト成功や全バグ解消を宣言しない。

## 5. 残存リスク・統合先の確認事項

1. ホバー、IntersectionObserver、スクロール、クリップボード拒否は専用ブラウザ試験が不足している。CIの通過とは区別する。
2. API取得の中断、SSRF・時間制限はH、公開生成プロジェクト全形式の独立ビルド・ブラウザセキュリティはFと照合する。
3. C修正による共有ヘルパーの契約変更（`setVarPath` の疎配列拒否）はB、生成コードの動作はFと統合レビューする。
4. 修正後の最終HEADについて、独立レビュー・CodeQL・回帰E2Eを別途確認する。未修正脆弱性をゼロとみなさない。
