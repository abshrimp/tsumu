# リポジトリ全体の品質改善計画

作成日: 2026-11-11（日本時間）
開始点: `c57335997034275f3d639f567ea4809246bac3d7`（main）
対象: 開始点の Git 管理対象 930 ファイル。既存 PR の処理は本計画に含めない。

## 目的と進め方

バグ修正、脆弱性修正、保守性改善、動作の軽量化を、領域ごとの証拠と検証結果を残しながら進める。最初に全ファイルを棚卸しし、以下の計画を記録してから製品コードを変更する。

全ファイルが調査範囲に入っていることと、全行の精査・全動作の検証が済んだことは区別する。各ファイルの所属は隣接する `repository-quality-inventory-2026-11-11.tsv` に記録する。実査した経路、実行した検証、残課題は本書の実施記録に追記する。調査中に追加したファイルも記録する。

変更は再現できた問題を単位とし、関連する回帰テストを先に失敗させてから修正する。性能は同じ入力で処理件数・時間・資源解放を比較し、測れていない体感改善率は記載しない。挙動を変えない整理は問題の修正に必要な範囲で行う。移行用・旧形式互換の分岐は追加しない。

## 全体の調査範囲

| ID | 領域・主なファイル | 調査項目 | 完了の根拠 |
| --- | --- | --- | --- |
| Q1 | `auth.ts`、`middleware.ts`、API、認証・CSRF・URL・外部通信・GitHub・アセット関連 lib | 認可漏れ、ログイン方式変更、CSRF、SSRF、XSS、パス逸脱、応答/入力上限、失敗時の後処理 | 入力から保存/外部通信までの経路確認、境界値・拒否ケースの回帰テスト |
| Q2 | `document-room.ts`、`custom-worker.ts`、store、保存・同期・サイト・コメント・DB関連 lib | 保存順序、競合、失敗後の復旧、削除復活、Undo、WebSocket/SSE解放、全体走査や重複保存 | 単体・統合テスト、競合/破損/切断の再現、処理量確認 |
| Q3 | `components/`、画面ルート、CSS、編集・選択・ドラッグ関連 lib | キャンバス/スクリプト/パネルの操作、キーボード、階層選択、再描画、購読範囲、非同期キャンセル、仮想化 | 操作に対応した回帰テスト、対象E2E、必要に応じブラウザ計測 |
| Q4 | import/export、`lib/generator/`、ZIP・HTML・CSS・SVG解析、公開/復元 | 不正文書/ZIP、資産参照、解析の停止性、出力形式間の差、生成先安全性、復元と公開の整合 | 悪性/境界入力、往復変換、生成コード検証、各形式ビルド |
| Q5 | `lib/script-runtime.ts`、script-model、値/変数/data/style/motion等の共通モデル | 型・条件式・リスト・スコープ、循環/深い入力、イベント/タイマー解放、プレビューと出力の一致 | ランタイムの振る舞いテスト、既存テスト照合、計算量確認 |
| Q6 | AI API/UI、`lib/ai/`、`lib/aiOps.ts` | 操作の検証、キャンセル、ストリーム上限、編集競合、不要な旧互換経路 | 不正操作/中断/競合テスト、APIとクライアントの整合確認 |
| Q7 | `.github/`、scripts、設定、Docker、依存関係、tests/e2e/benchmarks | 再現可能なビルド、依存脆弱性、CIの実効性、権限、テストの不足/重複、環境差 | 型・全単体・i18n・ビルド・audit・必要なE2E/生成形式CI |
| Q8 | README/ARCHITECTURE/SECURITY/CONTRIBUTING、docs、skills、画像・fixture | 仕様と実装の不一致、手順、生成物や参照型の同期 | 実装との照合、同期テスト、画像/fixtureは用途と参照確認 |

APIが複数領域にまたがる場合も、認可から呼び出し先まで確認する。tests/e2eの管理担当はQ7とし、実行結果・対応する回帰は各領域にも記録する。画像など実行されない資源にはコード監査と同じ完了基準を適用しない。

## 優先順位と工程

1. **P0 基準点・計画**: 最新mainと開いているPRを確認し、管理対象を一覧化。Node/npm、依存関係、実行可能なブラウザ等を確認する。計画を先にコミットする。
2. **P1 高リスク経路**: 認証・外部入力・保存/削除・公開を優先する。再現するデータ損失や権限越境があれば他の改善より先に直す。
3. **P2 全領域の調査と修正**: Q1〜Q8を並行調査し、問題の原因・影響・テストを記録して修正。調査で問題が見つからなかった領域も、確認した範囲を明記する。
4. **P3 性能・整理**: キャンセルされない通信、無駄な走査、再描画、メモリ保持など再現した無駄を除く。過剰な抽象化や一括整形は行わない。
5. **P4 統合検証**: 変更の独立レビュー、型チェック、全単体、i18n、ビルド、対象E2Eを実行。CIでは全E2E、Worker/Docker、生成形式も確認する。
6. **P5 提出・記録**: 修正をPRとして提出し、CI失敗は原因を確認して修正する。計画には修正済み・検証済み・環境制約・継続調査を分けて記録する。

