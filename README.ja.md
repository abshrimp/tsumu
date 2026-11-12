<h1 align="center">Tsumu</h1>

<p align="center">
  <strong>Design freely. Build openly.</strong><br>
  オープンソースのノーコードWebサイトエディタ
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b57d0" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" alt="TypeScript 7">
  <img src="https://img.shields.io/badge/deploy-Cloudflare%20%7C%20Node.js%20%7C%20Docker-555" alt="Cloudflare・Node.js・Docker で動く">
  <img src="https://img.shields.io/badge/i18n-English%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E-555" alt="English と日本語">
  <a href="CONTRIBUTING.ja.md"><img src="https://img.shields.io/badge/PRs-welcome-2ea44f" alt="PRs welcome"></a>
</p>

<p align="center">
  <a href="https://tsumu.ebii.net"><strong>デモを試す</strong></a> · <a href="README.md">English</a> · 日本語
</p>

<p align="center">
  <img src="docs/screenshots/ja/editor.png" alt="Tsumu のビジュアルエディタ">
</p>

Tsumu を使うと、ドラッグなどの直感的な操作だけで Web サイトを作成できます。標準的なプロジェクトとして書き出し・公開できるため、**Tsumu に依存せず** 任意の環境でホスティングやコードの編集ができます。

## 特徴

- **ビジュアル編集**：Web の知識ゼロで、スタイル、ホバーなどでの状態変化、アニメーションまで編集できます。
- **ノーコードのスクリプト**：直感的なブロックの組み立てだけで JavaScript のコードが構築できます。
- **外部データ連携**：API から JSON を取得して利用できます。
- **インポート**：Tsumu のフォーマットはもちろん、既存の HTML やウェブサイトも編集可能な要素として取り込めます。
- **選べる出力形式**：Next.js・React・Vue・Nuxt・SvelteKit・HTML にの出力に対応。TypeScript・JavaScript、CSS の形式も選択可能。
- **GitHub への公開**：ボタンひとつで GitHub への公開ができます。本番・テスト用ブランチにも対応。
- **リアルタイム共同編集**：複数人での同時編集に対応。コメントも残すことができます。
- **AI による編集（任意）**：文章で指示してページを編集できます。
- **セルフホスト**：Cloudflare Workers・Node.js・Docker で動作します。
- **ヘルプと多言語 UI**：チュートリアル、図解付き Q&A、画面上のガイドを内蔵しています。

## スクリーンショット

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/ai.png" alt="AIにページの編集を頼む"><br><sub><b>AIに頼む</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/publish.png" alt="テストサイトと本番サイトを選べる公開画面"><br><sub><b>公開</b>: GitHubにpush</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/comments.png" alt="見出しに付けたコメント"><br><sub><b>コメント</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/help.png" alt="図解付きのヘルプ"><br><sub><b>ヘルプ内蔵</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/responsive.png" alt="スマホの見た目を編集"><br><sub><b>画面幅ごとの編集</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/scripts.png" alt="クリック時とページを開いたときのブロックを並べたスクリプト編集画面"><br><sub><b>ノーコードのスクリプト</b></sub></td>
  </tr>
</table>

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

Tsumu から公開（push）するには、公開先の GitHub リポジトリを作成し、そのリポジトリに **Contents: Read and write** 権限を持つ fine-grained トークンを `GITHUB_TOKEN` に設定します。サイトの設定で公開先のリポジトリを選択してください。ZIP の書き出しにはトークンは不要です。

エディタは **Cloudflare Workers**・**Node.js**・**Docker** で動作します。サーバーに保存するには、Cloudflare では D1・Durable Objects・KV、Node.js・Docker では `TSUMU_DATA_DIR` を設定します。サーバーの保存先がない場合、編集データはブラウザ内だけに保存されます。

> [!IMPORTANT]
> エディタをインターネットに公開する前に、[Google ログイン](docs/user-guide.ja.md#googleログイン)を設定してください。ログインが未設定の場合、`npm run dev` または `ALLOW_ANONYMOUS=true` で起動すると、アクセスできる人は誰でも編集でき、GitHub トークンが設定されていれば公開もできます。

デプロイ手順、認証、出力形式、環境変数、バックアップ、制限事項は[詳細ガイド](docs/user-guide.ja.md)を参照してください。

## ドキュメント

- [詳細ガイド](docs/user-guide.ja.md) · [English](docs/user-guide.md)
- [設計](ARCHITECTURE.ja.md) · [環境変数](.env.example)
- [コントリビュート](CONTRIBUTING.ja.md) · [セキュリティ](SECURITY.ja.md) · [行動規範](CODE_OF_CONDUCT.md)

## ライセンス

[MIT](LICENSE) © abshrimp
