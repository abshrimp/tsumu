# エディタのプルリクエストのプレビュー

[English](worker-previews.md) · 日本語

Cloudflare Workers Builds を使うと、エディタの本番以外のブランチを、それぞれ専用の URL を持つ **Worker Preview** としてデプロイできます。URL はプルリクエストにコメントで投稿されます。このリポジトリではすでに設定してあり、このページでは、自分の Workers Builds プロジェクトで同じことをする方法と、プレビューがどういう状態で動くのかを説明します。

ここで扱うのはエディタだけです。公開サイトには保存先のバインディングも Durable Object もないので、この手順は必要ありません。公開サイトのホスティング側で、本番以外のブランチのビルドを有効にしてください。

## 設定

1. **Preview command に `node scripts/cloudflare-preview.mjs` を指定します。** Build command（`node scripts/cloudflare.mjs build`）と本番の Deploy command（`node scripts/cloudflare.mjs deploy`）はそのままにします。既定の `npx wrangler preview` は使わないでください。プレビューを本番の保存先やシークレットから切り離しているのは、このスクリプトです。
2. **実際に開いて確かめます。** ブランチを push し、ボットがプルリクエストに投稿した URL を開いてください。使い捨てのサイトを作り、ページを読み込み直しても残っていれば問題ありません。ビルドが成功しただけでは、プレビューが動いている証拠にはなりません。

手元からプレビューを作成・更新するときは、`npm run preview:deploy -- --name <名前>` を実行します。`npm run preview` のほうは、エディタを手元で起動するだけのコマンドです。

## プレビューの状態

`wrangler.jsonc` の `previews` ブロックにより、プレビューはどれも**ログインなしで使える公開デモ**として動きます。

- **ログインは不要です。** `ALLOW_ANONYMOUS=true` が効くのはプレビューだけで、本番のログインの設定は変わりません。URL を知っていれば誰でも編集できます。
- **サーバーには保存しません。** D1 と KV を空にしてあるので、サイトや画像はプレビューの URL ごとにブラウザ内に保存されます。別の端末での編集、サーバーへのアップロード、同時編集は使えません。データは使い捨てのものにしてください。
- **本番からは何も引き継ぎません。** Durable Object の保存領域はプレビューごとに別々です。本番の変数やシークレットはコピーせず、プレビューを作るときにダッシュボードの Preview Base の設定も引き継ぎません。ただし、すでにあるプレビューに設定済みのシークレットは、そのまま残ります。

## テスト用の保存先を使う（任意）

プレビューで共有のサーバー保存先を使いたい場合は、次の手順で設定します。

1. 本番とは**別に**、D1 データベースと KV の名前空間を作ります。
2. 設定ファイルから、空の `previews.d1_databases` と `previews.kv_namespaces` を削除します。空の配列が残っているあいだはそちらが優先され、プレビューはブラウザ内の保存のままです。
3. 作成した ID を、ビルド変数 `PREVIEW_D1_DATABASE_ID` と `PREVIEW_KV_NAMESPACE_ID` で渡します。あるいは、手元だけの設定ファイル（`wrangler.local.jsonc` か、`WRANGLER_CONFIG` で指定したファイル）の `previews` にバインディングを書きます。データベースのテーブルは、最初のアクセス時に自動で作られます。

同じ ID を使うブランチ同士は、データを共有します。また、サーバーに保存できるようにしたプレビューを、ログインなしのまま公開しておくのは避けてください。`previews.vars` から `ALLOW_ANONYMOUS` を外し、プレビュー自体にシークレットを設定したうえで、プレビュー専用の OAuth コールバック URL と、対象を絞った許可リストでログインを設定してください。

## スクリプトが止める設定

`scripts/cloudflare-preview.mjs` は、元の設定ファイルと同じ場所に `wrangler.preview.generated.jsonc` を作り（このリポジトリでは Git の管理外）、それを使って `wrangler preview` を実行します。次のような場合は、デプロイせずにエラーで止まります。

- プレビュー用の D1 や KV の ID がない、プレースホルダのまま、または本番と同じ ID になっている
- `COLLAB_ROOM` がプレビュー自身の `CollaborationRoom` を指していない、別の Worker を指している、またはマイグレーションでクラスを移している
- `previews` に、本番から切り離す方法が決まっていない設定が入っている
- OpenNext の設定で、既定のダミー以外のキャッシュ、キュー、スキュー保護を使っている
- Worker 名が、Workers Builds のデプロイ先と食い違っている
- `--name`・`--tag`・`--message`・`--json` 以外の引数が渡された

ただし、スクリプトが調べられるのは渡された設定ファイルだけで、Cloudflare のダッシュボードでの設定までは見えません。気になる点があれば、ダッシュボードで実際のバインディングを確認してください。

## 参考資料（2026-11-06 確認）

- [Worker Previews の始め方](https://developers.cloudflare.com/workers/previews/get-started/)
- [本番以外のブランチのビルド](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [プレビューの設定とシークレット](https://developers.cloudflare.com/workers/previews/configuration/)
- [リソースと分離](https://developers.cloudflare.com/workers/previews/resources/)