## 検証ルール

- 基準点と変更後を区別する。失敗を既存問題と判断するときは基準点でも再現する。
- 各修正に対し、実際の入出力/状態変化を検証する。実装文字列だけを確認するテストは、生成ソース同期など用途が明確な場合に限る。
- 必須: `npm run typecheck`、`npm test`、`npm run i18n:check`、`npm run build`。
- セキュリティ/依存: `npm audit --omit=dev --audit-level=high` と `npm audit --audit-level=high`。外部情報を確認できないときは未検証とする。
- 画面変更: 関連するPlaywrightケース。共通基盤の変更はCIの全ブラウザ/全shardで確認。
- 生成処理変更: 関連単体と出力形式のビルド/SSR/ブラウザ検証。`safe-fetch`を変更した場合は同期スクリプトで生成元を更新。
- Cloudflare/Dockerやブラウザがローカルで利用できない場合、成功扱いにせずCIの結果で補う。既存本番データを検証用に変更しない。
- 各領域の調査範囲・発見事項・未検証項目を残す。「脆弱性ゼロ」「全バグ解消」「最適化完了」とは保証しない。

## 開始時の状況

- main: `c573359`。開始時に未マージPRなし。
- 内訳: app 29、components 80、lib 179、tests 437、e2e 124、docs 22、scripts 13、benchmarks 6、skills 5、.github 8、ルート27。
- CI: check、4分割E2E、5種類の生成フレームワーク検証。別途Tailwind生成検証。
- 初期の実行環境はNode 24/npm 11。プロジェクト指定のNode 26.12.1/npm 12.2.1を準備してから検証する。
- 初期計画は製品コード変更前にコミット済み。以下はその計画に沿った実施記録。

## 実施記録

### 調査範囲と結果

| 領域 | 実査した主要経路 | 結果 |
| --- | --- | --- |
| Q1 | auth/server/allowlist/CSRF、全APIの認可、アセット配信・署名・削除、safe-fetch、GitHub公開、backups | 保存・状態取得の重複認証を削減。今回の確認範囲では新規の認証回避・SSRFは実証されなかった |
| Q2 | store/merge、cloud/local/browser保存、doc-patch、両保存backend、DocumentRoom/Worker、Editor同期、SSE | 同時編集・Undoの資産参照欠損と、SSEの無制限バッファを修正 |
| Q3 | Canvas描画・データ取得・HTMLプレビュー、ScriptEditor選択/drag/keyboard/仮想化、Layers、共通controls、resize、image-drop | ページ間の値混入、古い通信の残存、不正URLによる例外を修正 |
| Q4 | SiteDoc/ZIP/HTMLインポート、展開制限、SVG、部分出力、資産依存、単一HTML、各framework、CSS/JS変換、出力パス | 重複名の二乗時間処理と長すぎるcomponent出力名を修正 |
| Q5 | script-runtime、vars/data、値の意味・recipe・page-load、生成側の変数処理 | 深いJSON配列の文字列化によるスタックオーバーフローを修正。共通処理を生成先にも埋め込む |
| Q6 | lib/ai全体、AI API、aiOps、AiChat/AiActivity、キャンセル・stream・検証・競合 | 現クライアントが使わない旧JSON成功応答を削除。provider側の対応形式は維持 |
| Q7 | workflows、Docker、Cloudflare/config、scripts/audit、依存lock、tests/e2e構成 | ~ALL rulesetを落として必須CIを誤判定する問題を修正。依存監査は0件 |
| Q8 | README/architecture/security/contributing/releasing、同梱site仕様・参照型、文書とfixtureの参照 | 計画・全ファイル台帳・測定ハーネス/結果を追加。生成元/同梱参照の整合は既存テストで検証 |

上表は経路を追った調査範囲であり、930ファイルの全行を個別精査したという意味ではない。画像・大きな翻訳辞書・既存fixtureは用途/参照と既存検証を対象とし、全画面の目視確認は実施していない。

### 確認した問題と変更

