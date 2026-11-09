# D1の編集データをDurable Objectsへ移行する

この手順は、Tsumuの**旧D1 `docs.body`（サイトごとのJSON文書）**をダウンロードし、現行の `SiteDoc` として検証して、**#39で採用したサイトごとのDurable Object内SQLite**へ書き込むためのものです。ツールはリポジトリ内の `scripts/migrate-d1-to-do.mjs` です。

移行後、文書は `DocumentRoom` の `document_meta` と `document_entries`（ページ・要素・アセット・コンポーネントごとに1行）へ格納されます。サイトの基本情報、許可メール、コメント、アクティビティ、KV上の画像などは移動しません。**元のD1 `docs` レコードは削除・上書きしません。** 旧D1のバックアップ履歴は移行せず、移行後の編集から新しい日次バックアップが生成されます。

## 前提と安全対策

1. **全編集者の操作と自動保存を停止**してください。読み取り専用にするか、編集者全員が接続を閉じている状態で実行します。エクスポート後の旧D1のリビジョンが変化していたら、ツールは投入を停止します。ただし外部の保存を完全にはロックできません。
2. Node.jsとnpmはリポジトリの `package.json` の要件を満たすものを使用し、`npm ci` を実施してください。Cloudflare Wranglerへのログインと、対象D1を指定した `wrangler.local.jsonc` が必要です。
3. **移行開始前にD1の完全バックアップを別途保存**してください。後述の `prepare` は必要な `sites` と `docs` のみをエクスポートします。
4. `apply` 実行前に **#39以降のDocumentRoom版Workerをデプロイ**してください。旧版へアップロードすることを防ぐ検査があります。新Workerを先にデプロイすると、旧サイトは移行完了まで編集データを表示できないため、メンテナンス中に作業してください。
5. 本ツールは公開された移行専用APIを設置しません。Tsumuにログイン済みの管理用ブラウザから取得したセッションCookieを、ローカルの権限 `600` のファイルに保管し、**パスのみ**を `--cookie-file` で指定してください。Cookieをチャット・GitHub・シェル履歴・作業ログに貼らないでください。利用後はCookieファイルを安全に破棄し、必要に応じてセッションを失効させてください。

## 1. 全D1のバックアップ（推奨）

```bash
mkdir -p "$HOME/tsumu-d1-to-do"
chmod 700 "$HOME/tsumu-d1-to-do"

npx wrangler d1 export tsumu \
  --remote --config wrangler.local.jsonc \
  --output "$HOME/tsumu-d1-to-do/full-before-migration.sql"
chmod 600 "$HOME/tsumu-d1-to-do/full-before-migration.sql"
```

D1以外のWorkers KVデータはこのSQLに含まれません。必要ならアセットも別途退避してください。

## 2. D1から取得し、現行SiteDocへ変換・検証（読み取り専用）

```bash
node --import tsx scripts/migrate-d1-to-do.mjs prepare \
  --database tsumu \
  --config wrangler.local.jsonc \
  --out "$HOME/tsumu-d1-to-do/prepared"
```

Wranglerは`sites`と`docs`をSQLエクスポートします。ローカルのSQLiteに読み戻し、各文書をTsumuの `validSiteDoc` で検証します。結果は以下のようになります。

- `d1-sites-and-docs.sql`：編集データを含む元のSQL
- `converted/<サイトID>.json`：APIへのアップロードに使用する現行SiteDoc
- `manifest.json`：サイトごとの件数、旧リビジョン、更新日時、SHA-256

エクスポート済みSQLを使用して検証する場合は `--input-sql /path/to/export.sql` を付けます。ただし、SQLファイルには `sites` と `docs` の両方が必要です。特定サイトだけを移す場合は `--site current` のように指定できます。

### SiteDocの形式が古く、検証に失敗する場合

古いスクリプト構造などで `validSiteDoc` に合致しない場合、**自動的にデータを書き換えたり、黙って一部を捨てたりはしません**。その場合は別の変換ツールで現行 `SiteDoc` JSONを作り、明示的に指定します。

```bash
node --import tsx scripts/migrate-d1-to-do.mjs prepare \
  --database tsumu --config wrangler.local.jsonc \
  --out "$HOME/tsumu-d1-to-do/prepared-converted" \
  --input-sql "$HOME/tsumu-d1-to-do/full-before-migration.sql" \
  --override-doc current=/path/to/converted-current.json
```

`--override-doc` は `site=path` の形式です。元のD1文書のサイトID・リビジョン・保存日時は維持して記録し、アップロード内容だけを指定したJSONにします。これは**移行ツールのみの機能**であり、Tsumu本体に旧形式互換コードは追加されません。旧形式の変換が正しいかは別途検証してください。

## 3. 認証情報の用意

ログイン済みのブラウザで、Tsumuへのリクエストに送られているCookieヘッダーの内容をファイルへ保存します。認証が必要な場合はブラウザの開発者ツールから取得できます。Cookieは文字列1行で保存します（`Cookie:` は省略可）。

```bash
umask 077
mkdir -p "$HOME/.config/tsumu"
# テキストエディタ等で ~/.config/tsumu/migration-cookie.txt を作成
chmod 600 "$HOME/.config/tsumu/migration-cookie.txt"
```

このファイルを `git add` しないでください。ツールはCookieをログやマニフェストに記録しません。認証を確認できない場合、投入前に処理を中断します。

## 4. 新版Workerへ投入し、再読込して一致を確認

```bash
node --import tsx scripts/migrate-d1-to-do.mjs apply \
  --database tsumu \
  --config wrangler.local.jsonc \
  --dir "$HOME/tsumu-d1-to-do/prepared" \
  --base-url https://YOUR-EDITOR-DOMAIN \
  --cookie-file "$HOME/.config/tsumu/migration-cookie.txt"
```

ツールは開始前に対象サイトのIDと作成日時、旧D1の `rev`・`saved_at` の一致、Web APIのログイン状態を確認します。その後、各サイトについてD1の `site_document_rooms` に必要な世代キーを**未登録時のみ**追加し、通常の認証付き `PUT /api/doc?site=<ID>` でJSONを保存します。

最後に `GET /api/doc` で読み戻し、JSON構造の完全一致を検証します。途中で失敗した場合も、同じディレクトリで `apply` を再実行できます。既に同じ内容が保存されていればスキップし、異なるデータが入っている場合は**上書きせず停止**します。`progress.json` はローカルの記録で、再実行時にもサーバーの実データを再検証します。

**新規移行したDocumentRoomのリビジョンは `1` から開始します。** 旧D1の `rev` はマニフェストに保持しますが、オンラインの保存リビジョンとしては引き継ぎません。古いエディタタブを開き直してください。

## 失敗時・完了後

- 失敗しても元D1の `docs` は変更されません。リビジョンが増えていた場合は**再エクスポート**してください。
- `apply` が空の保存先マップだけを作った後で停止した場合、再実行で同じ保存先を使います。
- 移行先に予期しない別文書がある場合、上書きしません。どちらのデータを採用するか手動で判断してください。
- サイトIDと作成日時が違う環境、あるいは旧バージョンのWorkerにアップロードしようとした場合は、検出できる範囲で投入を拒否します。
- 移行完了後、Tsumuのエディタで開き、ページ・要素数、スクリプト、画像、サイト複製、差分保存、日次バックアップを確認してください。
- D1の旧`docs`と`site_backups`は**自動削除しません**。バックアップを確保し検証が終わるまで残してください。KV上のアセットも削除しません。
- このツールは、オンラインの編集を排他ロックするものではありません。運用上の編集停止が前提です。完全なD1とDurable Object間の原子性はありません。
