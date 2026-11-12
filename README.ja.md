<h1 align="center">Tsumu</h1>

<p align="center">
  <strong>Design freely. Build openly.</strong><br>
  オープンソースのビジュアルウェブサイトビルダー。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b57d0" alt="MIT License"></a>
  <a href="https://tsumu.ebii.net"><strong>デモを試す</strong></a> · <a href="README.md">English</a> · 日本語
</p>

<p align="center">
  <img src="docs/screenshots/ja/editor.png" alt="Tsumu のビジュアルエディタ">
</p>

Tsumu は、キャンバス上でウェブサイトを制作し、標準的なプロジェクトとして書き出し・公開できるエディタです。公開したサイトは **Tsumu に依存せず**、任意の環境でホスティングやコードの編集ができます。

## 特徴

- **ビジュアル編集**：画面幅ごとのレイアウトやスタイル、コンポーネント、独自の状態。
- **コード不要の動作設定**：スクリプトブロック、外部 JSON、リスト、動的ページ。
- **読み込みと書き出し**：Tsumu の ZIP・`doc.json`・HTML の読み込み、Next.js・React・Vue・Nuxt・SvelteKit・HTML 形式の出力。
- **GitHub 公開**：本番・プレビュー用ブランチ、公開前チェック、履歴とロールバック。
- **共同編集**：リアルタイム編集、コメント、操作履歴。
- **任意の AI 編集機能**、ヘルプ、日本語・英語の UI。
- **セルフホスト**：Cloudflare Workers・Node.js・Docker に対応し、複数サイトを管理可能。

## ローカルで起動

**Node.js 26.12.1 以上**、**npm 12.2.1 以上**が必要です。

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

[http://localhost:3000](http://localhost:3000) にアクセスしてサイトを作成します。ローカル開発では API キーやログイン設定は不要です。

## 公開とデプロイ

公開するには GitHub リポジトリを作成し、**Contents: Read and write** 権限を持つ fine-grained トークンを `GITHUB_TOKEN` に設定して、サイトの設定から公開先を選択します。ZIP の書き出しにはトークンは不要です。

エディタは **Cloudflare Workers**・**Node.js**・**Docker** で動作します。サーバーに保存するには、Cloudflare では D1・Durable Objects・KV、Node.js・Docker では `TSUMU_DATA_DIR` を設定します。サーバーの保存先がない場合、編集データはブラウザ内だけに保存されます。

> [!IMPORTANT]
> インターネットに公開する場合は Google ログインを設定してください。`npm run dev` はログインを省略し、`ALLOW_ANONYMOUS=true` の場合も URL を知っている人なら誰でも編集・公開できます。匿名アクセスはローカル環境か隔離されたデモに限って使用してください。

デプロイ手順、認証、出力形式、環境変数、バックアップ、制限事項は[詳細ガイド](docs/user-guide.ja.md)を参照してください。

## ドキュメント

- [詳細ガイド](docs/user-guide.ja.md) · [English](docs/user-guide.md)
- [設計](ARCHITECTURE.ja.md) · [環境変数](.env.example)
- [コントリビュート](CONTRIBUTING.ja.md) · [セキュリティ](SECURITY.md) · [行動規範](CODE_OF_CONDUCT.md)

## ライセンス

[MIT](LICENSE) © abshrimp
