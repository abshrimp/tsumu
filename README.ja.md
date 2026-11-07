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

Tsumu は、ウェブサイトを作るためのビジュアルエディタです。キャンバスの上でページを組み立てて見た目を整えると、**普通の Next.js プロジェクト**として GitHub リポジトリに公開します。

公開したサイトは動作に Tsumu を必要としないため、ロックインはありません。Vercel・Netlify・Cloudflare Workers・Node.js サーバーなど、好きな場所で動かせます。サイトのリポジトリに自分で追加したファイル（APIルート・コンポーネント・設定など）は、次に公開してもそのまま残ります。エディタとコードを組み合わせて使えます。

1つのエディタで、いくつでもサイトを管理できます。サイトごとに編集データと公開先のリポジトリを持ち、作成・複製・切り替えはホーム画面で行います。

## 特徴

- **自分のものになるコード**: 公開したサイトは読みやすい普通の Next.js で、依存するのは `next`・`react`・`react-dom` だけです。
- **ビジュアル編集**: フレックスボックスとグリッドのレイアウト、画面幅ごとのスタイル、ホバーなどの状態、モーション、コンポーネント、リスト。
- **コードを書かないスクリプト**: 「きっかけ → 動作」のブロックを並べて、クリック・メニューの開閉・スクロール・入力・絞り込み・並べ替え・保存などの動きを作れます。
- **外部データ**: 任意のAPIからJSONを取得してリストに表示し、1件ごとに詳細ページ（`/news/[slug]` など）を生成できます。
- **同時編集**: 複数人で同時に編集でき、変更は要素の項目単位でマージされます。キャンバスへのコメントや、誰が編集・公開したかの確認もできます。
- **GitHub経由の公開**: 生成したプロジェクトをボタン1つでコミットします。テスト公開は、検索エンジンに載らないプレビュー用のブランチに送ります。
- **公開前チェック**: リンク切れ・画像の代替テキストの漏れ・見出しの順序の飛び・スマホで小さすぎる文字・スマホではみ出すレイアウトを、公開する前に見つけます。
- **履歴とロールバック**: 公開したサイトを、過去に公開したどの版にも戻せます。エディタの編集内容も、公開した版やサーバーの日次バックアップから復元できます。
- **AIに頼む（任意）**: やりたい変更を文章で伝えると、AIがページを編集します。1回の「元に戻す」で取り消せます。Claude・Gemini・OpenAI・OpenAI互換APIに対応しています。
- **ヘルプ内蔵**: チュートリアル、目的から探せる図解つきのQ&A、画面上の場所を指し示す操作ガイドがあります。
- **複数のサイト**: サイトの作成・複製・削除ができます。要素やページを、使っている画像・コンポーネントごとほかのサイトへコピーできます。
- **好きな場所で動かせる**: エディタは Cloudflare Workers（無料プランで足ります）・Node.js・Docker のどれでも動き、外部サービスはすべて任意です。
- **日本語・英語のUI**（ほかの言語も追加できます）

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

登場するのは次の3つです。

