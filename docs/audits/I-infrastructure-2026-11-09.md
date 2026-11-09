# Tsumu 総合監査 I：基盤・CI/CD・依存関係

- 監査日：2026-11-09
- 初期基準：1ba32974d4b5ecf441e36428e765d0542207c421
- 主担当：I（基盤・依存関係）
- 修正ブランチ：audit/I-infrastructure
- PR：#25
- 範囲：.github/、package.json、package-lock.json、Dockerfile、.dockerignore、next.config.mjs、open-next.config.ts、wrangler.jsonc、custom-worker.ts、scripts/、関連テストと運用文書
- 本報告は静的コード監査とGitHub設定照合の記録。実機Cloudflareデプロイ、コンテナ起動、独立レビューを行ったという意味ではない。

## 1. 発見事項と対策

| ID | 重要度 | 原因・影響 | 修正・回帰テスト |
|---|---|---|---|
| AUD-I-001 | Medium | CIがActionのバージョンタグを直接参照し、タグ移動により実行コードが変わり得る。checkoutの認証情報も作業領域に保持されていた。 | checkout・setup-node・upload-artifactを確認済みの40桁commit SHAへ固定し、すべてのcheckoutでpersist-credentialsを無効化。設定テストを追加。 |
| AUD-I-002 | Medium | 必須のcheckジョブにnpm監査とCloudflare Workerビルドがなく、依存関係・Worker専用の失敗を必須チェックにできなかった。 | 既存のcheckにWorker build・本番依存と全依存のhigh以上のnpm auditを統合。既存Rulesetの必須ジョブ名を維持。 |
| AUD-I-003 | Medium | Dockerビルドコンテキストにルートまたはサブディレクトリの.env、.npmrc、Preview生成設定等が入り得た。秘密情報や不要なファイル混入の原因となる。 | .dockerignoreに再帰パターンを含む除外項目を追加。 |
| AUD-I-004 | Medium | Cloudflareの本番デプロイ時にD1/KVが未設定でもバインディングを静かに削除し、ブラウザのみへの保存へ切り替えられた。 | 本番deployは不足IDで失敗する設計にし、TSUMU_ALLOW_BROWSER_ONLY_DEPLOY=trueが明示された場合だけ従来のブラウザ保存を許可。buildとPreviewは維持。異常系テストを追加。 |
| AUD-I-005 | Low | JSONCブロックコメントが閉じられず、末尾に付いた場合にパーサが残りを無視して有効な設定と扱う可能性があった。 | 未終端コメントを例外に変更し、失敗/成功の回帰テストを追加。 |
| AUD-I-006 | Low | エディタの共通HTTPレスポンスヘッダーにX-Content-Type-Optionsと明示的なReferrer-Policyがなかった。 | 全パスのnosniff、strict-origin-when-cross-originを追加。設定を読み込むテストを追加。 |
| AUD-I-007 | Medium | npmのallowScriptsで許可したworkerdのバージョンが、ロックファイルの実バージョンと異なっていた。 | 許可を固定済みworkerd 1.20261104.1に一致させ、ロック中のインストールスクリプト有無と許可表の整合をテスト。 |
| AUD-I-008 | Medium | DockerのNode.jsベースイメージが可変タグのみで、同じソースで異なるイメージを使う可能性があった。 | ビルド/ランタイム両段階を同一の検証済みマルチプラットフォームSHA256 index digestで固定。Digest・Nodeバージョン一致テストを追加。 |
| AUD-I-009 | Medium | 公開Worker Previewのpreviews.varsにトークン・シークレットらしい変数名を平文で設定しても拒否しなかった。 | 代表的な認証情報名を拒否し、Preview自身のシークレットで設定するよう促す。テストと日英文書を追加。 |
| AUD-I-010 | Low | DependabotがnpmとGitHub Actionsは監視する一方、Dockerベースイメージの更新を対象にしていなかった。 | 週次Docker更新を追加。 |
| AUD-I-011 | Medium | 本番デプロイ時に追加CLI引数で検証済みの--config/--envやデプロイ先を上書きでき、保存先チェックを迂回し得た。 | 設定・環境・Worker名などを変更する引数を拒否。カスタム設定はWRANGLER_CONFIGに統一し、拒否テストを追加。 |
| AUD-I-012 | Medium | DockerのNext.js配布ファイルがroot所有で、nodeユーザーからキャッシュ等の書込が失敗し得た。 | COPY --chown=node:nodeを両コピーに適用し、非rootファイル所有テストを追加。 |
| AUD-I-013 | Low | CIのnpxコマンドが、バイナリ不足時に意図しないパッケージ取得を実行し得た。 | Playwright/Next/OpenNext起動に--no-installを付け、意図しない外部取得を防止。 |
| AUD-I-014 | Medium | 本番deploy引数の拒否一覧がWranglerの--cwd、--env-file、--profile、--route、--assets等を許し、設定確認後の対象・環境・公開経路を変える余地が残っていた。 | 対象・環境・公開経路を上書きする追加オプションと引数区切り--を拒否。既存の--dry-runは保持し、拒否テストを拡充。 |

