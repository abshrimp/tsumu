# Tsumu への貢献

[English](CONTRIBUTING.md) · 日本語

[abshrimp/tsumu](https://github.com/abshrimp/tsumu) への貢献を歓迎します。不具合の報告、ドキュメントの改善、翻訳、プルリクエストは、日本語・英語のどちらでも受け付けています。

## 開発環境の準備

リポジトリをフォークしてクローンし、次のコマンドを実行します。

```sh
npm ci
npm run dev
```

動作環境と任意の外部サービスは[詳細ガイド](../docs/user-guide.ja.md)を、コードの全体像は [ARCHITECTURE.ja.md](../docs/ARCHITECTURE.ja.md) を参照してください。

ローカルでの開発に API キーは不要です。環境変数は `.env.local` に、Cloudflare のリソース ID は `wrangler.local.jsonc` に記述してください。いずれも Git の管理対象外です。

## 変更時の留意事項

- **1つのプルリクエストでは1つの問題のみを扱い**、変更後の動作を説明してください。
- **動作を変更する場合は、回帰テストを追加してください。** 単体テストは `tests/` に、ブラウザでのテストは `e2e/` に配置します。ブラウザでのテストについては [`e2e/README.md`](../e2e/README.md)（英語）を参照してください。
- **画面に表示する文言は、英語の原文を `tr()` に指定してください。** コードのコメントは英語でも日本語でも構いません。日本語訳の追加は歓迎しますが、PR への追加は必須ではありません。未翻訳の文言は実行時に英語で表示され、CIでは警告になります。新しい言語は、辞書ファイルを追加するだけで対応できます。
- **型定義、エディタ、生成コード、テストで、Tsumu のデータ形式と実行時の動作が一致するようにしてください。**
- **公開時に、利用者が作成したファイルを削除しないでください。** `_tsumu/` は、Tsumu の文書と公開の管理情報を置く専用のディレクトリです。

### 変更内容の確認

初めてのPRでは、**ローカルで全テストを実行したり、すべてのブラウザをインストールしたりする必要はありません**。変更内容に関係するチェックを実行してください。PR作成後はGitHub Actionsで全体のチェックが実行されます。

- **ドキュメントのみの変更：** Markdownの表示とリンクを確認してください。ローカルでのビルドやブラウザテストは不要です。
- **翻訳の変更：** `npm run i18n:check -- --all` を実行してください（未翻訳箇所は警告のみです）。
- **TypeScriptや実行処理の変更：** `npm run typecheck` と関連する単体テストを実行してください。スクリプトエンジンの変更では、例えば `node --import tsx --test tests/scripts-engine.test.mts` を使用できます。
- **UIやブラウザ動作の変更：** 可能であれば `npm run build` と `npx playwright install chromium` の後、関連するPlaywrightテストを実行してください。例：`npm run test:e2e -- e2e/page-kind-confirmation.spec.ts --project=chromium`。詳しくは [`e2e/README.md`](../e2e/README.md)（英語）をご覧ください。
- **コード生成やデプロイ関連の変更：** 下記のビルド・スモークテストを必要に応じて実行してください。Cloudflare関連の変更では `npm run build:worker` も実行します。

ローカルで全テストを実行する場合は、次のコマンドを使用します。

```sh
npm run typecheck
npm test
npm run i18n:check -- --all
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
```

CIではWorkerのビルド、生成プロジェクトの形式、その他の結合テストも確認します。変更に関連するCIの失敗はマージ前に修正してください。日本語訳の網羅率は `npm run i18n:check -- --strict ja` で別途確認できます（任意）。これらのコマンドでデプロイされることはありません。

### 生成したプロジェクトの確認

リポジトリのルートで `npm ci` を実行した後、同じディレクトリで次の例を実行します。TypeScript と通常の CSS を使う Vue プロジェクトを生成し、ビルドして、サーバーが返す HTML を確認できます。

```sh
node --import tsx scripts/smoke-export-build.mts vue typescript css
(cd .generated-export-smoke && npm install --no-audit --no-fund && npm run build)
node --import tsx scripts/check-generated-ssr.mts vue
```

生成のたびに `.generated-export-smoke/` の内容が置き換わります。Vue のビルド結果はその中の `dist/client/` と `dist/server/` に出力されます。最後のコマンドは生成したサーバーを `127.0.0.1:48730` で起動し、HTTP レスポンスにサンプルの見出し、リストの行、再利用コンポーネントが含まれることを確かめて終了します。

別の構成でビルドするには、生成コマンドの3つの引数を変更します。フレームワークは `nextjs`、`react`、`vue`、`nuxt`、`sveltekit`、言語は `typescript` と `javascript`、スタイルは `css`、`css-modules`、`tailwind` に対応しています。SSR の確認は Vue、Nuxt、SvelteKit に対応しているので、直前にビルドしたフレームワーク名を指定してください。

`lib/safe-fetch.ts` を変更した場合は、`node --import tsx scripts/sync-fetch-runtime.mts` を実行し、書き出したサイトに組み込むコードの複製（`lib/generator/safe-fetch-source.ts`）を再生成してください。

## 問題の報告

再現できる不具合や機能の提案は、[Issues](https://github.com/abshrimp/tsumu/issues) で受け付けています。報告の際は、次の情報を記載してください。

- 再現手順
- 期待した動作と、実際の動作
- 実行環境のバージョン、ブラウザ、デプロイ先

投稿前に、ログやスクリーンショットにトークン・メールアドレス・非公開のサイトの内容が含まれていないか確認してください。

セキュリティ上の脆弱性は、公開の Issue ではなく、[SECURITY.ja.md](SECURITY.ja.md) に記載した方法で報告してください。

## コミュニティ

参加者には [行動規範](CODE_OF_CONDUCT.md)（英語）の遵守をお願いしています。

貢献いただいた内容は、本リポジトリの [MIT ライセンス](../LICENSE) で配布されます。
