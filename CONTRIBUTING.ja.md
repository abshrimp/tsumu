# Tsumu への貢献

[English](CONTRIBUTING.md) · 日本語

Tsumu に関心をお寄せいただき、ありがとうございます。リポジトリは [abshrimp/tsumu](https://github.com/abshrimp/tsumu) です。不具合の報告、ドキュメントの改善、翻訳、プルリクエストを、英語・日本語のいずれでも歓迎します。

## 始め方

リポジトリをフォークしてクローンし、次を実行します。

```sh
npm ci
npm run dev
```

- 動作環境と任意の外部サービスについては [README](README.ja.md) を参照してください。
- コードの案内図は [ARCHITECTURE.ja.md](ARCHITECTURE.ja.md) にあります。

ローカルでの開発に API キーは不要です。環境変数は `.env.local` に、Cloudflare のリソースの ID は `wrangler.local.jsonc` に記述してください。どちらも Git の管理対象外です。

## 変更の進め方

- **プルリクエストは1つの問題に絞り**、変更後の動作を説明してください。
- **動作を変更した場合は回帰テストを追加してください。** 単体テストは `tests/`、ブラウザのテストは `e2e/` に置きます。
- **画面の文言とコードのコメントは日本語で記述します。** 画面の文言は `tr()` で囲み、`lib/locales/` に英訳を追加してください。
- **現在の Tsumu の形式を正とします。** 公開前の前身の形式との互換処理は追加しないでください。
- **サイトの公開時は、利用者が作成したファイルを保持してください。** `_tsumu/` は、Tsumu の文書と公開の管理情報専用です。

プルリクエストを作成する前に、次を実行してください。

```sh
npm run typecheck
npm test
npm run i18n:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Cloudflare との連携部分を変更した場合は、`npm run build:worker` も実行してください。これらのチェックは何もデプロイしません。デプロイは別の手順です。

## 問題の報告

再現できる不具合や機能の提案は、[Issues](https://github.com/abshrimp/tsumu/issues) に投稿してください。次の情報を含めてください。

- 再現の手順
- 期待した動作と、実際の動作
- 実行環境のバージョン、ブラウザ、デプロイ先

ログやスクリーンショットを投稿する前に、トークン、メールアドレス、非公開のサイトの内容を取り除いてください。

セキュリティ上の脆弱性は、[SECURITY.ja.md](SECURITY.ja.md) の手順で報告してください。公開の Issue に攻撃の詳細を書かないでください。

## コミュニティ

参加するすべての人は、[行動規範](CODE_OF_CONDUCT.md)（英語）に従ってください。

貢献した内容は、このリポジトリの [MIT ライセンス](LICENSE) のもとで配布されます。