重要度は成立条件が設定ミスやサプライチェーンに依存することを考慮した暫定評価。Critical/Highが不存在であるとの判定ではない。

## 2. 依存関係監査表

| 項目 | 確認値 | 判定・留意点 |
|---|---|---|
| package-lockの形式 | lockfileVersion 3 | manifestの直接依存・開発依存の指定と一致 |
| 実行時直接依存 | 13件 | 利用・必要性を静的確認。生成ランタイムに流用するものもある |
| 開発直接依存 | 9件 | OpenNext、Wrangler、Playwright、TypeScriptなど |
| lockfile内パッケージ | 436件（ルートを除く。直接・間接を含む） | npm registry以外へのresolved URLは0件 |
| インストールスクリプト付き | esbuild 0.28.2、fsevents 2.3.3、workerd 1.20261104.1 | 全3件のallowScriptsをロックに合わせる回帰テスト |
| integrityがないエントリー | @typescript/typescript6 6.0.2とネストしたtypescript 6.0.3の2件 | R-I-001：レジストリ側とnpmのlockfile生成規則を調査し、正しいdigestで補完できるか確認が必要 |
| 旧い依存の警告 | node-domexceptionのdeprecated表示 | R-I-002：依存元を追跡し、上流更新で解消可能か検討 |
| 既知の脆弱性 | CIのnpm auditでhigh以上を検出対象化 | 初期ロックのnpm audit結果をこの報告だけで「0件」とは断定しない |
| バージョン | Node >=26.12.1、npm >=12.2.1 | .nvmrc、packageManager、CI、Dockerの整合性を確認 |

npmのallowScriptsはインストールスクリプト実行の許可設定であり、スクリプト自体の無害性を証明するものではない。npm registry上の提供物も改ざん・誤公開のリスクを完全にはなくせない。

## 3. CIカバレッジと必須チェック

| ジョブ・機構 | 検査対象 | 必須チェックとの関係 |
|---|---|---|
| check | npm ci、型検査、単体/統合テスト、i18n、Cloudflare Worker build、実行時と全依存のnpm audit | main Rulesetで必須 |
| e2e-shard (1〜4) | Playwright/Chromium。毎回テストを発見し、4分割。各シャードがNext.js buildを行う | main Rulesetで4件必須 |
| generated-formats（Next.js/React/Vue/Nuxt/SvelteKit） | TypeScriptとJavaScriptの生成・ビルド・npm audit。対象形式のSSRと代表的なブラウザ動作も確認 | main Rulesetで5件必須 |
| CodeQL | 別経路のコードスキャン（default setupと設定ファイル） | main RulesetのコードスキャンルールでHigh以上/Errorsを制限 |
| workflow_dispatch | 手動再検証 | 変更なしで必要時に再実行可能 |

mainのRuleset ID 26794696は、線形履歴、PR経由、指定10件の必須status checks、CodeQLのコードスキャン設定を有する。Rulesetは本PRで変更していない。PRの最終コミットに対して全チェックが成功したことを別途確認する必要がある。

CIジョブの増加を避けるため、依存関係監査とWorkerビルドを新しい非必須ジョブにせず、既存の必須checkへ統合した。pull_requestにはpathフィルターを設定していない。

## 4. デプロイ安全性チェック

