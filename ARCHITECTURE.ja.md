# アーキテクチャ

[English](ARCHITECTURE.md) · 日本語

本書は、コードを変更する開発者向けにコードベースの全体像を説明します。セットアップとデプロイについては [README](README.ja.md) を参照してください。

## 基本となるデータ

エディタが扱うサイトの情報は、すべて `SiteDoc`（`lib/types.ts`）という1つの JSON 値にまとまっています。

- エディタの画面は、これを読み取り、変更します。
- 同時編集は、これを同期します。
- AI は、これに対する編集を提案します。
- 生成処理は、これを Next.js プロジェクトに変換し、その他の出力形式はこの結果から派生させます。
- インポートは、Tsumu の zip・`doc.json`・一般的な HTML から、これを生成します。

`SiteDoc` を理解すれば、他の部分も容易に把握できます。

```
           ┌────────── edit (zustand store, undo) ────────────┐
           │                                                  │
 Canvas / panels ──▶ SiteDoc ──▶ generator ──▶ files ──▶ GitHub (main / preview) or zip
           ▲            │  ▲                                  │
           │            │  └─ AI ops (validated on a copy)    └─▶ any host
           │            ▼
           └── D1 (site index) + per-site Durable Objects (SQLite document, live updates)
```

## `SiteDoc` の構造

| フィールド | 内容 |
|---|---|
| `pages`・`pageOrder`・`pageFolders` | ページ（slug・タイトル・メタデータ・ページのスクリプト）と並び順。各ページは最上位のノードの ID を `children` に持ちます。 |
| `nodes` | すべての `DocNode` を ID で引けるフラットなマップ。木構造は入れ子ではなく、各ノードの `children`（ID の配列）で表します。 |
| `components` | 再利用可能なノードの木。`instance` ノードが `componentId` で参照します。 |
| `assets` | アップロードされた画像・動画・音声・フォント。本体は KV（またはブラウザ）に保存し、文書にはメタデータと保存先のキーのみを持ちます。 |
| `breakpoints` とサイトの設定 | ブレークポイント、フォント、配色、ファビコンと OGP、PWA、ホスティングの選択、データの更新間隔、言語。 |

`DocNode` は必ず `type` と `semantic`（出力する HTML タグ）を持ち、必要に応じて内容（`text`・`image`・`field`・`media`・`list` など）、`styles`、`scripts`、`motions` を持ちます。

- **スタイル**は `styles[breakpoint][state][cssProperty]` の形式で保持します。状態は `default`・`hover`・`active`・`focus`、または名前付きの状態 `custom:<名前>` のいずれかで、値はすべて通常の CSS の文字列です。名前付きの状態は要素の `data-site-state` 属性がその名前のときに適用され、スクリプトの `set-state` 手順で切り替えます（`lib/custom-states.ts`）。
- **スクリプト**はコードではなくデータであり、トリガーとそれに続く手順（`Script`・`ScriptStep`）で構成されます。データ構造は `lib/script.ts` で定義し、実行は `lib/script-runtime.ts` が担います。ランタイムはキャンバスのプレビューと書き出したサイトで共用し、書き出し時にはそのサイトが使う機能のみを残します。
- **リスト**は配列と辞書のどちらも扱い、項目の値に対してテンプレートの子要素を繰り返し表示します。データ取得やスクリプトで作ったリストを表示し、項目ごとの詳細ページ（`/news/[slug]` など）も生成できます。

> [!IMPORTANT]
> ノードの ID は文書内で一意で、割り当て後は変わりません。マージ、元に戻す処理、コメント、AI の編集操作はいずれも ID に依存するため、再利用や振り直しはしないでください。部分木を安全に複製できるのは `lib/cloneIds.ts` のみです。

## ファイル構成

