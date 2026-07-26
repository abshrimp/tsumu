# Tsumu への貢献

[English](CONTRIBUTING.md) · 日本語

[abshrimp/tsumu](https://github.com/abshrimp/tsumu) への貢献を歓迎します。不具合の報告、ドキュメントの改善、翻訳、プルリクエストのいずれも、日本語・英語のどちらで送っていただいても構いません。

## 開発の始め方

リポジトリをフォークしてクローンし、次のコマンドを実行します。

```sh
npm ci
npm run dev
```

動作に必要な環境と、任意で使える外部サービスは [README](README.ja.md) に、コード全体の構成は [ARCHITECTURE.ja.md](ARCHITECTURE.ja.md) にまとめています。

ローカルでの開発に API キーは要りません。環境変数は `.env.local` に、Cloudflare のリソース ID は `wrangler.local.jsonc` に書いてください。どちらも Git では管理しないファイルです。

## 変更するときのお願い

- **1つのプルリクエストでは1つの問題を扱い**、変更によって動作がどう変わるかを説明してください。
- **動作を変える場合は、回帰テストも追加してください。** 単体テストは `tests/` に、ブラウザでのテストは `e2e/` に置きます。
- **画面の文言とコードのコメントは日本語で書きます。** 画面の文言は `tr()` で囲み、英訳を `lib/locales/` に追加してください。
- **形式は現在の Tsumu のものだけを扱います。** 公開前の旧形式に合わせるための互換処理は不要です。
- **サイトを公開するときは、利用者が作ったファイルを消さないようにしてください。** `_tsumu/` は、Tsumu が文書と公開の管理情報を置くための専用のディレクトリです。

プルリクエストを出す前に、次のチェックを実行してください。

```sh
npm run typecheck
npm test
npm run i18n:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Cloudflare 連携の部分に手を入れた場合は、`npm run build:worker` もあわせて実行してください。これらのチェックがデプロイを行うことはありません。

出力形式（`lib/export-formats.ts`・`lib/generator/`）に手を入れた場合は、影響するフレームワークのサンプルを生成してビルドしてください（CI では、すべてのフレームワークを TypeScript と JavaScript の両方で確認しています）。

```sh
node --import tsx scripts/smoke-export-build.mts <nextjs|react|vue|nuxt|sveltekit> [typescript|javascript]
(cd .generated-export-smoke && npm install && npm run build)
```

`lib/safe-fetch.ts` を変更した場合は、`node --import tsx scripts/sync-fetch-runtime.mts` で、書き出すサイトに埋め込む写し（`lib/generator/safe-fetch-source.ts`）を作り直してください。

## 問題の報告

再現できる不具合や機能の提案は、[Issues](https://github.com/abshrimp/tsumu/issues) で受け付けています。報告の際は、次の内容を書いていただけると調査がはかどります。

- 再現する手順
- 本来期待した動作と、実際に起きたこと
- 実行環境のバージョン、ブラウザ、デプロイ先

ログやスクリーンショットにトークン・メールアドレス・非公開のサイトの内容が含まれていないか、投稿前に確認してください。

セキュリティ上の脆弱性は、公開の Issue ではなく [SECURITY.ja.md](SECURITY.ja.md) の方法で報告してください。

## コミュニティ

参加される方には、[行動規範](CODE_OF_CONDUCT.md)（英語）を守っていただくようお願いしています。

貢献していただいた内容は、このリポジトリの [MIT ライセンス](LICENSE) で配布されます。
