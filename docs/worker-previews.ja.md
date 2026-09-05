# エディタのプルリクエストのプレビュー

[English](worker-previews.md) · 日本語

Cloudflare Workers Builds では、エディタの本番以外の各ブランチを、専用の URL を持つ **Worker Preview** としてデプロイでき、URL はプルリクエストにコメントとして投稿されます。本リポジトリでは設定済みです。本書では、自身の Workers Builds プロジェクトでの設定方法と、プレビューの動作条件を説明します。

本書の対象はエディタのみです。公開サイトには保存先のバインディングも Durable Object もないため、ホスティング側で本番以外のブランチのビルドを有効にするだけで構いません。

## 設定

1. **Preview command に `node scripts/cloudflare-preview.mjs` を指定します。** Build command（`node scripts/cloudflare.mjs build`）と本番の Deploy command（`node scripts/cloudflare.mjs deploy`）はそのままにします。プレビューを本番の保存先やシークレットから分離するのはこのスクリプトのため、既定の `npx wrangler preview` は使用しないでください。
2. **動作を確認します。** ブランチを push し、ボットがプルリクエストに投稿した URL を開きます。検証用のサイトを作成し、再読み込み後も残っていることを確認してください。ビルドが成功しただけでは、プレビューの動作は確認できません。

ローカルからプレビューを作成・更新するには、`npm run preview:deploy -- --name <名前>` を実行します。`npm run preview` は、エディタをローカルで起動するだけのコマンドです。

## プレビューの動作条件

`wrangler.jsonc` の既定の `previews` ブロックは、**ログイン不要の公開デモ**を構成します。

- **ログイン不要。** `ALLOW_ANONYMOUS=true` はプレビューにのみ適用され、本番のログイン設定は変わりません。URL を知っている人は誰でも編集できます。
- **サーバーには保存しない。** D1 と KV を明示的に空にしているため、サイトや画像はプレビューの URL ごとにブラウザ内に保存されます。別の端末からの編集、サーバーへのアップロード、同時編集は利用できません。検証用のデータのみを使用してください。
- **独立した設定。** スクリプトはプレビュー専用のバインディングと変数を用意し、`--ignore-base-config` を付けて Wrangler を起動します。Durable Object の保存領域はプレビューごとに独立しています。既存のプレビューに設定済みのシークレットは検査・削除しないため、公開デモとして再利用する前に確認してください。ブラウザ内への保存でも、設定済みの公開用トークンや AI プロバイダーは無効になりません。

## テスト用の保存先の使用（任意）

プレビューで共有のサーバー保存先を使う場合は、次のように設定します。

1. **本番とも他のプレビューとも別の** D1 データベースと KV の名前空間を作成します。D1 が持つのはサイトのメタデータとルームキーで、文書本体は各プレビューの DocumentRoom に保存されます。D1/KV の ID を共用しても、エディタの保存先全体を共有することにはなりません。
2. 非公開の設定ファイル（`wrangler.local.jsonc` または `WRANGLER_CONFIG` で指定したファイル）の `previews` ブロックだけを、次のブロックに置き換えます。トップレベルの `exports.CollaborationRoom` と `exports.DocumentRoom` は、`type: "durable-object"` と `storage: "sqlite"` を維持してください。プレビュー用のバインディングには両方のクラスが必要です。明示しなければ、スクリプトは `COLLAB_ROOM` だけを補います。

```json
{
  "previews": {
    "vars": {},
    "durable_objects": {
      "bindings": [
        { "name": "COLLAB_ROOM", "class_name": "CollaborationRoom" },
        { "name": "DOC_STORE", "class_name": "DocumentRoom" }
      ]
    }
  }
}
```

3. テスト用の ID をビルド変数 `PREVIEW_D1_DATABASE_ID` と `PREVIEW_KV_NAMESPACE_ID` で指定します。代わりに `previews.d1_databases`（`binding: "DB"`、`database_name`、`database_id`）と `previews.kv_namespaces`（`binding: "ASSETS_KV"`、`id`）を明示しても構いません。空の配列を含め、明示した配列はビルド変数より優先されます。変数を使う場合は既定の空の配列を削除してください。テーブルは初回アクセス時に作成されます。
4. 共有の保存先を使用する前に、プレビュー自体に `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`AUTH_URL`、専用の OAuth コールバック URL、対象を絞った `ALLOWED_EMAILS` を設定してください。この例は `ALLOW_ANONYMOUS` を除いているため、ログイン未設定ではアクセスできません。認証情報は `previews.vars` ではなくプレビューのシークレットに設定します。
5. `wrangler.preview.generated.jsonc` の `previews` に、テスト用の `DB` と `ASSETS_KV`、両方の Durable Object のバインディングがあることを確認します。本番データを使わず、ログイン、サイト作成、編集、保存、別のブラウザからの再表示を検証してください。

プレビュー用の `DB` を設定すると、スクリプトは `DOC_STORE` がそのプレビューの SQLite 版 `DocumentRoom` にバインドされていることをデプロイ前に確認します。[保存先の構造](durable-object-storage.md#hosted-preview-storage)も参照してください。

## スクリプトが拒否する設定

`scripts/cloudflare-preview.mjs` は、元の設定ファイルと同じディレクトリに `wrangler.preview.generated.jsonc` を生成し（本リポジトリでは Git の管理対象外）、それを使って `wrangler preview` を実行します。次の場合は、デプロイせずにエラーで終了します。

- 明示したプレビュー用 D1/KV バインディングの ID が未設定、空白、プレースホルダ、または既知の本番 ID である（配列も対応するビルド変数も省略した場合は、空の配列になる）
- `COLLAB_ROOM` がプレビュー自身の `CollaborationRoom` にバインドされていない、別の Worker を指している、または`exports`設定でDurable Objectクラスの状態を変更している
- `previews` に、分離の方法が定義されていない設定が含まれている
- `previews.vars` に `AUTH_SECRET` や `GITHUB_TOKEN` など、認証情報に相当する名前が含まれている（秘密の値は平文の変数ではなく Preview のシークレットへ設定する）
- OpenNext の設定で、既定のダミー以外のキャッシュ、キュー、スキュー保護を使用している
- Worker 名が、Workers Builds のデプロイ対象と一致しない
- `--name`・`--tag`・`--message`・`--json` 以外の引数が指定された

スクリプトが検査できるのは渡された設定ファイルのみで、Cloudflare のダッシュボードでの設定は対象外です。不明な点があれば、ダッシュボードで実際のバインディングを確認してください。

## 参考資料（2026-11-06 確認）

- [Worker Previews の始め方](https://developers.cloudflare.com/workers/previews/get-started/)
- [本番以外のブランチのビルド](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [プレビューの設定とシークレット](https://developers.cloudflare.com/workers/previews/configuration/)
- [リソースと分離](https://developers.cloudflare.com/workers/previews/resources/)
