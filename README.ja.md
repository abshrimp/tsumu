<h1 align="center">Tsumu</h1>

<p align="center">
  <strong>Design freely. Build openly.</strong><br>
  An open-source visual website builder.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0b57d0" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" alt="TypeScript 7">
  <img src="https://img.shields.io/badge/deploy-Cloudflare%20%7C%20Node.js%20%7C%20Docker-555" alt="Cloudflare・Node.js・Docker で動く">
  <img src="https://img.shields.io/badge/i18n-English%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E-555" alt="English と日本語">
  <a href="#コントリビュート"><img src="https://img.shields.io/badge/PRs-welcome-2ea44f" alt="PRs welcome"></a>
</p>

<p align="center">
  <a href="https://tsumu.ebii.net"><strong>デモを試す</strong></a> · <a href="README.md">English</a> · 日本語
</p>

<p align="center">
  <img src="docs/screenshots/ja/editor.png" alt="Tsumu のエディタ。左にレイヤー、中央にキャンバス、右にスタイルの設定">
</p>

Tsumu は、ウェブサイトを構築するためのビジュアルエディタです。キャンバス上でページのレイアウトとスタイルを編集し、**標準的な Next.js プロジェクト**として GitHub リポジトリに公開します。

公開したサイトは実行時に Tsumu へ依存しないため、ロックインは発生しません。Vercel・Netlify・Cloudflare Workers・Node.js サーバーなど、任意の環境でホスティングできます。サイトのリポジトリに手動で追加したファイル（APIルート・コンポーネント・設定など）は次回の公開後も保持されるため、エディタでの編集とコードの記述を併用できます。

1つのエディタで複数のサイトを管理できます。サイトごとに編集データと公開先のリポジトリを持ち、作成・複製・切り替えはホーム画面から行います。

## 特徴

- **ロックインのないコード**: 公開したサイトは可読性の高い標準的な Next.js で、依存パッケージは `next`・`react`・`react-dom` のみです。
- **ビジュアル編集**: フレックスボックスとグリッドによるレイアウト、画面幅ごとのスタイル、ホバーなどの状態、モーション、コンポーネント、リストに対応しています。
- **コード不要のスクリプト**: 「きっかけ → 動作」のブロックを組み合わせて、クリック・メニューの開閉・スクロール・入力・絞り込み・並べ替え・保存などの動作を作成できます。
- **外部データ**: 任意のAPIから取得したJSONをリストに表示し、項目ごとの詳細ページ（`/news/[slug]` など）を生成できます。
- **同時編集**: 複数人による同時編集に対応し、変更は要素の項目単位でマージされます。キャンバスへのコメントや、編集・公開した人の確認も可能です。
- **GitHub経由の公開**: 生成したプロジェクトをワンクリックでコミットします。テスト公開は、検索エンジンにインデックスされないプレビュー用ブランチに対して行います。
- **公開前チェック**: リンク切れ、画像の代替テキストの欠落、見出しの順序の不備、スマートフォンで小さすぎる文字、スマートフォンでのレイアウトのはみ出しを、公開前に検出します。
- **履歴とロールバック**: 公開したサイトを、過去に公開した任意の版に戻せます。エディタの編集内容も、公開した版またはサーバーの日次バックアップから復元できます。
- **AIに頼む（任意）**: 変更内容を文章で指示すると、AIがページを編集します。1回の「元に戻す」で取り消せます。Claude・Gemini・OpenAI・OpenAI互換APIに対応しています。
- **ヘルプ内蔵**: チュートリアル、目的から検索できる図解付きのQ&A、画面上の操作箇所を示すガイドを備えています。
- **複数のサイト**: サイトの作成・複製・削除に対応しています。要素やページは、使用している画像・コンポーネントとあわせて別のサイトへコピーできます。
- **任意の環境で動作**: エディタは Cloudflare Workers（無料プランで運用可能）・Node.js・Docker のいずれでも動作し、外部サービスはすべて任意です。
- **日本語・英語のUI**（他言語の追加にも対応）

## スクリーンショット

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/ai.png" alt="AIにページの編集を頼む"><br><sub><b>AIに頼む</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/publish.png" alt="テストサイトと本番サイトを選べる公開画面"><br><sub><b>公開</b>: チェックのあと、テストサイトか本番へ</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/comments.png" alt="見出しに付けたコメント"><br><sub><b>コメント</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/help.png" alt="図解つきのヘルプ"><br><sub><b>ヘルプ内蔵</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/responsive.png" alt="スマホの見た目を編集"><br><sub><b>画面幅ごとの編集</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/scripts.png" alt="スクリプト画面"><br><sub><b>コードを書かないスクリプト</b></sub></td>
  </tr>