| ID | 再現と変更 | 回帰検証 |
| --- | --- | --- |
| F1 | 未使用画像の削除と別利用者の使用開始が重なると、3つの入力文書は有効なのにmerge結果だけが無効。残る参照に必要な資産を復元し、古いUndo履歴も通常mergeへ戻す | `merge-asset-deletion.test.mts`。両方向・画像/media/設定/CSS/HTML/ZIP依存・不要資産削除・履歴不変 |
| F2 | Node側SSEで認可待ちと未読通知が無制限に滞留。待機32件、待機+stream合計64 MiB（UTF-8）を上限とし、超過時は購読/queueを解放して再接続させる | `collab-stream-backpressure.test.mts`。停滞・Unicode byte数・順序・cancel/abort。既存の再接続同期を確認 |
| F3 | ページ切替の最初のfetchに前ページのフォーム値が混入。ページID付き状態に変更し、初回から移動先の値を使う | `preview-refresh.test.mts`、`e2e/preview-refresh.spec.ts` |
| F4 | 更新/ページ移動/preview終了後も古いfetchを処理。不必要なブラウザ通信をAbortControllerで止め、不要JSON解析を回避 | 同上。6件の新規回帰が修正前に失敗、修正後成功。サーバー側外部fetchの即時停止は保証しない |
| F5 | 不正なパーセントエスケープの動的URLでURIError。既存404経路へ進める | `preview-query-navigation.test.mts` |
| F6 | 同名の要素/資産/component採番が毎回2から探索する二乗時間処理。共通の次番号管理へ置換 | `generator-name-allocation.test.mts`。予約語/大文字小文字/既存連番/25,000件、修正前との混合入力照合 |
| F7 | 長いcomponent名から255バイト超のfilenameを作り、出力全体が失敗。生成識別子を120 ASCII文字までに制限 | `component-output-name-portability.test.mts`。Next.js/Reactのファイル名とimport整合 |
| F8 | 保存/状態取得がauthを2回実行し、認可時と保存者情報も食い違い得る。認可結果の利用者情報をそのまま使用 | `api-author-identity.test.mts`。PUT/PATCH/status、署名済み/匿名/拒否、認証回数2→1 |
| F9 | activeな~ALL rulesetの必須checkを落とし、CI成功を誤報。~ALLを含め、不明なwildcardは未確認にする | `audit-merge-gates.test.mts` |
| F10 | AI APIに旧クライアント向けJSON成功応答が残存。現行NDJSON契約へ統一 | `api-json-endpoints.test.mts`、AI suite。Accept有無・progress・失敗・中断 |
| F11 | 約40KB・20,000段の有効JSON配列を表示/比較すると再帰がoverflow。共通の反復処理へ置換し、循環・展開量も制限 | `value-text-depth.test.mts`。editor/生成vars/native/DOM runtimeの整合、共有部分木・循環 |

### 性能測定

`benchmarks/generator-names.mts` を、同じNode 26.12.1・Linux x64環境で変更前後に順番に実行した。warmup 1回、測定5回の中央値。計測中は全テストとビルドを停止していた。

| 同名要素数 | 変更前 | 変更後 |
| ---: | ---: | ---: |
| 1,000 | 70.974 ms | 3.502 ms |
| 5,000 | 1,486.985 ms | 5.584 ms |
| 10,000 | 7,067.562 ms | 15.214 ms |

対象はclass名の割当だけ。エディタ全体・全書き出し・同時編集の体感速度を表す値ではない。生データ・環境・制限は `benchmarks/generator-names-results.md` に記録。

### 統合検証

- Node 26.12.1 / npm 12.2.1、lockfileから `npm ci --ignore-scripts`。esbuild実行を確認。
- 基準点: 単体3,826成功、失敗0、Docker opt-in 1件skip。typecheck・i18n成功。
- 最終の全単体: 3,876成功、失敗0、Docker opt-in 1件skip（計3,877件）。生成コードの型指定漏れ2件を統合テストで検出して修正後、全件を再実行した。
- 最終 `npm run build:worker` 成功（内部のNext.js production build・TypeScript検証を含む）。明示的なtypecheck・i18nも成功。
- browser-projectsチェック成功。Playwrightの列挙は889ケース/118ファイルで成功（実行成功とは区別）。
- ファイル台帳は追加10ファイルを含む940管理対象と完全一致、重複/漏れなし。
- `npm audit --json` と `npm audit --omit=dev --audit-level=high`: production/devを含め既知脆弱性0件。
- 独立レビュー: merge/Canvas/SSE/認証/AI/gate、名前割当と出力互換、深い配列の共通変換を別担当が確認。重大な回帰の指摘なし。
- ローカルPlaywright: 必要なChromiumのdownloadが不正/欠損ZIPで失敗。ブラウザE2Eは実行済みとしない。最終CIで確認する。

### 継続確認・限界

- 全E2E、生成5形式のビルド/SSR/browser、DockerはPRのCI結果を確認する。Worker buildはローカル成功。本環境にDockerはないため、そのopt-in検証は未実行。
- 4,000ブロックの既存ブラウザ性能計測、実際の複数端末での同時編集p95/heapは未計測。今回の測定で代替しない。
- AI操作ごとの全SiteDocコピーは候補として確認したが、transaction/rollback保証に関わるため今回変更していない。計測と独立した設計検討が必要。
- 全範囲を棚卸し・経路調査したうえで確認できた問題を修正したもの。未知の不具合や脆弱性が残らないことは保証しない。
