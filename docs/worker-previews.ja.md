# エディタのプルリクエストのプレビュー

[English](worker-previews.md) · 日本語

Cloudflare Workers Builds では、エディタの本番以外の各ブランチを、専用の URL を持つ **Worker Preview** としてデプロイでき、URL はプルリクエストにコメントとして投稿されます。本リポジトリでは設定済みです。本書では、自身の Workers Builds プロジェクトでの設定方法と、プレビューの動作条件を説明します。

本書の対象はエディタのみです。公開サイトには保存先のバインディングも Durable Object もないため、ホスティング側で本番以外のブランチのビルドを有効にするだけで構いません。

## 設定

1. **Preview command に `node scripts/cloudflare-preview.mjs` を指定します。** Build command（`node scripts/cloudflare.mjs build`）と本番の Deploy command（`node scripts/cloudflare.mjs deploy`）はそのままにします。プレビューを本番の保存先やシークレットから分離するのはこのスクリプトのため、既定の `npx wrangler preview` は使用しないでください。
2. **動作を確認します。** ブランチを push し、ボットがプルリクエストに投稿した URL を開きます。検証用のサイトを作成し、再読み込み後も残っていることを確認してください。ビルドが成功しただけでは、プレビューの動作は確認できません。

ローカルからプレビューを作成・更新するには、`npm run preview:deploy -- --name <名前>` を実行します。`npm run preview` は、エディタをローカルで起動するだけのコマンドです。

## プレビューの動作条件

`wrangler.jsonc` の `previews` ブロックにより、すべてのプレビューは**ログイン不要の公開デモ**として動作します。

- **ログイン不要。** `ALLOW_ANONYMOUS=true` はプレビューにのみ適用され、本番のログイン設定は変わりません。URL を知っている人は誰でも編集できます。
- **サーバーには保存しない。** D1 と KV を明示的に空にしているため、サイトや画像はプレビューの URL ごとにブラウザ内に保存されます。別の端末からの編集、サーバーへのアップロード、同時編集は利用できません。検証用のデータのみを使用してください。
- **本番から何も引き継がない。** Durable Object の保存領域はプレビューごとに独立しています。本番の変数やシークレットはコピーされず、作成時にダッシュボードの Preview Base の設定も引き継がれません。ただし、既存のプレビューに設定済みのシークレットは保持されます。

## テスト用の保存先の使用（任意）

プレビューで共有のサーバー保存先を使う場合は、次のように設定します。

1. 本番とは**別に**、D1 データベースと KV の名前空間を作成します。
2. 設定ファイルから、空の `previews.d1_databases` と `previews.kv_namespaces` を削除します。空の配列がある間はそちらが優先され、ブラウザ内への保存のままになります。
3. 作成した ID をビルド変数 `PREVIEW_D1_DATABASE_ID` と `PREVIEW_KV_NAMESPACE_ID` で指定するか、非公開の設定ファイル（`wrangler.local.jsonc` または `WRANGLER_CONFIG` で指定したファイル）の `previews` にバインディングを記述します。テーブルは初回アクセス時に自動で作成されます。

同じ ID を使うブランチ同士はデータを共有します。サーバーに保存できるようにしたプレビューは、ログイン不要のまま公開しないでください。`previews.vars` から `ALLOW_ANONYMOUS` を削除し、プレビュー自体にシークレットを設定したうえで、プレビュー専用の OAuth コールバック URL と対象を絞った許可リストでログインを設定してください。

## スクリプトが拒否する設定

`scripts/cloudflare-preview.mjs` は、元の設定ファイルと同じディレクトリに `wrangler.preview.generated.jsonc` を生成し（本リポジトリでは Git の管理対象外）、それを使って `wrangler preview` を実行します。次の場合は、デプロイせずにエラーで終了します。

- プレビュー用の D1 または KV の ID が未設定、プレースホルダのまま、または本番と同一である
- `COLLAB_ROOM` がプレビュー自身の `CollaborationRoom` にバインドされていない、別の Worker を指している、またはマイグレーションでクラスを移動している
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