- **エディタ**は Next.js のアプリで、Cloudflare Workers・Node.js・Docker のどれでも動きます（[エディタのデプロイ](#エディタのデプロイ)）。サイトの一覧・編集データ・コメント・編集と公開の記録・ログインの許可リスト、そしてアップロードした画像・動画・音声を保存します。アップロードしたファイルは全サイトで共通です。どこに保存するかは、エディタを動かす場所によって決まります。
- **公開サイト**は、サイトごとのリポジトリにコミットされる普通の Next.js アプリです。エディタと同じ場所で動かす必要は**ありません**。
- **テスト公開**では、同じリポジトリの別のブランチ（既定は `preview`）にコミットします。Vercel・Cloudflare Workers Builds・Netlify は本番以外のブランチを自動でプレビューとしてビルドするので、ホスティングの設定は1つで本番とテストの両方をまかなえます。テスト版は robots.txt・`noindex`・`X-Robots-Tag` ヘッダー・クローラーの拒否で、検索エンジンに載らないようにしています。

## 環境設定

以下の設定はどれも**任意**です。足りない設定があってもエディタは開き、編集もできます。その設定が必要な機能だけが使えなくなります。

| 設定 | 無いとき | あるとき |
|---|---|---|
| サーバーの保存先（Cloudflare は D1・KV、Node.js・Docker は `TSUMU_DATA_DIR`） | サイトの一覧・編集データ・コメント・画像などをブラウザ内に保存します。見られるのはそのブラウザだけで、画像は1ファイル2MBまでです。 | サーバーに保存します。別の端末からの編集や、複数人での編集・コメントができます。日次バックアップと、誰が編集・公開したかの記録も残ります。画像は1ファイル25MBまでです。 |
| Googleログイン（`AUTH_*`） | エディタは開かず、設定方法の案内を表示します。`ALLOW_ANONYMOUS=true` のときと `npm run dev` ではログインなしで開きますが、**URLを知っていれば誰でも編集・公開できます**。 | 許可したGoogleアカウントだけが使えます。 |
| `GITHUB_TOKEN` | 「公開」で必要な設定を案内します。zipでの書き出しはできます。 | サイトの設定で指定したリポジトリに公開できます。 |
| `AI_*` | 「AIに頼む」ボタンは表示されません。 | 「AIに頼む」が使えます。 |

> [!IMPORTANT]
> インターネットから開けるエディタには、必ずGoogleログインを設定してください。ログインなしで動かすのは、自分のパソコンだけで使うときか、公開先（`GITHUB_TOKEN`）を設定しないデモのときに限ってください。

## ローカルで起動

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使っている場合は、クローンしたあとに `nvm use` を実行してください。

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

http://localhost:3000 を開くと、ホーム画面（サイトの一覧）が表示されます。「新しいサイト」を押すとサイトが作られ、`/sites/<id>` でエディタが開きます。

`npm run dev` について、知っておくと便利なこと:

- `wrangler.jsonc` をもとに、Cloudflare の D1・KV を手元で再現します。データは `.wrangler/state` に保存され、`TSUMU_DATA_DIR` より優先されます。
- 環境変数がなくても動き、ログインも省略されます。これは `npm run dev` のときだけです。`npm run preview` でもログインを省略したい場合は、`.dev.vars` に `ALLOW_ANONYMOUS=true` と書きます。
- ほかの人の編集はポーリングで反映されます。WebSocket によるリアルタイムの反映を試したいときは `npm run preview` を使います。

## エディタのデプロイ

エディタは次の3つの環境のどれでも動きます。機能は同じで、違うのはデータの保存先と、ほかの人の編集が届く仕組みだけです。

| | Cloudflare Workers | Node.js | Docker |
|---|---|---|---|
| 保存先 | D1（データベース）・Workers KV（画像など） | `TSUMU_DATA_DIR` のフォルダ（SQLite・ファイル） | コンテナの `/data`（ボリュームにつなぐ） |
| ほかの人の編集の反映 | すぐ（WebSocket・Durable Object） | すぐ（Server-Sent Events） | すぐ（Server-Sent Events） |
| 費用 | 無料プランで動く（[制限事項](#制限事項)） | サーバー代 | サーバー代 |
| 向いている場合 | サーバーを持たずに動かしたい | 手元や既存のサーバーで動かしたい | コンテナで管理したい |

どの環境でも、データベースのテーブルは最初のアクセスで自動的に作られるので、マイグレーションは不要です。サーバーの保存先を用意しなければ、データはブラウザ内に保存されます（[環境設定](#環境設定)）。

### 共通の準備

#### Googleログイン

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で、種類を「ウェブ アプリケーション」にした OAuth クライアントIDを作成します。
2. 承認済みのリダイレクトURIに次を追加します。
   - `https://<エディタのドメイン>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`（手元でもログインを試したい場合のみ）
3. OAuth 同意画面はテストモードのままで構いません。自分をテストユーザーに追加してください。

`AUTH_SECRET`・`AUTH_GOOGLE_ID`・`AUTH_GOOGLE_SECRET` の3つが揃うと、ログインが有効になります。あわせて `AUTH_URL` にエディタのURLを設定します。

`ALLOWED_EMAILS` に書いたアカウントは、いつでもログインできます。それ以外のアカウントを許可するには、ホーム画面の **設定 → ログインできるアカウント** で追加します（サーバーの保存先が必要です）。

#### GitHubのトークン

**Fine-grained personal access token** を作成し、公開に使うすべてのリポジトリに **Contents: Read and write** の権限を付けます。トークンは全サイトで1つを共有するので、サイトを追加したらそのリポジトリもトークンの対象に加えてください。対象を最初から「All repositories」にしておけば、追加の手間はありません。

公開先のリポジトリは、ホーム画面の **サイトの「…」→ 設定** でサイトごとに指定します（[サイトの公開先](#サイトの公開先)）。

### Cloudflare Workers

**1. 保存先を作る（任意）**

```bash
npx wrangler login
cp wrangler.jsonc wrangler.local.jsonc
npx wrangler d1 create tsumu                  # 表示された database_id を wrangler.local.jsonc に設定
npx wrangler kv namespace create ASSETS_KV    # 表示された id を wrangler.local.jsonc に設定
```

`wrangler.local.jsonc` は Git の管理対象外なので、リソースのIDがリポジトリに入ることはありません。このファイルがあれば、`npm run dev`・`npm run preview`・`npm run deploy` が自動的に使います（別のファイルを使う場合は、環境変数 `WRANGLER_CONFIG` で指定します）。

IDが設定されていないバインディングは、デプロイ時に取り除かれます。そのため、D1 だけ・KV だけを作っても、どちらも作らなくてもデプロイできます。

**2. シークレットを設定してデプロイ**

必要な変数を `npx wrangler secret put <名前>` で1つずつ設定します（[環境変数](#環境変数)）。`wrangler.local.jsonc` を使っている場合は `--config wrangler.local.jsonc` を付けてください。設定できたらデプロイします。

```bash
npm run deploy
```

#### push のたびに自動デプロイする（Workers Builds）

Cloudflare Workers Builds で自動デプロイするには、リポジトリを接続して次のように設定します。

- Build command: `node scripts/cloudflare.mjs build`
- Deploy command: `node scripts/cloudflare.mjs deploy`
- Preview command（Worker Previews を設定したあと。下記参照）: `node scripts/cloudflare-preview.mjs`
- ビルド変数（任意。Settings → Build → Variables and secrets）: `D1_DATABASE_ID`・`KV_NAMESPACE_ID`

ビルドのときに、スクリプトが `wrangler.jsonc` からデプロイ用の設定ファイル `wrangler.generated.jsonc` を作ります。ビルド変数のIDを埋め込み、IDのないバインディングは取り除くので、IDをコミットする必要はありません。

#### プルリクエストのプレビュー（Worker Previews）

エディタは Durable Object を持っています。Cloudflare の従来の **Version URL**（`opennextjs-cloudflare upload` や `wrangler versions upload` が作るURL）では、こうした Worker を表示できません。プルリクエストをプレビューするには、代わりに **Worker Previews** を使います。

- 既存の Workers Builds プロジェクトでは、**一度きりの、元に戻せない切り替え**が必要です。代わりに Version URL を有効にするだけ、という対応はしないでください。
- `npm run preview` は引き続き手元専用です。`npm run preview:deploy` はクラウド上に Preview を作成します。
- 設定方法、本番と分けた保存先、認証、動作の確かめ方は [エディタのプレビュー](docs/worker-previews.md) にまとめています。

このリポジトリでクラウドに作る確認用プレビューは、**URLを知っていればログインなしで開ける公開デモ**です。

- コミット済みの `previews` 設定では、D1・KV を明示的に空にし、`ALLOW_ANONYMOUS=true` だけを設定しています。補助スクリプト（helper）は、そのプレビュー専用の Durable Object を追加します。
- 本番のシークレットはコピーしません。
- サイトの文書と画像は、プレビューのURLごとにブラウザ内に保存されます。使い捨てのテストデータで試してください。
- ビルド変数を置くだけでは、実行時の匿名モードにはなりません。
- 自分用の `WRANGLER_CONFIG` や `wrangler.local.jsonc` を使う場合も、同じ分離を明示的に保ってください。

リポジトリの変更をマージしても、Cloudflare のダッシュボードでの切り替えは行われません。切り替えは自分で行います。流れは次のとおりです。

1. **切り替える前に**、本番のデプロイと既存のプレビューを確認します。本番のバインディングやシークレットを含まない Preview Base を用意し、実行されるコマンドをすべて確認してください。
2. **本番の Deploy command は変えません。** 切り替えたあと、Preview command に helper を指定します。
3. **helper を含むブランチで試します。** 古いプルリクエストのブランチには、この設定の変更を取り込む必要があります。
4. **実際のURLを開いて確かめます。** Cloudflare のビルド結果か GitHub のプルリクエスト連携が出すURLを開き、使い捨てのサイトを作って再読み込みします。ビルドが成功したことや、推測した Version URL だけでは、プレビューが動いている証拠になりません。

詳しくは [切り替えのチェックリスト](docs/worker-previews.md#workers-builds-cutover-checklist) を参照してください。

### Node.js

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使っている場合は、クローンしたあとに `nvm use` を実行してください。

環境変数 `TSUMU_DATA_DIR` にフォルダを指定すると、データを `<フォルダ>/tsumu.db`（SQLite）に、アップロードしたファイルを `<フォルダ>/assets/` に保存します。Node.js に組み込みの `node:sqlite` を使うので、追加でインストールするものはありません。

```bash
npm ci
npm run build
TSUMU_DATA_DIR=./data npm start
```

ログインを設定せずに手元で試すときは、`ALLOW_ANONYMOUS=true` を付けます。

```bash
ALLOW_ANONYMOUS=true TSUMU_DATA_DIR=./data npm start
```

ほかの環境変数は `.env.local` か、サーバーの環境変数で設定します（[環境変数](#環境変数)）。ポートは `PORT` で変えられます（既定は 3000）。

注意点:

- **バックアップ**: `TSUMU_DATA_DIR` のフォルダを丸ごとコピーします。SQLite は書き込んだばかりの内容を `tsumu.db-wal` にも持っているため、`tsumu.db`・`tsumu.db-wal`・`tsumu.db-shm` をまとめてコピーしてください。できればエディタを止めてから行うのが確実です。
- **1つのフォルダに1つのエディタ**: 同じ `TSUMU_DATA_DIR` を使うエディタは1つだけ起動してください。ほかの人の編集の通知は、1つのプロセスの中で配っています。
- **リバースプロキシ（nginx など）の後ろで動かす場合**:
  - `AUTH_URL` に外から開くURLを設定し、プロキシで `X-Forwarded-Host` と `X-Forwarded-Proto` を転送してください。そうしないと、Googleログインのあとに正しいアドレスへ戻れません。
  - `/api/collab/events` の応答は、ためずにそのまま流すようにしてください。nginx の場合は、応答に付いている `X-Accel-Buffering: no` ヘッダーによって自動的にそうなります。

### Docker

イメージには Node.js 版のエディタが入っていて、データはコンテナ内の `/data` に保存します。

```bash
docker build -t tsumu .
docker run -d --name tsumu -p 3000:3000 -v tsumu-data:/data --env-file .env.local tsumu
```

ログインを設定せずに手元で試すときは、`-e ALLOW_ANONYMOUS=true` を付けます。

環境変数は `--env-file`（または `-e`）で渡します（[環境変数](#環境変数)）。渡すファイルに `TSUMU_DATA_DIR` は書かないでください。書くと、データがボリュームの外に保存されてしまいます。

**データの保存場所**

```
/data/
  tsumu.db, tsumu.db-wal, tsumu.db-shm   サイトの一覧・編集データ・コメント・バックアップなど（SQLite）
  assets/data/                            アップロードした画像・動画などの本体
  assets/meta/                            各ファイルの種類（Content-Type）
```

- `-v tsumu-data:/data` とすると、Docker の名前付きボリューム `tsumu-data` に保存します。コンテナを作り直しても、同じボリュームを指定すればデータは残ります。
- 手元のフォルダに保存したい場合は、`-v "$(pwd)/data:/data"` とします。コンテナは `node` ユーザー（UID 1000）で動くので、Linux では先にフォルダの所有者を合わせてください（`sudo chown 1000:1000 data`）。
- **`-v` を付けずに起動しないでください。** データが名前のないボリュームに保存され、コンテナを作り直すと見えなくなります。

名前付きボリュームのバックアップ（コンテナを止めてから行うのが確実です）:

```bash
docker stop tsumu
docker run --rm -v tsumu-data:/data -v "$(pwd)":/backup busybox tar czf /backup/tsumu-data.tgz -C /data .
docker start tsumu
```

リバースプロキシの後ろで動かす場合の設定は、[Node.js](#nodejs) と同じです。

## サイトの公開先

ホーム画面の **サイトの「…」→ 設定** で、サイトごとに次の項目を指定します。サイトを作るときでも、あとからでも設定できます。

| 項目 | 内容 |
|---|---|
| GitHubリポジトリ | `owner/name`。指定しなくても編集はできますが、公開はできません。 |
| 本番のブランチ | 既定は `main` |
| テスト公開のブランチ | 既定は `preview`。空欄にするとテスト公開を無効にします。 |
| 本番サイトのURL・テストサイトのURL | 任意。公開画面から各サイトを開けるようになります。 |

公開先のリポジトリは、最初に公開する前に作っておきます。空のリポジトリでも、README 付きで初期化したものでも構いません。

## 公開サイトのホスティング

最初に公開したあと、サイトのリポジトリをホスティングサービスに接続します。

| ホスティング | 設定 | テスト公開 |
|---|---|---|
| **Vercel** | リポジトリをインポートするだけ。設定は不要です。 | 本番以外のブランチに、自動でプレビューURLが付きます。 |
| **Netlify** | リポジトリをインポートします。 | Branch deploys を有効にします。 |
| **Cloudflare Workers Builds** | Build: `npx opennextjs-cloudflare build`<br>Deploy: `npx opennextjs-cloudflare deploy` | 生成されたプロジェクト側で、別途 [Worker Previews](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) を設定します。Preview command では、そのプロジェクト専用に分離したバインディングで `wrangler preview` を実行する必要があります。エディタの helper は、ほかのリポジトリの設定は行いません。 |
| **Node.js** | `npm install && npm run build && npm start` | テスト公開のブランチは別にビルドします。 |

### データの更新間隔と Cloudflare

外部のJSONを使うページは、エディタの **サイト** タブで設定する **データの更新間隔** ごとに作り直されます。その方法はホスティングによって異なります。

- **標準のホスティング**（Vercel・Netlify・Node.js）では、Next.js の ISR を使います。ページは前もって生成され、バックグラウンドで作り直されます。
- **Cloudflare Workers** で ISR を動かすには、追加のキャッシュ（R2）とキューが必要です。これがないと、前もって生成したページは**二度と作り直されません**。これを避けるには、エディタの **サイト** タブで **公開先のホスティング → Cloudflare Workers** を選びます。すると、該当するページをリクエストのたびに描画し、取得したJSONを更新間隔のあいだ Cloudflare のエッジにキャッシュする形で書き出します。

どのホスティングでも、更新間隔を `0` にするとリクエストのたびにデータを取得します。

### ロールバック

**公開 → 公開履歴・ロールバック**（または **⋯ → 履歴**）に、ブランチごとのコミットが一覧で表示されます。それぞれの版について、次の操作ができます。

- **サイトを戻す**: 選んだ版のファイルを、ブランチの先頭に新しいコミットとして積み直します。履歴は消えないので、ロールバックそのものもあとから取り消せます。
- **編集内容を復元**: その公開のときに一緒に保存した編集データ（`_tsumu/doc.json`）を、エディタに読み込みます。通常の編集として扱われるので、⌘Z で元に戻せます。

同じ画面には、サーバーが保存している編集データの日次バックアップも表示されます。曜日ごとに1つ、合わせて7日分です。

## AIに頼む（任意）

`AI_ENABLED=true` とAPIキーを設定すると、**AIに頼む** ボタンが表示されます。リクエストはエディタのサーバーの `/api/ai` を経由するため、APIキーがブラウザに渡ることはありません。

### しくみ

1. ブラウザが、編集中のページの要約（要素の階層・テキスト・スタイル）を送ります。ほかのページは名前だけを送ります。
2. サーバーが、エディタのデータ構造の説明と `edit_site` ツールを添えて、AIに渡します。
3. AIは編集操作（スタイルの変更、要素の追加や移動、テキストの変更など）を返します。
4. サーバーは、その操作をページの複製で試しに適用します。失敗した操作があれば、エラーをAIに返して直させます。
5. 正しく適用できた操作だけがブラウザに戻り、1回で取り消せる変更として適用されます。

スクリプト・データの設定・アセットは、AIの編集の対象外です。

### プロバイダの選び方

| `AI_PROVIDER` | APIキー | `AI_MODEL` の既定 | 備考 |
|---|---|---|---|
| `anthropic`（既定） | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `claude-sonnet-5-5`・`claude-haiku-5-5` を指定すると費用を抑えられる |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` | Gemini の OpenAI 互換APIを使用。最も安いのは `gemini-2.5-flash-lite`。無料枠あり |
| `openai` | `OPENAI_API_KEY` | `AI_MODEL` を指定 | |
| `openai-compatible` | `AI_API_KEY` | `AI_MODEL` を指定 | ツール呼び出しに対応した Chat Completions API（OpenRouter・Ollama など）。`AI_BASE_URL` を指定 |

- `AI_API_KEY` は、どのプロバイダでも使えます。
- `AI_EFFORT`（`low` 〜 `max`、既定は `medium`）で、AIがどれだけ考えるかを調整できます。低いほど費用を抑えられます。
- 小さいモデルほど、編集操作を間違えやすくなります。間違いはサーバーが見つけて直させるのでページが壊れることはありませんが、やり取りの回数が増えます。
- Gemini などの無料枠では、送った内容がサービスの改善に使われる場合があります。

### 例: Gemini で使う

エディタを動かす環境に、次の値を設定します。手元と Node.js では `.env.local`、Docker では `--env-file` で渡すファイル、Cloudflare では Worker の Variables and Secrets です。

```dotenv
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your-api-key
```

APIキーはシークレットとして保存してください。`AI_API_KEY` はプロバイダ別のキーより優先されるため、プロバイダを切り替えるときは、古い共通キーが残っていないか確認してください。Claude・OpenAI・互換APIに切り替える場合も、上の表のとおりに設定します。

### 動いているか確かめる

ログインした状態で `/api/ai` を開くと、AIが使えるかどうかと、使われるモデルを確認できます。`AI_ENABLED` を設定しているのに使えるようにならない場合は、足りない設定がサーバーのログに出ます。設定を変えたら、手元・Node.js・Docker ではエディタを再起動し、Cloudflare では設定の変更を反映してから、エディタに戻ってください。

### 編集内容を守るしくみ

AIの編集は、ページに反映する前に、必ず作業用の複製で確かめます。

- 通信の切断・時間切れ・直らなかった操作のエラー・生成の打ち切りが起きた場合は、何も適用しません。
- 応答を待っているあいだに同じページを編集した場合は、自分の編集を上書きしないよう、AIの結果を取り込みません。
- 依頼はチャットの中止ボタンで取り消せます。適用された変更は、1回の「元に戻す」で取り消せます。
- 作業中のチャットには、AIによる短い説明、変更案の準備・検証・修正の進み具合、経過時間が表示されます。終わったあとも「作業の記録」で確認できます。AIの内部の思考や署名は表示しません。

## 環境変数

すべて任意です（[環境設定](#環境設定)）。

| 変数 | 内容 |
|---|---|
| `AUTH_SECRET` | セッションの秘密鍵。`npx auth secret` で生成します。 |
| `ALLOW_ANONYMOUS` | `true` にすると、Googleログインを設定していなくてもログインなしで開けます（`npm run dev` では不要）。URLを知っている人なら誰でも編集・公開できるので、手元かデモだけで使ってください。 |
| `AUTH_URL` | 本番のエディタのURL（例: `https://tsumu.example.com`） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google の OAuth クライアント |
| `ALLOWED_EMAILS` | いつでもログインを許可するGoogleアカウント（カンマ区切り）。画面からは削除できません。ほかのアカウントは、ホーム画面の **設定** で管理します。 |
| `GITHUB_TOKEN` | 公開先のすべてのリポジトリに Contents: Read and write の権限を持つトークン（全サイト共通） |
| `AI_ENABLED` | `true` で「AIに頼む」を有効にします。 |
| `AI_PROVIDER` | `anthropic`（既定）・`gemini`・`openai`・`openai-compatible` |
| `AI_API_KEY` | APIキー（`ANTHROPIC_API_KEY`・`GEMINI_API_KEY`・`OPENAI_API_KEY` でも可） |
| `AI_MODEL` | モデルID。既定は `claude-opus-5-5`（anthropic）・`gemini-3.8-flash`（gemini） |
| `AI_BASE_URL` | `openai-compatible` で使うAPIのURL（例: `https://openrouter.ai/api/v1`） |
| `AI_EFFORT` | `low`・`medium`（既定）・`high`・`xhigh`・`max` |
| `TSUMU_DATA_DIR` | Node.js で動かすときの保存先のフォルダ（[Node.js](#nodejs)）。Docker では `/data` に固定です。 |

設定する場所:

- ローカル開発と Node.js: `.env.local`
- Docker: `--env-file` で渡すファイル
- Cloudflare: `wrangler secret put`

すべての変数は [`.env.example`](.env.example) にも載っています。

## 制限事項

### Cloudflare 無料プラン（エディタを Cloudflare Workers で動かす場合）

| 項目 | 制限 | 影響 |
|---|---|---|
| Workers の CPU 時間 | 1リクエストあたり10ms | アセットの多いサイトを公開すると、超えることがあります。Workers Paid（月5ドル、CPU 30秒）なら問題ありません。 |
| D1 の値の大きさ | Cloudflare の文書では1つの値につき2MBまで（実際にはそれより大きな値も入ります） | Tsumu は編集データの大きさを制限していません。D1 が保存を拒んだ場合は、保存状態に「大きすぎる」と表示されます。 |
| KV | 合計1GB・1ファイル25MB・書き込みは1日1,000回まで | 容量は全サイトで共有します。アセットタブには全サイトの合計が表示されます。 |
| KV の整合性 | 結果整合性 | アップロードしたファイルが全体に行き渡るまで、数秒かかることがあります。 |
| GitHub API | 1時間あたり5,000リクエスト | 1回の公開で数回から十数回使います。 |

### サイト

- サイトを削除すると、その編集データと自動バックアップも削除されます。公開済みのリポジトリと、保存先にある画像は残ります。
- サイト間でコピーした画像は、保存されている同じファイルを共有します。ほかのサイトがまだ使っているファイルは、未使用として削除してもストレージからは消えません。
- D1 がない場合、サイトはそのブラウザの中にしかありません。ブラウザのデータを消すと失われます。

### 同時編集

**コメント**

- コメントは編集データとは別に保存します。公開サイトには含まれず、「元に戻す」の対象にもなりません。編集・削除できるのは書いた本人だけです。
- 要素やページを削除しても、コメントは残ります。コメント一覧から全文を開いたり、返信・解決したりできます。「削除された対象のみ」で、そうしたコメントだけに絞り込めます。削除を元に戻すと、要素は同じIDで復元されるので、コメントもふたたび結び付きます。対象を削除したり非表示にしたりしても、書きかけの返信や新しいコメントは消えません。
- コメント一覧は、作成日時の新しい順に1,000スレッドずつ読み込みます。古い一覧・新しい一覧へ移動できます。絞り込みとキャンバス上のピンは、読み込んだ範囲に対して働きます。開いているスレッドは一覧を移動しても開いたままで、ヘッダーの件数は未解決のスレッドすべてを数えます。1つのスレッドの返信は、これまでどおりまとめて読み込みます。
- 返信を書いているあいだにスレッドそのものが削除された場合、送信前の文章は、閉じるまでコピーできる状態で残ります。削除されたスレッドは復元されず、それ以上は送信できません。

**編集のマージ**

- マージは要素の項目単位で行います。別々の要素や、同じ要素の別々の項目（文字と色など）を同時に編集した場合は、両方の変更が残ります。同じ項目を同時に編集した場合は、あとから保存した側が残ります。
- スクリプトの手順のような一覧は、まとめて1つの項目として扱います。
- 保存していない変更があるあいだや文字の入力中は、ほかの人の変更を、入力が終わってから取り込みます。
- ほかの人の変更を取り込むと、「元に戻す」の履歴もそれに合わせて組み直されます。

**記録とアクセス**

- 編集・公開の記録には、人ごとに最後に編集・公開した時刻が残ります。Googleログインを使っていない場合は、全員が1人のゲストとして表示されます。
- 許可リストから外したアカウントは、ログイン済みのセッションであっても、次のAPIアクセスから拒否されます。すでにつながっている同時編集の接続も、読み込み・保存・更新の通知の前に、権限をあらためて確認します。

### エディタと書き出し

- **公開は通常のコミットです。** Tsumu が書き出したファイルはエディタの内容で置き換え、手で追加したファイルは残します。両者の区別には `_tsumu/generated.json` を使います。
- **GitHub上での変更は検出します。** 書き出したファイルが GitHub 上で直接編集されていた場合は、上書きする前に確認します。書き出したファイルを手で変更し続けたい場合は、別のブランチで行ってください。
- **最初の公開でも慎重に扱います。** 既存のファイルは残し、同じパスのファイルを上書きする前に確認します。
- **`_tsumu/` は Tsumu の管理情報専用です。** そこにある書き出したファイルの一覧が壊れている場合は、公開を中止します。
- ページ専用のカスタムコードは、`<head>` ではなくページの本文の先頭に入ります。
- キャンバスでは、カスタムコードとアイコンを無害化して表示します。中のスクリプトやイベント属性は公開したサイトでだけ動き、ログイン中のエディタの権限では動きません。
- `next/image` は、どのホスティングでも動くよう `unoptimized` で書き出します。
- HTMLページ（HTMLを直接書いたページ）には、共通のレイアウト・メタデータ・カスタムコードは入りません。
- テキストを span に分割したあとは、span ごとに編集します。
- ログインは Google アカウントにのみ対応しています。

## 開発

設計の概要（`SiteDoc` のデータ構造、公開・同時編集・AIのしくみ）は [ARCHITECTURE.md](ARCHITECTURE.md)（英語）にまとめています。

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
npm run build && npm run test:e2e   # 実際のブラウザで画面を通しで確かめるテスト（Playwright。初回は npx playwright install chromium）
```

### 翻訳

画面の文言は日本語で書き、`tr("…")` で囲みます（`lib/i18n.ts`）。ほかの言語には、日本語の原文を訳に対応させる辞書 `lib/locales/<言語コード>.ts` を用意します。英語のヘルプとチュートリアルの文言は、`en-help.ts` に分けています。

訳がない文言は英語で表示され、英語の訳もなければ日本語の原文で表示されます。値を埋め込むときは `tr("{name}を削除", { name })` のように書きます。

#### 言語を追加する

1. `lib/lang.ts` の `LANGUAGES` に言語を追加します。キーは `zh`・`ko`・`fr` のような BCP 47 の言語コードです。
2. `Dict` をエクスポートするファイル `lib/locales/<言語コード>.ts` を作ります。`en.ts` を複製して値を翻訳するのがいちばん手軽です。まだ訳していない項目は、消しておけば英語で表示されます。
3. `lib/locales/index.ts` の `LOCALES` に登録します。
4. `npm run i18n:check -- <言語コード>` で、残っている未翻訳の文言を確認します。

追加した言語は、ホーム画面の **設定 → 表示言語**（エディタでは **⋯ → 設定**）に表示され、ブラウザの言語設定からも自動で選ばれます。

### ヘルプの記事

ヘルプの記事は `lib/manualTopics.ts` にあります。それぞれ、質問・1行の短い回答・本文のブロック（段落・箇条書き・表・コツ・図解）でできています。

- 本文では `**強調**`・`` `コード` ``・`[[記事ID|リンクの文字]]` が使えます。
- 図解は `components/HelpFigures.tsx` の React コンポーネントで、説明している CSS そのものを使って描画します。
- 操作ガイドの各ステップの `target` には、画面側の `data-tutorial` 属性の値を指定します。

## コントリビュート

Issue やプルリクエストを歓迎します。

- 貢献の手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。
- 脆弱性を非公開で報告する方法は [SECURITY.md](SECURITY.md) にあります。
- 参加者の行動規範は [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) にあります。

いずれも英語です。

変更を送る前に、`npm run typecheck`・`npm test`・`npm run i18n:check` を実行してください。プルリクエストでは GitHub Actions でも実行されます。動作を変えた場合は `tests/`（画面の操作なら `e2e/`）にテストを追加し、画面に追加した文言には英訳も追加してください。

コードのコメントと画面の文言は日本語で書き、英訳は `lib/locales/` に置きます。Issue やプルリクエストは英語でも日本語でも構いません。

## ライセンス

[MIT](LICENSE) © abshrimp