| 項目 | 現状 |
|---|---|
| Node/Docker | DockerのNodeベースをdigest固定。productionプロセスはnodeユーザー。データは/dataへ保存する想定でボリュームを利用 |
| ビルドコンテキスト | ローカル設定、.env系、.npmrc、preview生成設定、DBファイル、エクスポート検証生成物を除外 |
| Cloudflare Workers | nodejs_compat、compatibility_date、D1/KV/Durable Object設定をレビュー。Worker buildを必須checkに追加 |
| Cloudflare本番保存 | 明示的なIDを要求。意図的なブラウザ保存構成だけ環境変数で許可 |
| Cloudflare Preview | D1/KVなしのPreviewを既定とし、本番資源IDの再利用検査を維持。平文変数の認証情報名を拒否 |
| HTTPヘッダー | X-Robots-Tagとエディタのframe-ancestorsに加え、nosniffとReferrer-Policyを確認 |
| 機密情報 | .env、.dev.vars、wrangler.local.jsoncなどはGit/Dockerから除外。ただし過去のGit履歴、Cloudflareダッシュボード設定、外部シークレット管理は別途検証が必要 |

## 5. 不要コード・互換処理の候補

- scripts/bench-asset-usage.mts：手動性能計測ツール。production/CIの必須経路ではなく、削除可否は利用実態を確認して判断する。
- scripts/screenshots.mts：READMEスクリーンショット生成専用。ドキュメント維持作業で利用する可能性があるため、単にCI未使用という理由で削除しない。
- scripts/sync-fetch-runtime.mts：本体と生成サイトの安全な通信コードを同期するための明示的なツール。安易に削除すると生成コードの追従性を失う。
- scripts/e2e-shard-durations.json：run-e2e-shard.mjsが参照しているため不要コードではない。
- カスタムWorkerのOpenNextハンドラー再エクスポート：将来のadapter連携を含むため、未使用と証明できない限り削除しない。

今回の静的調査だけで安全に削除可能と確定したファイルはない。エディタ/エクスポート内部の互換処理を一括削除することは、他担当の所有範囲であり実施していない。

## 6. 未検証事項・残存リスク

- R-I-001：上記2件のlockfile integrity欠如について、npm registryの配布メタデータと一致したdigestを入手して補完できるかの確認。
- R-I-002：deprecatedな間接依存の更新経路の追跡。
- R-I-003：Dockerの実ビルド、マルチアーキテクチャ起動、OSパッケージのCVE検査は未実施。digest固定は安全性そのものの保証ではない。
- R-I-004：Cloudflareの本番/Previewに実際に設定されたバインディング、シークレット、D1/KV権限やCPU制限はソースからは完全に検証できない。機密情報を本番に読み込ませる破壊的試験はしない。
- R-I-005：CodeQL結果、CIのnpm audit、Worker buildおよび全E2Eについて、最終コミットの結果確認と独立レビューが必要。
- R-I-006：CIのブラウザ検証はChromium中心。Firefox/WebKitの横断動作、本番WorkersでのWebSocket共同編集、NextとWorkersの実行差は別途必要。
- R-I-007：生成プロジェクトのバージョン指定と実行時脆弱性は担当Fと突合。CIのgenerated-formatsは代表的な組み合わせのみであり全設定の網羅ではない。

## 7. 検証の実行指示

```bash
npm ci
npm run typecheck
npm test
npm run i18n:check
npm run build
npm run build:worker
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
npm run test:e2e
docker build -t tsumu-audit-i .
```

各検査が最終HEADに対して成功し、独立レビューを経たときにのみ完了とする。現段階でそれらすべての成功は宣言しない。

## 8. 引き継ぎ後の検証記録（2026-11-09）

- 旧HEAD `3d02386cbc4640ca269d33e0915dc782c105352a` はCI 10/10ジョブ、CodeQLのJavaScript/TypeScript・Actions、Cloudflare Workers BuildsのGitHubチェックが成功。Cloudflareのチェックは実際のデプロイ・本番バインディングの検証を意味しない。追加修正後のHEADはCI再確認が必要。
- Cloudflare公式資料によると、Wrangler CLIのグローバル引数には`--cwd`、`--env-file`、`--profile`、デプロイ引数には`--route`、`--assets`等が存在する。OpenNext CLIはWrangler引数も受け付ける。対象を上書きし得る引数を追加拒否した（AUD-I-014）。出典: https://developers.cloudflare.com/workers/wrangler/commands/workers/ 、https://opennext.js.org/cloudflare/cli 。
- Docker Hubの`node:26.12.1-slim`（index digest `sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec`）にはスキャナ上High判定のOS/npmパッケージ脆弱性が残る。Dockerイメージの固定は脆弱性解消を意味しない。実際のTsumuへの到達可能性と修正可能なOSパッケージの検証はR-I-003として継続。https://hub.docker.com/layers/library/node/26.12.1-slim/images/sha256-80eccfd7e3fa8663c84881efb6b28c7411672a337aec1769f0fb9e3adc4a4d8b