| 領域 | ファイル |
|---|---|
| エディタの状態、元に戻す・やり直す | `lib/store.ts`（zustand）。すべての変更がストアを経由するため、元に戻す処理と同期の両方に反映されます。 |
| キャンバスとパネル | `components/Canvas.tsx` と `canvas/`（CSS、ノードの描画、`NodeView`、`useCanvasData`、`useCanvasDrag`）<br>`LeftPanel.tsx` と `left-panel/`（タブごとに1ファイル）<br>`StylePanel.tsx` と `style-panel/`（セクションごとに1ファイル）<br>`ScriptEditor.tsx` と `script-editor/`（パレット、ブロック、手順の本体、入力欄、`useScriptDrag`、`useScriptEditorKeys`）<br>`SitePanel.tsx` |
| スタイルから CSS への変換 | `lib/style.ts`、`lib/breakpoints.ts`、`lib/motion.ts`、`lib/keyframes.ts` |
| 生成処理 | `lib/generator.ts`。`generateProject(doc, target)` が Next.js プロジェクトを `{ files, binaries, remoteAssets }` として返します。部品は `lib/generator/` にあります（`names.ts`、`css.ts`、`render.ts` と `render-helpers.ts`、`page.ts`、`head.ts`、`templates.ts`）。 |
| 出力形式 | `lib/export-formats.ts` と、`lib/generator/` のその他のファイル。詳細は [出力形式](#出力形式) を参照してください。 |
| 公開と zip での書き出し | `components/PublishModal.tsx`（ブラウザ側）から `app/api/publish/route.ts`（GitHub Git Data API）へ。詳細は [公開の仕組み](#公開の仕組み) を参照してください。<br>`components/Header.tsx` の `ExportModal` から `lib/exportZip.ts` へ |
| インポート | `lib/import-site-file.ts`（ファイルからのサイト作成）、`lib/site-import.ts`（Tsumu の zip と `doc.json`）、`lib/portable-doc.ts`（圧縮形式の `doc.json`）、`lib/html-to-site.ts` と `html-file-import.ts`・`html-zip.ts`（HTML）。詳細は [インポート](#インポート) を参照してください。 |
| 公開前チェック | `lib/generator/checks.ts` の `runChecks`。リンク切れ、代替テキスト、見出しの順序、小さすぎる文字、レイアウトのはみ出しを検査します。 |
| 保存 | `document-room.ts`・`lib/structured-document-store.ts`：サイト作成世代ごとのSQLite対応Durable Objectでページ・要素などを個別行保存<br>`lib/site-document-service.ts`：CloudflareとNodeの保存先振り分け<br>`lib/doc-storage.ts`・`lib/node-storage.ts`：Node・Docker用SQLite<br>`lib/kv.ts`：アセット実体<br>`lib/local-storage.ts`：ブラウザ保存 |
| 同時編集 | `custom-worker.ts`：サイト作成世代ごとに独立したWebSocket用Durable Object<br>`lib/collab-events.ts` と `app/api/collab/events`：Node.js と Docker における Server-Sent Events<br>`lib/collab.ts`：送受信するメッセージ<br>`lib/merge.ts`：3方向マージ。ノードの ID、次に項目の単位で照合し、配列は全体を1つの値として扱います。 |
| AI | `lib/ai/`（プロバイダ、プロンプト、ストリーミング）、`lib/aiOps.ts`（編集操作の定義と、サーバーとブラウザで共通の適用関数） |
| コメント、編集の記録 | `lib/comments.ts`、`lib/comment-store.ts`、`lib/activity.ts` |
| 認証 | `auth.ts`、`middleware.ts`、`lib/allowlist.ts`。`AUTH_*` が未設定の場合、エディタを利用できるのは `npm run dev` の実行時か `ALLOW_ANONYMOUS=true` の設定時のみです（`lib/anonymous.ts`）。 |
| 多言語対応 | `lib/i18n.ts`。原文は日本語で記述し、`tr("…")` で囲みます。訳は `lib/locales/` に配置します。 |
| ヘルプとチュートリアル | `lib/manualTopics.ts`、`components/HelpCenter.tsx`、`HelpFigures.tsx`、`Tutorial.tsx` |

### ブラウザに保存したサイトの削除

本節では、サイトの記録がブラウザ内にある場合の削除処理を説明します。

**削除マーカーが必要な理由**

記録がないことは、サイトが削除された証明にはなりません。サーバーに保存しているサイトでも、503 が返された後はコメントをブラウザ内に保存することがあり、サイトの記録がないままコメントだけが存在し得るためです。そのため、サイトの記録やコメントのキーが見つからない場合や通信エラーが起きた場合も、それだけでは「削除済み」と判断しません。

**削除の手順**

ホーム画面で削除が確定すると、次の順序で処理します。

1. ローカルのメタデータを検証します。
2. 対象のサイトに永続的な削除マーカー `tsumu-site-deleted-v1:<id>` を書き込みます。**削除はこの書き込みの時点で成立します。** 書き込みに失敗した場合、サイトの一覧と内容はそのまま残ります。
3. 一覧からサイトを除外し、内容を削除します。この処理はベストエフォートのため、一覧の書き込みに失敗しても削除は成功として扱います。

**削除したサイトが復活しない理由**

- `loadLocalSites` はマーカーのある ID を除外します。古い一覧で上書き保存されても、削除したサイトは復活しません。
- マーカーは `SITE_SCOPED_KEYS` とは別に管理しているため、作成や複製の失敗後の後処理で消えることもありません。
- 新規作成・複製したサイトには常に新しいランダムな ID を割り当てます。同じ ID で復元する手段はなく、削除は取り消せません。
- 要素やページの編集を元に戻しても、マーカーには影響しません。

**ブラウザ内のコメントとマーカー**

コメントの読み込み時と、待機中のコメントの書き込み時には、必ずマーカーを確認します。POST が 503 を返した後の代替保存でも、書き込みの直前と直後に確認します。

- 削除済みと判明しているサイトでは、コメントの行とピンを非表示にし、操作を失敗として扱います。ただし、開いている下書きや詳細は残すため、入力した文章はコピーできます。
- マーカーを読み取れなかった場合は、書き込みを失敗として扱いますが、サイトを削除済みとは表示しません。
- サーバーでの操作が成功した場合は、その結果を正とします。

**保証の範囲**

利用者から見える範囲では、常に削除が優先されます。ただし、保存データが即座にすべて消去されることは保証しません。古いタブが書き込みと確認の間で停止したり、後処理が失敗したりする場合があるためです。タブ間のロックは設けておらず、文書の自動保存の仕組みも変更していません。

## 公開の仕組み

公開は次の4段階で行います。

1. ブラウザが、選択された形式でプロジェクトを生成し（`prepareExportProject`）、`_tsumu/doc.json` を追加します。これは文書の写しで、編集内容の復元とロールバックに使います。
2. 公開先のブランチにある現在のファイル一覧を、サーバーに問い合わせます（`action: "tree"`）。blob の SHA が既に存在するアセットは再アップロードしません。保存先のキーと SHA の対応は `_tsumu/assets.json` に記録します。
3. 大きなファイルとアセットは、1件ずつ個別のリクエストでアップロードします（`action: "upload"`）。これにより、各リクエストを Workers 無料プランのサブリクエスト数の上限に収めます。
4. ブラウザがコミットを要求します（`action: "commit"`）。サーバーはファイルの一覧を分割して組み立て、ブランチを更新します。

### 生成したファイルと手動で追加したファイル

エディタは、自身が生成したファイルをすべて管理し、各ファイルのパスと blob の SHA を `_tsumu/generated.json` に記録します（`lib/publish-files.ts`）。次回の公開時には、次のように扱います。

- **一覧にないファイル**は手動で追加されたものとみなし、そのまま保持します。そのため、API ルート、コンポーネント、設定ファイルなどを追加しても失われません。
- **SHA が変化した生成ファイル**は GitHub 上で編集されたものとみなし、公開画面で確認を求めたうえでエディタの内容で上書きします。

初回の公開時には、既存のファイルをすべて手動で追加されたものとみなします。無関係なファイルは保持し、エディタが書き込むパスに既存のファイルがあれば確認を求めます。記録の一覧が破損している場合は、公開を中止します。`_tsumu/` ディレクトリはエディタ専用です。

### ロールバック

ロールバック（`app/api/publish/history/route.ts`）は、過去の時点のファイル一式を新しいコミットとしてブランチの先頭に積みます。履歴は書き換えません。

## 出力形式

`lib/export-formats.ts` の `prepareExportProject(doc, options, target)` は、公開と zip での書き出しに共通の処理です。そのため、両者は常に同じファイルを出力します。

1. **出力範囲**：`exportScopeDoc` が、指定に応じて文書を現在のページまたは選択中の要素に絞り込みます。その範囲で使うノード・コンポーネント・アセットのみを残すため、他のページの内容は含まれません。
2. **制限**：`exportLimitations` が、選択した形式で表現できない機能（動的パス、リダイレクト、HTMLページ、データ取得の認証情報など）を列挙します。画面はこれらをエラーとして表示し、解消されるまで先に進みません。
3. **Next.js の生成**：`generateProject` は常に実行し、その他の形式はその出力と文書から生成します。

| 形式 | ファイル |
|---|---|
| React + Vite | `react-export.ts`、`react-form.ts` |
| Vue 3 + Vite・Nuxt・SvelteKit | `framework-export.ts`（プロジェクトのファイル）、`native-scaffold.ts` と `native-components.ts`（各ノードを Vue・Svelte の要素として出力し、サーバーで描画してブラウザでハイドレーション）、`native-data.ts`、`vue-ssr.ts` |
| HTML / CSS / JavaScript | `html-export.ts`、`browser-data.ts`（ブラウザでのデータ読み込み）、`query-route.ts`（クエリ別のページを1つの静的ファイルで表示） |
| 単一のHTML | `single-html.ts`。HTML 形式の CSS・スクリプト・アセットを埋め込みます。 |

4. **言語とスタイル**：`javascript-export.ts` が、Next.js と React の TypeScript の出力を JavaScript に変換します。Vue・Nuxt・SvelteKit は、選択された言語で直接出力します。`style-export.ts` が CSS Modules・Tailwind CSS を生成します。
5. **テスト公開**：Next.js 以外の形式では、テスト公開時に `noindex` の meta タグを追加し、単一のHTML以外には `robots.txt` と `_headers` も追加します。

外部データを取得する生成コードには、エディタ本体と同じ SSRF 対策を組み込みます。`lib/generator/safe-fetch-source.ts` は `lib/safe-fetch.ts` の複製のため、直接編集せず、`node --import tsx scripts/sync-fetch-runtime.mts` で再生成してください（差異があるとテストが失敗します）。メディアとリンクの URL は、どの形式でも `lib/url-policy.ts` で検証します。

## インポート

`lib/import-site-file.ts` の `createSiteFromFile` は、すべての準備を終えてからサイトを作成し、文書をサーバーまたはブラウザに保存します。サーバー保存ではサイトと最初の文書を同じデータベーストランザクションで作成します。応答が途切れた場合は発行済みのIDで文書を照合し、保存結果が不明な間はアセットを保持します。確定した失敗では新規アップロードを取り消します。ブラウザ保存ではインポート・作成・複製・設定更新・削除・編集時刻更新がサイト一覧への書き込みを共有ロックで順に行い、同時に開いたタブの変更を保持します。

- **Tsumu の zip・`doc.json`**（`lib/site-import.ts`）：zip には `_tsumu/doc.json` が1つのみ含まれている必要があります。`_tsumu/assets.json` は、元のアセットの ID とアーカイブ内のファイルを対応付けます。`doc.json` は通常の JSON か、`lib/portable-doc.ts` の gzip＋Base64 による圧縮形式です。文書を検証し、アセットを元の ID のまま再アップロードします。パスは推測しないため、対応表になく data URL もないアセットは復元せず、注意事項として表示します。ルートの外を指すパスは拒否します。
- **HTML ファイル・ウェブサイトの zip**（`lib/html-to-site.ts`）：すべてのページを編集可能なノードに変換します。クラスと安全な一部の属性は保持し（`lib/imported-html-attrs.ts`）、イベント属性、URL を含む属性、Tsumu 内部の `data-*` 属性は引き継ぎません。
- **上限**（`IMPORT_LIMITS`）：zip は100MB、`doc.json` と HTML ファイルは12MB、展開後は500ファイル・300MBまでです。

エディタのページ設定からは、1つのページに HTML を読み込むこともできます。ノードに変換するか、HTMLページとしてそのまま使うかを選べます。後者については次節で説明します。

### HTML ZIP の読み込み

`lib/html-zip.ts` は、ZIP にまとめたサイト（200ファイルまで）を読み込みます。元のファイルはそのまま保存し、別途 `lib/zip-css.ts` が CSS ファイルごとに依存ファイルのアーカイブ内のパスを記録します。対象は相対パスの `url()`、`image-set()` の画像、`@import` で、いずれもスタイルシートのディレクトリを基準に解決します（`lib/zip-references.ts`）。この記録は新しく読み込んだ ZIP にのみあり、以前のものは移行していないため、必要に応じて読み込み直してください。

- **プレビュー**：スタイルシートを個別に扱うため、読み込み順・条件・レイヤーが保たれます。依存ファイルは、リモートの保存先からは署名付き URL、ローカルの代替時は data URL で提供します。空のシートに置き換えるのは、自身の祖先を参照する `@import` のみです。署名付き URL の期限が近づくと、自動で再読み込みせずに更新を促します。再読み込みするとフォームやスクリプトの状態が失われるためです。
- **書き出し**：CSS ファイルはそれぞれ UTF-8 の個別ファイルとして出力し、参照先を生成したアセットのファイル名に書き換えます。integrity のハッシュは、内容が変わる読み込み済みのローカル CSS へのリンクからのみ削除します。
- **コピーと不要ファイルの削除**：ページのコピー時には、スタイルシートの依存ファイルも併せてコピーします。未使用アセットの削除時も、参照中のスタイルシートの依存ファイルは保持します。
- **書き換えの対象外**：JavaScript モジュールの import、存在しないファイルへの参照、外部の URL は変更しません。アーカイブの外を指すルート相対・プロトコル相対の URL は、プレビュー時に限り絶対 URL に変換します。
- **上限**（`ZIP_CSS_LIMITS`）：CSS は UTF-8 のみ。CSS の量は読み込みごと・プレビューの依存関係ごとに 2 MiB、プレビューの出力は 8 MiB、派生処理は合計 64 MiB、派生は 4,096 個、入れ子のシートは 200 個までです。上限を超えるとプレビューにエラーを表示します。

## AI による編集

AI が文書を直接変更することはありません。処理の流れは次のとおりです。

1. AI は、編集操作の一覧（`lib/aiOps.ts` の `AiOp`）を返します。
2. サーバーがそれらをページの複製に試験的に適用します。存在しないノードの参照などで失敗した操作があれば、エラーを AI に返して修正させます。
3. 正常に適用できた操作のみをブラウザに送り、ブラウザは同じ関数で1回で元に戻せる変更として適用します。

AI の処理中に利用者が同じページを編集した場合、AI の変更は破棄します。

## 開発上の規約

- **言語**：コメントと画面の文言は日本語で記述します。`tr()` で新しい文言を追加した場合は、英訳も必要です（`npm run i18n:check`）。
- **可読性の高い出力**：生成するコードは、人が手で書いたものと同等に読みやすくします。開発者が手では書かないような出力は不具合として扱います。
- **データ形式**：ブラウザへの保存には `tsumu-` で始まるキーを、クリップボードには `application/x-tsumu+json` を使用します。最初の公開版の形式のため、前身のアプリケーションからの移行処理はありません。
- **テスト**：新しい動作にはテストが必要です。
  - 単体テストは `tests/` に配置します。`tsx` 経由で Node 組み込みのテストランナーを使い、`lib/` のモジュールを直接読み込みます。
  - 画面操作のテストは `e2e/`（Playwright）に配置します。ビルドしたエディタを Node.js で起動し、一時的な `TSUMU_DATA_DIR` と `ALLOW_ANONYMOUS=true` を指定して実行します。
  - 出力形式は CI で実際にビルドしています。`scripts/smoke-export-build.mts` がサンプルのプロジェクトを `.generated-export-smoke/` に生成し、`check-generated-ssr.mts` と `check-generated-browser.mts` が実行して検証します。

```bash
npm run typecheck
npm test
npm run i18n:check
npm run build && npm run test:e2e
```
