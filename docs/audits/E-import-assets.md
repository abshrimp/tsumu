# 工程E：インポート・アセット監査記録

- リポジトリ：`abshrimp/tsumu`
- 監査計画：総合監査計画 E-1〜E-5
- 計画上の初期基準：`1ba32974d4b5ecf441e36428e765d0542207c421`
- 引き継ぎ時の `main`：`4cd04c23137e11afce7d7c43f0e06a52815de38e`（先行修正PR #19を含む）
- 工程Eブランチ／PR：`audit/E-import` ／ #26（Draft。M/Jの独立検証前にマージしない）
- 作業対象：`lib/site-import*.ts`、`lib/import-site-file.ts`、`lib/html-*.ts`、`lib/zip-*.ts`、`lib/css-assets.ts`、`lib/assets.ts`、関連テスト

## 既に統合済みの前提（PR #19）

- ZIPの構造・CRC・サイズとCSS/JSのSRIを検証する。
- インラインCSSの `</style>` からのHTML脱出を防ぐ。
- アセットURLを新規の保存先に付け替える。署名・古い保存先への参照を持ち越さない。
- サイトの初回リビジョンと登録を原子的に行い、ロストレスポンスを照合する。
- ローカル保存の複数タブによるサイト一覧更新競合を低減する。

これらは既存の修正として扱い、工程Eで同一コードを再実装しない。

## 発見事項と修正

| ID | 重要度 | 原因と影響 | 修正・回帰テスト |
| --- | --- | --- | --- |
| AUD-E-001 | Medium | ZIP内のUnicode正規化・大小文字による異名同一パスを、編集データ形式でも扱えていなかった | `lib/site-import.ts`、`tests/import-zip-canonical-paths.test.mts` |
| AUD-E-002 | Medium | HTML ZIPの `imagesrcset` 内のアセット参照が変換されなかった | `lib/html-zip.ts`、`e2e/zip-srcset.spec.ts` |
| AUD-E-003 | Medium | CSS `@import` の `layer` 指定をメディア条件と誤解し無効なCSSを生成した | `lib/html-css-import.ts`、`tests/html-css-import.test.mts` |
| AUD-E-004 | Medium | SiteDoc内の要素属性とページスタイルの型検査が一部不足していた | `lib/site-import-format.ts`、`tests/import-doc-shapes.test.mts` |
| AUD-E-005 | Medium | HTML・JSON由来の能動的なインラインSVGがアイコンへ残ることがあった | `lib/imported-svg.ts`、`lib/site-import.ts`、`e2e/site-file-import.spec.ts`、`e2e/html-to-site-import.spec.ts` |
| AUD-E-006 | Medium | HTMLリンク・画像のURL判定は当初、`javascript:` の単純な先頭一致だけであり、ブラウザが制御文字を取り除くと解釈が変わる入力等に対応していなかった | 既存の `safeNavigationUrl` / `safeResourceUrl` を `lib/html-to-site.ts` の取り込み時にも適用。`e2e/html-to-site-import.spec.ts` に拒否・正常系を追加 |
| AUD-E-007 | Medium | 通常のブラウザインポートはSVGをサニタイズする一方、サーバーのサイト初回作成APIは `validateImportedDoc` のみで、未処理アイコンを直接送信できる設計だった | `lib/imported-svg.ts` にDOM非依存の検査と無害化を追加。`lib/site-import-format.ts` で直接サーバーに届く不安全SVGを拒否。`tests/import-doc-shapes.test.mts` に回帰テストを追加 |

### CIの不整合の修正

前のPR HEADで全2,179件の単体試験のうち2件が失敗した。

1. 原子的インポートのテストが、現行検証ルールに適合しない欠損ページメタデータの旧フィクスチャを使っていた。`tests/site-copy-concurrency.test.mts` を正常な `createInitialDoc()` に改め、厳格な検証自体は緩めなかった。
2. SVG無害化が `window` 必須で、Node.jsから復元関数を利用した際に例外になった。DOM非依存で危険なタグ／属性／外部参照を除去する経路を追加した。

## E-1〜E-5検証表

| 要件 | 静的監査・テストで確認した経路 | 未実施・独立確認が必要な経路 |
| --- | --- | --- |
| E-1 JSON / SiteDoc | UTF-8、最大サイズ、木構造・ID・型・アセット対応表、プロトタイプ汚染防止、直接API経由のSVG拒否 | すべてのスクリプトステップの厳密な形状・参照整合性の検証は工程Cと調整 |
| E-2 HTML/CSS/JS | DOMParser、危険URL、SVG、style要素の終了タグ、アセットURL・srcset、CSS `@import`、外部リソースの整合性 | 全ブラウザ、すべてのCSS構文、外部JSの実行時意味保存、SRI再エクスポート後の全組合せ |
| E-3 ZIP | 中央ディレクトリ・重複・パス逸脱・Unicode衝突・展開制限・CRC | 大量の実ファイル由来コーパス、複雑なZIP64パターンの独立ファズ |
| E-4 アセット | ファイルごとの容量、失敗時の参照修復、CSS／srcset参照、SVGアイコン、署名付きURLの既存テスト | 実D1/KVの転送中断、全MIME実体偽装、動画・音声・フォントと実オリジンでの配信 |
| E-5 往復 | 編集データZIP／HTML ZIP、ローカル・サーバー作成、アセット参照、出力の一部E2E | `取込→編集→保存→再読込→プレビュー→全形式出力→再取込` 全経路の厳密な同値試験 |

テストが存在することと、すべてのプラットフォームでの安全性が確認済みであることは同義ではない。

## 確認・マージゲート

- `npm run typecheck`、`npm test`、`npm run i18n:check`、生成形式テスト、E2E 4分割、Workersビルド、CodeQLを**最終HEAD**で確認する。
- 高リスクの悪意あるファイルは本番環境ではなく、隔離テストとモックで扱う。
- 他領域との共有修正が発生したらMに連絡し、同じファイルへの無秩序なpushをしない。
- Jによる独立検証、Mの重複・競合確認、`main` 統合後の横断再監査は未完了。
- 完全無欠陥を保証せず、検証結果と残存リスクを記録する。

## 引き継ぎ時点の運用

- 工程Eのコード変更は原則PR #26のみ。PR #19はマージ済み。
- PR #31（B）の `lib/doc-tree.ts`、PR #30（F）の生成コード、PR #29（G）の公開API、PR #27（H）の外部通信は別担当の変更領域。
- `main` への直接pushや、独立レビュー前のPR #26マージは行わない。
