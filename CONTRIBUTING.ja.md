# Tsumu への貢献

[English](CONTRIBUTING.md) · 日本語

[abshrimp/tsumu](https://github.com/abshrimp/tsumu) への貢献を歓迎します。不具合の報告、ドキュメントの改善、翻訳、プルリクエストは、日本語・英語のどちらでも受け付けています。

## 開発環境の準備

リポジトリをフォークしてクローンし、次のコマンドを実行します。

```sh
npm ci
npm run dev
```

動作環境と任意の外部サービスは [README](README.ja.md) を、コードの全体像は [ARCHITECTURE.ja.md](ARCHITECTURE.ja.md) を参照してください。

ローカルでの開発に API キーは不要です。環境変数は `.env.local` に、Cloudflare のリソース ID は `wrangler.local.jsonc` に記述してください。いずれも Git の管理対象外です。

## 変更時の留意事項

- **1つのプルリクエストでは1つの問題のみを扱い**、変更後の動作を説明してください。
- **動作を変更する場合は、回帰テストを追加してください。** 単体テストは `tests/` に、ブラウザでのテストは `e2e/` に配置します。
- **画面の文言の原文は英語で `tr()` に指定してください。コードのコメントは英語でも日本語でも構いません。** 日本語訳の追加は歓迎しますが、**PRでは必須ではありません**。未翻訳の文言は実行時に英語で表示され、CIでは警告になります。新しい言語は、辞書ファイルを追加するだけで対応できます。
- **Tsumu のデータ形式と実行時の動作を、型定義・エディタ・生成コード・テストのあいだで食い違わないようにしてください。**
- **公開時に、利用者が作成したファイルを削除しないでください。** `_tsumu/` は、Tsumu の文書と公開の管理情報を置く専用のディレクトリです。

プルリクエストを作成する前に、次のチェックを実行してください。

```sh
npm run typecheck
npm test
npm run i18n:check -- --all   # 未翻訳箇所は警告（CIを失敗させない）
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

日本語訳の完全性を別途確認したい場合は、任意で `npm run i18n:check -- --strict ja` を実行できます。

Cloudflare と連携する部分を変更した場合は、`npm run build:worker` も実行してください。これらのチェックを実行しても、デプロイは行われません。

出力形式（`lib/export-formats.ts`・`lib/generator/`）を変更した場合は、影響するフレームワークのサンプルを生成し、ビルドできることを確認してください（CI では全フレームワークを TypeScript と JavaScript の両方で検証しています）。

```sh
node --import tsx scripts/smoke-export-build.mts <nextjs|react|vue|nuxt|sveltekit> [typescript|javascript]
(cd .generated-export-smoke && npm install && npm run build)
```

`lib/safe-fetch.ts` を変更した場合は、`node --import tsx scripts/sync-fetch-runtime.mts` で、書き出したサイトに組み込む複製（`lib/generator/safe-fetch-source.ts`）を再生成してください。

## 問題の報告

再現できる不具合や機能の提案は、[Issues](https://github.com/abshrimp/tsumu/issues) で受け付けています。報告の際は、次の情報を記載してください。

- 再現手順
- 期待した動作と、実際の動作
- 実行環境のバージョン、ブラウザ、デプロイ先

投稿前に、ログやスクリーンショットにトークン・メールアドレス・非公開のサイトの内容が含まれていないか確認してください。

セキュリティ上の脆弱性は、公開の Issue ではなく、[SECURITY.ja.md](SECURITY.ja.md) に記載した方法で報告してください。

## コミュニティ

参加者には [行動規範](CODE_OF_CONDUCT.md)（英語）の遵守をお願いしています。

貢献いただいた内容は、本リポジトリの [MIT ライセンス](LICENSE) で配布されます。
