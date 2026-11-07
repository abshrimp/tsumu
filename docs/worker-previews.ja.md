# エディタのプルリクエストのプレビュー

[English](worker-previews.md) · 日本語

Cloudflare Workers Builds では、エディタの本番以外のブランチを、それぞれ専用のURLを持つ **Worker Preview** としてデプロイし、そのURLをプルリクエストにコメントとして投稿できます。このリポジトリでは設定済みです。このページでは、自身の Workers Builds プロジェクトでの設定方法と、プレビューの構成について説明します。

このページの内容はエディタのみを対象としています。公開サイトは保存先のバインディングも Durable Object も持たないため、この手順は不要です。公開サイトのホスティングプロジェクト側で、本番以外のブランチのビルドを有効にしてください。

## 設定

1. **Preview command を設定します。** `node scripts/cloudflare-preview.mjs` を指定してください。Build command（`node scripts/cloudflare.mjs build`）と本番の Deploy command（`node scripts/cloudflare.mjs deploy`）は変更しません。既定の `npx wrangler preview` は使用しないでください。プレビューを本番の保存先やシークレットから分離しているのは、このスクリプトです。
2. **動作を確認します。** ブランチを push し、ボットがプルリクエストに投稿したURLを開きます。使い捨てのサイトを作成し、ページを再読み込みしてください。ビルドの成功だけでは、プレビューが正常に動作している根拠にはなりません。

ローカル環境からプレビューを作成・更新する場合は、`npm run preview:deploy -- --name <名前>` を実行します。`npm run preview` は、エディタをローカルで起動するだけのコマンドです。

## プレビューの構成

`wrangler.jsonc` の `previews` ブロックにより、すべてのプレビューは**ログイン不要の公開デモ**として動作します。

- **ログインなし**: `ALLOW_ANONYMOUS=true` はプレビューにのみ適用され、本番のログイン設定は変わりません。URLを知っていれば誰でも編集できます。
- **サーバーの保存先なし**: D1・KV を明示的に空にしているため、サイトと画像はプレビューのURLごとにブラウザ内に保存されます。別の端末からの編集、サーバーへのアップロード、同時編集は利用できません。使い捨てのデータを使用してください。
- **本番から何も引き継がない**: プレビューごとに専用の Durable Object の保存領域が割り当てられます。本番の変数とシークレットはコピーされず、プレビューの作成時にダッシュボードの Preview Base の設定も継承しません。ただし、既存のプレビューにすでに設定されているシークレットは、そのまま残ります。

## テスト用の保存先の使用（任意）

プレビューで共有のサーバー保存先を使用する手順は次のとおりです。

1. **本番とは別の** D1 データベースと KV 名前空間を作成します。
2. 設定ファイルから、空の `previews.d1_databases` と `previews.kv_namespaces` の配列を削除します。これらが残っている限り空の配列が優先され、プレビューはブラウザ内の保存のままになります。
3. ID をビルド変数 `PREVIEW_D1_DATABASE_ID` と `PREVIEW_KV_NAMESPACE_ID` で渡すか、非公開の設定ファイル（`wrangler.local.jsonc` または `WRANGLER_CONFIG` で指定したファイル）の `previews` にバインディングを記述します。データベースのテーブルは初回アクセス時に自動で作成されます。

同じ ID を使用するブランチ同士は、データを共有します。プレビューにサーバーの保存先を持たせた場合は、匿名アクセスのままにしないでください。`previews.vars` から `ALLOW_ANONYMOUS` を削除し、プレビュー自体に設定したシークレット、プレビュー専用の OAuth コールバックURL、対象を絞った許可リストによってログインを設定してください。

## スクリプトが拒否する設定

`scripts/cloudflare-preview.mjs` は、元の設定ファイルと同じ場所に `wrangler.preview.generated.jsonc` を生成し（このリポジトリでは Git の管理対象外）、それを使用して `wrangler preview` を実行します。次のいずれかに該当する場合は、デプロイせずにエラーで停止します。

- プレビューの D1 または KV の ID が未設定、プレースホルダのまま、または本番の ID と同一である。
- `COLLAB_ROOM` がプレビュー自身の `CollaborationRoom` に結び付いていない、別の Worker を参照している、またはマイグレーションでクラスを移管している。
- `previews` に、分離の方法が定義されていない設定が含まれている。
- OpenNext の設定で、既定のダミー以外のキャッシュ、キュー、スキュー保護を使用している。
- Worker 名が、Workers Builds のデプロイ対象と一致しない。
- `--name`・`--tag`・`--message`・`--json` 以外の引数が渡された。

これらのチェックの対象は、スクリプトに渡された設定ファイルのみです。Cloudflare のダッシュボードで行った設定は確認できないため、判断に迷う場合はダッシュボードで実際のバインディングを確認してください。

## 参考資料（2026-11-06 確認）

- [Worker Previews の設定](https://developers.cloudflare.com/workers/previews/get-started/)
- [本番以外のブランチのビルド](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [プレビューの設定とシークレット](https://developers.cloudflare.com/workers/previews/configuration/)
- [リソースと分離](https://developers.cloudflare.com/workers/previews/resources/)