</table>

## 構成

```
Tsumu（このリポジトリ）
│  Cloudflare Workers ／ Node.js ／ Docker のどれかで動かす
│  ホーム（サイトの一覧）・エディタ /sites/<id>・Googleログイン（任意）
│
│  公開 → main ／ テスト公開 → preview
▼
サイトごとのリポジトリ（GitHub）
│  サイトA・サイトB・…（それぞれ main が本番、preview がテスト）
│
│  ブランチごとに自動でビルド
▼
ホスティング（自由に選べる）
   Vercel / Netlify / Cloudflare Workers / Node.js
```

構成要素は次の3つです。

- **エディタ**: Next.js のアプリケーションで、Cloudflare Workers・Node.js・Docker のいずれでも動作します（[エディタのデプロイ](#エディタのデプロイ)）。サイトの一覧、編集データ、コメント、編集と公開の記録、ログインの許可リスト、およびアップロードした画像・動画・音声を保存します。アップロードしたファイルは全サイトで共有されます。保存先は、エディタの実行環境に応じて決まります。
- **公開サイト**: サイトごとのリポジトリにコミットされる標準的な Next.js アプリケーションです。エディタと同じ環境で動作させる必要は**ありません**。
- **テスト公開**: 同じリポジトリの別のブランチ（既定は `preview`）にコミットします。Vercel・Cloudflare Workers Builds・Netlify は本番以外のブランチを自動的にプレビューとしてビルドするため、1つのホスティング設定で本番とテストの両方に対応できます。テスト版は robots.txt・`noindex`・`X-Robots-Tag` ヘッダー・クローラーの拒否により、検索エンジンの対象外としています。

## 環境設定

以下の設定はいずれも**任意**です。未設定の項目があってもエディタは起動し、編集も可能です。その設定を必要とする機能のみが利用できなくなります。

| 設定 | 未設定の場合 | 設定した場合 |
|---|---|---|
| サーバーの保存先（Cloudflare は D1・KV、Node.js・Docker は `TSUMU_DATA_DIR`） | サイトの一覧・編集データ・コメント・画像などをブラウザ内に保存します。参照できるのはそのブラウザのみで、画像は1ファイルあたり2MBまでです。 | サーバーに保存します。別の端末からの編集や、複数人での編集・コメントが可能になります。日次バックアップと、編集・公開した人の記録も保存されます。画像は1ファイルあたり25MBまでです。 |
| Googleログイン（`AUTH_*`） | エディタは起動せず、設定方法の案内を表示します。`ALLOW_ANONYMOUS=true` の場合と `npm run dev` ではログインなしで利用できますが、**URLを知っていれば誰でも編集・公開が可能になります**。 | 許可したGoogleアカウントのみが利用できます。 |
| `GITHUB_TOKEN` | 「公開」で必要な設定を案内します。zip での書き出しは可能です。 | サイトの設定で指定したリポジトリに公開できます。 |
| `AI_*` | 「AIに頼む」ボタンは表示されません。 | 「AIに頼む」を利用できます。 |

> [!IMPORTANT]
> インターネットからアクセス可能なエディタには、必ずGoogleログインを設定してください。ログインなしでの運用は、ローカル環境のみで使用する場合か、公開先（`GITHUB_TOKEN`）を設定しないデモに限定してください。

## ローカルで起動

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使用している場合は、クローン後に `nvm use` を実行してください。

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

http://localhost:3000 を開くと、ホーム画面（サイトの一覧）が表示されます。「新しいサイト」を選択するとサイトが作成され、`/sites/<id>` でエディタが開きます。

`npm run dev` の動作は次のとおりです。

- `wrangler.jsonc` をもとに、Cloudflare の D1・KV をローカルで再現します。データは `.wrangler/state` に保存され、`TSUMU_DATA_DIR` より優先されます。
- 環境変数がなくても動作し、ログインは省略されます。これは `npm run dev` の場合のみです。`npm run preview` でもログインを省略するには、`.dev.vars` に `ALLOW_ANONYMOUS=true` を記述します。
- 他の編集者の変更はポーリングで反映されます。WebSocket によるリアルタイムの反映を確認する場合は、`npm run preview` を使用します。

## エディタのデプロイ

エディタは次の3つの環境のいずれでも動作します。機能は共通で、異なるのはデータの保存先と、他の編集者の変更を反映する方式のみです。

| | Cloudflare Workers | Node.js | Docker |
|---|---|---|---|
| 保存先 | D1（データベース）・Workers KV（画像など） | `TSUMU_DATA_DIR` のフォルダ（SQLite・ファイル） | コンテナの `/data`（ボリュームをマウント） |
| 他の編集者の変更の反映 | 即時（WebSocket・Durable Object） | 即時（Server-Sent Events） | 即時（Server-Sent Events） |
| 費用 | 無料プランで運用可能（[制限事項](#制限事項)） | サーバー費用 | サーバー費用 |
| 適した用途 | 自前のサーバーを持たずに運用したい場合 | ローカル環境や既存のサーバーで運用したい場合 | コンテナで管理したい場合 |

いずれの環境でも、データベースのテーブルは初回アクセス時に自動で作成されるため、マイグレーションは不要です。サーバーの保存先を用意しない場合、データはブラウザ内に保存されます（[環境設定](#環境設定)）。

### 共通の準備

#### Googleログイン

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で、種類を「ウェブ アプリケーション」とした OAuth クライアントIDを作成します。
2. 承認済みのリダイレクトURIに次を追加します。
   - `https://<エディタのドメイン>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`（ローカル環境でログインを試す場合のみ）
3. OAuth 同意画面はテストモードのままで問題ありません。自身をテストユーザーに追加してください。

`AUTH_SECRET`・`AUTH_GOOGLE_ID`・`AUTH_GOOGLE_SECRET` の3つをすべて設定すると、ログインが有効になります。あわせて `AUTH_URL` にエディタのURLを設定してください。

`ALLOWED_EMAILS` に記載したアカウントは常にログインできます。それ以外のアカウントを許可する場合は、ホーム画面の **設定 → ログインできるアカウント** で追加します（サーバーの保存先が必要です）。

#### GitHubのトークン

**Fine-grained personal access token** を作成し、公開に使用するすべてのリポジトリに **Contents: Read and write** の権限を付与します。トークンは全サイトで共通のため、サイトを追加した際はそのリポジトリもトークンの対象に追加してください。対象を「All repositories」に設定しておけば、個別の追加は不要です。

公開先のリポジトリは、ホーム画面の **サイトの「…」→ 設定** でサイトごとに指定します（[サイトの公開先](#サイトの公開先)）。

### Cloudflare Workers

**1. 保存先の作成（任意）**

```bash
npx wrangler login
cp wrangler.jsonc wrangler.local.jsonc
npx wrangler d1 create tsumu                  # 表示された database_id を wrangler.local.jsonc に設定
npx wrangler kv namespace create ASSETS_KV    # 表示された id を wrangler.local.jsonc に設定
```

`wrangler.local.jsonc` は Git の管理対象外のため、リソースのIDがリポジトリに含まれることはありません。このファイルが存在する場合、`npm run dev`・`npm run preview`・`npm run deploy` は自動的にこれを使用します（別のファイルを使用する場合は、環境変数 `WRANGLER_CONFIG` で指定します）。

IDが設定されていないバインディングは、デプロイ時に除外されます。そのため、D1 のみ、KV のみを作成した場合や、いずれも作成しない場合でもデプロイできます。

**2. シークレットの設定とデプロイ**

必要な変数を `npx wrangler secret put <名前>` で設定します（[環境変数](#環境変数)）。`wrangler.local.jsonc` を使用している場合は、`--config wrangler.local.jsonc` を付けてください。設定後、デプロイします。

```bash
npm run deploy
```

#### push ごとの自動デプロイ（Workers Builds）

Cloudflare Workers Builds で自動デプロイを行う場合は、リポジトリを接続し、次のとおり設定します。

- Build command: `node scripts/cloudflare.mjs build`
- Deploy command: `node scripts/cloudflare.mjs deploy`
- Preview command: `node scripts/cloudflare-preview.mjs`（下記参照）
- ビルド変数（任意。Settings → Build → Variables and secrets）: `D1_DATABASE_ID`・`KV_NAMESPACE_ID`

ビルド時に、スクリプトが `wrangler.jsonc` からデプロイ用の設定ファイル `wrangler.generated.jsonc` を生成します。ビルド変数のIDを埋め込み、IDのないバインディングは除外するため、IDをコミットする必要はありません。

#### プルリクエストのプレビュー（Worker Previews）

上記の Preview command を設定すると、Workers Builds はプルリクエストごとに **Worker Preview** をデプロイし、そのURLをプルリクエストに投稿します。プレビューはログイン不要の公開デモで、データはブラウザ内に保存され、本番の保存先やシークレットは使用しません。

設定方法とテスト用の保存先の指定方法は、[エディタのプルリクエストのプレビュー](docs/worker-previews.ja.md) を参照してください。

### Node.js

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使用している場合は、クローン後に `nvm use` を実行してください。

環境変数 `TSUMU_DATA_DIR` にフォルダを指定すると、データを `<フォルダ>/tsumu.db`（SQLite）に、アップロードしたファイルを `<フォルダ>/assets/` に保存します。Node.js に組み込みの `node:sqlite` を使用するため、追加のインストールは不要です。

```bash
npm ci
npm run build
TSUMU_DATA_DIR=./data npm start
```

ログインを設定せずにローカルで試す場合は、`ALLOW_ANONYMOUS=true` を付けます。

```bash
ALLOW_ANONYMOUS=true TSUMU_DATA_DIR=./data npm start
```

その他の環境変数は、`.env.local` またはサーバーの環境変数で設定します（[環境変数](#環境変数)）。ポートは `PORT` で変更できます（既定は 3000）。

**運用上の注意**

- **バックアップ**: `TSUMU_DATA_DIR` のフォルダ全体をコピーします。SQLite は直近の書き込み内容を `tsumu.db-wal` にも保持しているため、`tsumu.db`・`tsumu.db-wal`・`tsumu.db-shm` をまとめてコピーしてください。可能であれば、エディタを停止してから行うことを推奨します。
- **1つのフォルダにつき1つのエディタ**: 同じ `TSUMU_DATA_DIR` を使用するエディタは、1つだけ起動してください。他の編集者の変更の通知は、単一のプロセス内で配信しています。
- **リバースプロキシ（nginx など）を使用する場合**:
  - `AUTH_URL` に外部からアクセスするURLを設定し、プロキシで `X-Forwarded-Host` と `X-Forwarded-Proto` を転送してください。設定しない場合、Googleログイン後に正しいアドレスへ戻りません。
  - `/api/collab/events` の応答は、バッファリングせずにそのまま転送するよう設定してください。nginx の場合は、応答に付与される `X-Accel-Buffering: no` ヘッダーにより自動的にそのように動作します。

### Docker

イメージには Node.js 版のエディタが含まれており、データはコンテナ内の `/data` に保存します。

```bash
docker build -t tsumu .
docker run -d --name tsumu -p 3000:3000 -v tsumu-data:/data --env-file .env.local tsumu
```

ログインを設定せずにローカルで試す場合は、`-e ALLOW_ANONYMOUS=true` を付けます。

環境変数は `--env-file`（または `-e`）で渡します（[環境変数](#環境変数)）。渡すファイルには `TSUMU_DATA_DIR` を記述しないでください。記述すると、データがボリュームの外に保存されます。

**データの保存場所**

```
/data/
  tsumu.db, tsumu.db-wal, tsumu.db-shm   サイトの一覧・編集データ・コメント・バックアップなど（SQLite）
  assets/data/                            アップロードした画像・動画などの本体
  assets/meta/                            各ファイルの種類（Content-Type）
```

- `-v tsumu-data:/data` を指定すると、Docker の名前付きボリューム `tsumu-data` に保存します。コンテナを再作成しても、同じボリュームを指定すればデータは保持されます。
- ホスト上のフォルダに保存する場合は、`-v "$(pwd)/data:/data"` と指定します。コンテナは `node` ユーザー（UID 1000）で動作するため、Linux では事前にフォルダの所有者を変更してください（`sudo chown 1000:1000 data`）。
- **`-v` を指定せずに起動しないでください。** データが名前のないボリュームに保存され、コンテナを再作成すると参照できなくなります。

名前付きボリュームのバックアップ（コンテナを停止してから実行することを推奨します）:

```bash
docker stop tsumu
docker run --rm -v tsumu-data:/data -v "$(pwd)":/backup busybox tar czf /backup/tsumu-data.tgz -C /data .
docker start tsumu
```

リバースプロキシを使用する場合の設定は、[Node.js](#nodejs) と同様です。

## サイトの公開先

ホーム画面の **サイトの「…」→ 設定** で、サイトごとに次の項目を指定します。サイトの作成時、作成後のいずれでも設定できます。

| 項目 | 内容 |
|---|---|
| GitHubリポジトリ | `owner/name`。未指定でも編集は可能ですが、公開はできません。 |
| 本番のブランチ | 既定は `main` |
| テスト公開のブランチ | 既定は `preview`。空欄にするとテスト公開を無効にします。 |
| 本番サイトのURL・テストサイトのURL | 任意。指定すると、公開画面から各サイトを開けます。 |

公開先のリポジトリは、初回の公開前に作成しておきます。空のリポジトリ、README 付きで初期化したリポジトリのいずれでも問題ありません。

## 公開サイトのホスティング

初回の公開後、サイトのリポジトリをホスティングサービスに接続します。

| ホスティング | 設定 | テスト公開 |
|---|---|---|
| **Vercel** | リポジトリをインポートします。追加の設定は不要です。 | 本番以外のブランチに、自動でプレビューURLが付与されます。 |
| **Netlify** | リポジトリをインポートします。 | Branch deploys を有効にします。 |
| **Cloudflare Workers Builds** | Build: `npx opennextjs-cloudflare build`<br>Deploy: `npx opennextjs-cloudflare deploy` | [本番以外のブランチのビルド](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)を有効にします。公開サイトは保存先も Durable Object も持たないため、エディタのプレビュー用の設定は不要です。 |
| **Node.js** | `npm install && npm run build && npm start` | テスト公開のブランチは個別にビルドします。 |

### データの更新間隔と Cloudflare

外部のJSONを使用するページは、エディタの **サイト** タブで設定する **データの更新間隔** ごとに再生成されます。再生成の方式はホスティングによって異なります。

- **標準のホスティング**（Vercel・Netlify・Node.js）では、Next.js の ISR を使用します。ページは事前に生成され、バックグラウンドで再生成されます。
- **Cloudflare Workers** で ISR を使用するには、追加のキャッシュ（R2）とキューが必要です。これらがない場合、事前に生成したページは**再生成されません**。この問題を回避するには、エディタの **サイト** タブで **公開先のホスティング → Cloudflare Workers** を選択します。該当するページはリクエストごとに描画され、取得したJSONは更新間隔の間 Cloudflare のエッジにキャッシュされる形で書き出されます。

いずれのホスティングでも、更新間隔を `0` にするとリクエストごとにデータを取得します。

### ロールバック

**公開 → 公開履歴・ロールバック**（または **⋯ → 履歴**）に、ブランチごとのコミットが一覧表示されます。各版に対して、次の操作を行えます。

- **サイトを戻す**: 選択した版のファイルを、ブランチの先頭に新しいコミットとして積み直します。履歴は削除されないため、ロールバック自体も後から取り消せます。
- **編集内容を復元**: 公開時にあわせて保存された編集データ（`_tsumu/doc.json`）を、エディタに読み込みます。通常の編集として扱われるため、⌘Z で元に戻せます。

同じ画面には、サーバーが保存している編集データの日次バックアップも表示されます。曜日ごとに1つ、計7日分です。

## AIに頼む（任意）

`AI_ENABLED=true` とAPIキーを設定すると、**AIに頼む** ボタンが表示されます。リクエストはエディタのサーバーの `/api/ai` を経由するため、APIキーがブラウザに渡ることはありません。

### 仕組み

1. ブラウザが、編集中のページの要約（要素の階層・テキスト・スタイル）を送信します。他のページは名前のみを送信します。
2. サーバーが、エディタのデータ構造の説明と `edit_site` ツールを付加して、AIに渡します。
3. AIは編集操作（スタイルの変更、要素の追加や移動、テキストの変更など）を返します。
4. サーバーは、その操作をページの複製に試験的に適用します。失敗した操作がある場合は、エラーをAIに返して修正を求めます。
5. 正常に適用できた操作のみがブラウザに返され、1回で取り消せる変更として適用されます。

スクリプト・データの設定・アセットは、AIによる編集の対象外です。

### プロバイダの選択

| `AI_PROVIDER` | APIキー | `AI_MODEL` の既定 | 備考 |
|---|---|---|---|
| `anthropic`（既定） | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `claude-sonnet-5-5`・`claude-haiku-5-5` を指定すると費用を抑えられます |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` | Gemini の OpenAI 互換APIを使用します。最も安価なのは `gemini-2.5-flash-lite` で、無料枠があります |
| `openai` | `OPENAI_API_KEY` | `AI_MODEL` で指定 | |
| `openai-compatible` | `AI_API_KEY` | `AI_MODEL` で指定 | ツール呼び出しに対応した Chat Completions API（OpenRouter・Ollama など）。`AI_BASE_URL` を指定します |

- `AI_API_KEY` は、すべてのプロバイダで使用できます。
- `AI_EFFORT`（`low` 〜 `max`、既定は `medium`）で推論の量を調整できます。低く設定するほど費用を抑えられます。
- 小規模なモデルほど、編集操作の誤りが増える傾向があります。誤りはサーバーが検出して修正させるためページが破損することはありませんが、やり取りの回数が増加します。
- Gemini などの無料枠では、送信した内容がサービスの改善に利用される場合があります。

### 例: Gemini を使用する場合

エディタの実行環境に、次の値を設定します。設定先は、ローカル環境と Node.js では `.env.local`、Docker では `--env-file` で渡すファイル、Cloudflare では Worker の Variables and Secrets です。

```dotenv
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your-api-key
```

APIキーはシークレットとして保存してください。`AI_API_KEY` はプロバイダ別のキーより優先されるため、プロバイダを切り替える際は、古い共通キーが残っていないことを確認してください。Claude・OpenAI・互換APIに切り替える場合も、上記の表に従って設定します。

### 動作の確認

ログインした状態で `/api/ai` を開くと、AIの利用可否と使用するモデルを確認できます。`AI_ENABLED` を設定しても利用可能にならない場合は、不足している設定がサーバーのログに出力されます。設定を変更した後は、ローカル環境・Node.js・Docker ではエディタを再起動し、Cloudflare では設定の変更を反映してから、エディタに戻ってください。

### 編集内容の保護

AIによる編集は、ページに反映する前に、必ず作業用の複製で検証します。

- 通信の切断、タイムアウト、解消されなかった操作のエラー、生成の打ち切りが発生した場合は、変更を一切適用しません。
- 応答を待っている間に同じページを編集した場合は、編集内容の上書きを避けるため、AIの結果を適用しません。
- 依頼はチャットの中止ボタンで取り消せます。適用された変更は、1回の「元に戻す」で取り消せます。
- 処理中のチャットには、AIによる簡潔な説明、変更案の準備・検証・修正の進捗、経過時間が表示されます。完了後も「作業の記録」で確認できます。AIの内部の思考過程や署名は表示しません。

## 環境変数

すべて任意です（[環境設定](#環境設定)）。

| 変数 | 内容 |
|---|---|
| `AUTH_SECRET` | セッションの秘密鍵。`npx auth secret` で生成します。 |
| `ALLOW_ANONYMOUS` | `true` に設定すると、Googleログインが未設定の場合でもログインなしで利用できます（`npm run dev` では不要）。URLを知っていれば誰でも編集・公開が可能になるため、ローカル環境またはデモでのみ使用してください。 |
| `AUTH_URL` | 本番環境のエディタのURL（例: `https://tsumu.example.com`） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google の OAuth クライアント |
| `ALLOWED_EMAILS` | 常にログインを許可するGoogleアカウント（カンマ区切り）。画面からは削除できません。その他のアカウントは、ホーム画面の **設定** で管理します。 |
| `GITHUB_TOKEN` | 公開先のすべてのリポジトリに Contents: Read and write の権限を持つトークン（全サイト共通） |
| `AI_ENABLED` | `true` で「AIに頼む」を有効にします。 |
| `AI_PROVIDER` | `anthropic`（既定）・`gemini`・`openai`・`openai-compatible` |
| `AI_API_KEY` | APIキー（`ANTHROPIC_API_KEY`・`GEMINI_API_KEY`・`OPENAI_API_KEY` でも可） |
| `AI_MODEL` | モデルID。既定は `claude-opus-5-5`（anthropic）・`gemini-3.8-flash`（gemini） |
| `AI_BASE_URL` | `openai-compatible` で使用するAPIのURL（例: `https://openrouter.ai/api/v1`） |
| `AI_EFFORT` | `low`・`medium`（既定）・`high`・`xhigh`・`max` |
| `TSUMU_DATA_DIR` | Node.js で動作させる場合の保存先フォルダ（[Node.js](#nodejs)）。Docker では `/data` に固定されます。 |

設定先は次のとおりです。

- ローカル開発と Node.js: `.env.local`
- Docker: `--env-file` で渡すファイル
- Cloudflare: `wrangler secret put`

すべての変数は [`.env.example`](.env.example) にも記載しています。

## 制限事項

### Cloudflare 無料プラン（エディタを Cloudflare Workers で動作させる場合）

| 項目 | 制限 | 影響 |
|---|---|---|
| Workers の CPU 時間 | 1リクエストあたり10ms | アセットの多いサイトを公開すると、超過する場合があります。Workers Paid（月額5ドル、CPU 30秒）では問題になりません。 |
| D1 の値のサイズ | Cloudflare のドキュメントでは1つの値につき2MBまで（実際にはそれを超える値も保存可能） | Tsumu は編集データのサイズを制限していません。D1 が保存を拒否した場合は、保存状態に「大きすぎる」と表示されます。 |
| KV | 合計1GB、1ファイル25MB、書き込みは1日1,000回まで | 容量は全サイトで共有されます。アセットタブには全サイトの合計が表示されます。 |
| KV の整合性 | 結果整合性 | アップロードしたファイルが全体に反映されるまで、数秒かかる場合があります。 |
| GitHub API | 1時間あたり5,000リクエスト | 1回の公開で数回から十数回を使用します。 |

### サイト

- サイトを削除すると、その編集データと自動バックアップも削除されます。公開済みのリポジトリと、保存先の画像は削除されません。
- サイト間でコピーした画像は、保存されている同一のファイルを共有します。他のサイトが使用中のファイルは、未使用として削除してもストレージからは削除されません。
- D1 がない場合、サイトはそのブラウザ内にのみ保存されます。ブラウザのデータを削除すると失われます。

### 同時編集

**コメント**

- コメントは編集データとは別に保存されます。公開サイトには含まれず、「元に戻す」の対象にもなりません。編集・削除できるのは投稿者本人のみです。
- 要素やページを削除しても、コメントは保持されます。コメント一覧から全文の表示・返信・解決が可能で、「削除された対象のみ」で該当するコメントに絞り込めます。削除を元に戻すと要素は同じIDで復元されるため、コメントも再び関連付けられます。対象を削除または非表示にしても、入力中の返信や新規コメントは失われません。
- コメント一覧は、作成日時の新しい順に1,000スレッドずつ読み込みます。古い一覧・新しい一覧への移動が可能です。絞り込みとキャンバス上のピンは、読み込んだ範囲に対して適用されます。表示中のスレッドは一覧を移動しても保持され、ヘッダーの件数は未解決のスレッド全体を対象とします。1つのスレッド内の返信は、従来どおり一括で読み込みます。
- 返信の入力中にスレッド自体が削除された場合、未送信の文章は閉じるまでコピー可能な状態で保持されます。削除されたスレッドは復元されず、以降の送信はできません。

**編集のマージ**

- マージは要素の項目単位で行います。異なる要素、または同じ要素の異なる項目（テキストと色など）を同時に編集した場合は、両方の変更が保持されます。同じ項目を同時に編集した場合は、後から保存した変更が優先されます。
- スクリプトの手順などの一覧は、全体を1つの項目として扱います。
- 未保存の変更がある間や文字の入力中は、他の編集者の変更を入力の完了後に取り込みます。
- 他の編集者の変更を取り込むと、「元に戻す」の履歴もそれに合わせて再構成されます。

**記録とアクセス**

- 編集・公開の記録には、各ユーザーが最後に編集・公開した時刻が保存されます。Googleログインを使用していない場合は、全員が1人のゲストとして表示されます。
- 許可リストから削除したアカウントは、ログイン済みのセッションであっても、次回のAPIアクセスから拒否されます。接続済みの同時編集の接続も、読み込み・保存・更新通知の前に権限を再確認します。

### エディタと書き出し

- **公開は通常のコミットとして行われます。** Tsumu が書き出したファイルはエディタの内容で置き換え、手動で追加したファイルは保持します。両者の区別には `_tsumu/generated.json` を使用します。
- **GitHub 上での変更を検出します。** 書き出したファイルが GitHub 上で直接編集されていた場合は、上書きの前に確認を求めます。書き出したファイルを手動で変更し続ける場合は、別のブランチで行ってください。
- **初回の公開でも既存のファイルを保持します。** 同じパスのファイルを上書きする前には確認を求めます。
- **`_tsumu/` は Tsumu の管理情報専用です。** 書き出したファイルの一覧が破損している場合は、公開を中止します。
- ページ専用のカスタムコードは、`<head>` ではなくページ本文の先頭に挿入されます。
- キャンバスでは、カスタムコードとアイコンを無害化して表示します。内部のスクリプトやイベント属性は公開したサイトでのみ実行され、ログイン中のエディタの権限では実行されません。
- `next/image` は、すべてのホスティングで動作するよう `unoptimized` で書き出します。
- HTMLページ（HTMLを直接記述したページ）には、共通のレイアウト・メタデータ・カスタムコードは適用されません。
- テキストを span に分割した後は、span ごとに編集します。
- ログインは Google アカウントにのみ対応しています。

## 開発

設計の概要（`SiteDoc` のデータ構造、公開・同時編集・AIの仕組み）は [ARCHITECTURE.md](ARCHITECTURE.md)（英語）にまとめています。

```
app/
  page.tsx            ホーム（サイトの一覧）
  sites/[id]/         エディタ
  login/              ログイン画面
  api/sites/          サイトの一覧・作成・設定・削除
  api/doc/            サイトごとの編集データ、日次バックアップ
  api/comments/       キャンバスのコメント
  api/activity/       最近編集した人・最後に公開した人
  api/publish/        生成 → GitHubへコミット、履歴とロールバック
  api/assets/         画像などのアップロード・配信・使用量
  api/ai/             AIに頼む
components/           画面（Home・Editor・Canvas・各パネル・ScriptEditor・HelpCenter など）
  canvas/ left-panel/ style-panel/ script-editor/   大きな画面の部品
lib/
  sites.ts            サイトの型・入力の確認・D1 への保存
  site.ts             開いているサイト・ブラウザ保存のキー・D1 が無いときのサイトの一覧
  generator.ts        SiteDoc → Next.js プロジェクト（部品は generator/）
  script-runtime.ts   スクリプトの実行ランタイム（キャンバスと書き出したサイトで共用）
  node-storage.ts     Cloudflare の外での保存先（SQLite・ファイル。TSUMU_DATA_DIR）
  store.ts            エディタの状態（zustand）と元に戻す履歴
  clip-transfer.ts    サイトをまたいだコピー＆ペースト
  page-transfer.ts    ページをほかのサイトへコピー
  comments.ts         コメント（D1・ブラウザ保存）
  activity.ts         編集・公開の記録
  aiOps.ts            AIの編集操作（サーバーとブラウザの両方で適用）
  manualTopics.ts     ヘルプの記事
  locales/            英語の訳
custom-worker.ts      同時編集の Durable Object を含む Cloudflare Worker の入口
scripts/cloudflare.mjs  デプロイ用の wrangler 設定を作って OpenNext を動かす
```

```bash
npm run typecheck      # tsc --noEmit
npm test               # 同時編集・取り消し・スクリプト・公開などの回帰テスト
npm run i18n:check     # 英語の訳の抜けを検出（ほかの言語は npm run i18n:check -- <言語コード>）
npm run build && npm run test:e2e   # 実際のブラウザによるE2Eテスト（Playwright。初回は npx playwright install chromium）
```

### 翻訳

画面の文言は日本語で記述し、`tr("…")` で囲みます（`lib/i18n.ts`）。他の言語については、日本語の原文と訳を対応付けた辞書 `lib/locales/<言語コード>.ts` を用意します。英語のヘルプとチュートリアルの文言は、`en-help.ts` に分離しています。

訳が存在しない文言は英語で表示され、英語の訳も存在しない場合は日本語の原文で表示されます。値を埋め込む場合は `tr("{name}を削除", { name })` のように記述します。

#### 言語の追加

1. `lib/lang.ts` の `LANGUAGES` に言語を追加します。キーは `zh`・`ko`・`fr` のような BCP 47 の言語コードです。
2. `Dict` をエクスポートするファイル `lib/locales/<言語コード>.ts` を作成します。`en.ts` を複製して値を翻訳する方法が最も簡単です。未翻訳の項目を削除すると、その項目は英語で表示されます。
3. `lib/locales/index.ts` の `LOCALES` に登録します。
4. `npm run i18n:check -- <言語コード>` で、未翻訳の文言を確認します。

追加した言語は、ホーム画面の **設定 → 表示言語**（エディタでは **⋯ → 設定**）に表示され、ブラウザの言語設定に応じて自動的に選択されます。

### ヘルプの記事

ヘルプの記事は `lib/manualTopics.ts` に記述します。各記事は、質問、1行の要約、本文のブロック（段落・箇条書き・表・ヒント・図解）で構成されます。

- 本文では `**強調**`・`` `コード` ``・`[[記事ID|リンクの文字]]` を使用できます。
- 図解は `components/HelpFigures.tsx` の React コンポーネントで、説明対象の CSS をそのまま使用して描画します。
- 操作ガイドの各ステップの `target` には、画面側の `data-tutorial` 属性の値を指定します。

## コントリビュート

Issue およびプルリクエストを歓迎します。

- 貢献の手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
- 脆弱性を非公開で報告する方法は [SECURITY.md](SECURITY.md) を参照してください。
- 参加者の行動規範は [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) を参照してください。

いずれも英語で記述されています。

変更を送る前に、`npm run typecheck`・`npm test`・`npm run i18n:check` を実行してください。プルリクエストでは GitHub Actions でも実行されます。動作を変更した場合は `tests/`（画面操作の場合は `e2e/`）にテストを追加し、画面に追加した文言には英訳も追加してください。

コードのコメントと画面の文言は日本語で記述し、英訳は `lib/locales/` に配置します。Issue やプルリクエストは英語・日本語のいずれでも受け付けています。

## ライセンス

[MIT](LICENSE) © abshrimp
