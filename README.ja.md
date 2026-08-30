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

Tsumu は、ウェブサイトを構築するためのビジュアルエディタです。キャンバス上でレイアウトとスタイルを編集し、**標準的なプロジェクト**として GitHub リポジトリに公開します。形式は Next.js（既定）・React・Vue・Nuxt・SvelteKit・ビルド不要の HTML から選択できます（[出力形式](#出力形式)）。

公開したサイトは Tsumu に依存せずに動作するため、Vercel・Netlify・Cloudflare Workers・Node.js サーバーなど、任意の環境でホスティングできます。サイトのリポジトリに手動で追加したファイル（API ルート・コンポーネント・設定など）は次回の公開後も保持されるため、エディタでの編集とコードによる開発を併用できます。

1つのエディタで複数のサイトを管理できます。編集データと公開先のリポジトリはサイトごとに独立しており、作成・複製・切り替えはホーム画面で行います。

## 特徴

- **ロックインのないコード**: 既定の出力は、`next`・`react`・`react-dom` のみに依存する可読性の高い Next.js です。React + Vite・Vue 3 + Vite・Nuxt・SvelteKit・HTML/CSS/JavaScript・単一のHTMLファイルでも出力でき、言語（TypeScript・JavaScript）とスタイル（CSS・CSS Modules・Tailwind CSS）も選択できます。
- **ビジュアル編集**: フレックスボックスとグリッドによるレイアウト、画面幅ごとのスタイル、ホバー・アクティブ・フォーカスや独自に定義した状態、モーション、コンポーネント、リストに対応しています。
- **コード不要のスクリプト**: 「きっかけ → 動作」のブロックを組み合わせて、クリック・メニューの開閉・スクロール・入力・状態の切り替え・絞り込み・並べ替え・保存などの動作を作成できます。
- **インポート**: Tsumu の zip や `doc.json` から、サイトを復元できます。既存の HTML ファイルやウェブサイトの zip を、編集可能な要素に変換して取り込むこともできます。
- **外部データ**: 任意の API から取得した JSON で、リストや項目ごとの詳細ページ（`/news/[slug]` など）を生成できます。
- **同時編集**: 複数人で同時に編集でき、変更は要素の項目単位でマージされます。キャンバスへのコメントや、編集・公開した人の確認も可能です。
- **GitHub 経由の公開**: 生成したプロジェクトをワンクリックでコミットします。テスト公開は、検索エンジンの対象外となるプレビュー用ブランチに行います。
- **公開前チェック**: リンク切れ、代替テキストの欠落、見出しの順序の誤り、スマートフォンで小さすぎる文字やはみ出すレイアウトを検出します。
- **履歴とロールバック**: 公開したサイトを過去の任意の版に戻せます。エディタの編集内容も、公開した版やサーバーの日次バックアップから復元できます。
- **AIに頼む（任意）**: 変更内容を文章で指示すると、AIがページを編集します。1回の「元に戻す」で取り消せます。Claude・Gemini・OpenAI・OpenAI 互換 API に対応しています。
- **ヘルプ内蔵**: チュートリアル、目的から探せる図解付きの Q&A、操作箇所を画面上で示すガイドを備えています。
- **複数のサイト**: サイトの作成・複製・削除ができます。要素やページは、使用中の画像やコンポーネントごと別のサイトへコピーできます。
- **任意の環境で動作**: エディタは Cloudflare Workers（無料プランで運用可能）・Node.js・Docker で動作します。外部サービスはすべて任意です。
- **日本語・英語のUI**（他言語も追加可能）

## スクリーンショット

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/ai.png" alt="AIにページの編集を頼む"><br><sub><b>AIに頼む</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/publish.png" alt="テストサイトと本番サイトを選べる公開画面"><br><sub><b>公開</b>: チェックの後、テストサイトか本番へ</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/comments.png" alt="見出しに付けたコメント"><br><sub><b>コメント</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/help.png" alt="図解付きのヘルプ"><br><sub><b>ヘルプ内蔵</b></sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ja/responsive.png" alt="スマホの見た目を編集"><br><sub><b>画面幅ごとの編集</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ja/scripts.png" alt="クリック時とページを開いたときのブロックを並べたスクリプト編集画面"><br><sub><b>コード不要のスクリプト</b>: 「きっかけ → 動作」のブロック</sub></td>
  </tr>
</table>

## 構成

```
Tsumu（このリポジトリ）
│  Cloudflare Workers ／ Node.js ／ Docker のいずれかで動作
│  ホーム（サイトの一覧）・エディタ /sites/<id>・Googleログイン（任意）
│
│  公開 → main ／ テスト公開 → preview
▼
サイトごとのリポジトリ（GitHub）
│  サイトA・サイトB・…（それぞれ main が本番、preview がテスト）
│
│  ブランチごとに自動でビルド
▼
ホスティング（任意）
   Vercel / Netlify / Cloudflare Workers / Node.js
```

構成要素は次の3つです。

- **エディタ**: Cloudflare Workers・Node.js・Docker で動作する Next.js アプリケーションです（[エディタのデプロイ](#エディタのデプロイ)）。サイトの一覧、編集データ、コメント、編集・公開の記録、ログインの許可リスト、アップロードした画像・動画・音声を保存します。アップロードしたファイルは全サイトで共有されます。保存先は実行環境によって異なります。
- **公開サイト**: サイトごとのリポジトリにコミットされる、標準的な Next.js（または他の[出力形式](#出力形式)）のアプリケーションです。エディタと同じ環境で動作させる必要は**ありません**。
- **テスト公開**: 同じリポジトリの別ブランチ（既定は `preview`）にコミットします。Vercel・Cloudflare Workers Builds・Netlify は本番以外のブランチを自動でプレビューとしてビルドするため、1つのホスティング設定で本番とテストの両方を扱えます。テスト版は robots.txt・`noindex`・`X-Robots-Tag` ヘッダー・クローラーの拒否により、検索エンジンの対象外としています。

## 環境設定

以下の設定はいずれも**任意**です。未設定でもエディタは起動して編集でき、その設定を必要とする機能だけが利用できなくなります。

| 設定 | 未設定の場合 | 設定した場合 |
|---|---|---|
| サーバーの保存先（Cloudflare は D1・Durable Objects・KV、Node.js・Docker は `TSUMU_DATA_DIR`） | サイトの一覧・編集データ・コメント・画像などをブラウザ内に保存します。参照できるのはそのブラウザのみで、画像は1ファイル2MBまでです。 | サーバーに保存します。別の端末からの編集や、複数人での編集・コメントが可能になり、日次バックアップと編集・公開の記録も保存されます。画像は1ファイル25MBまでです。 |
| Googleログイン（`AUTH_*`） | エディタは起動せず、設定方法を案内します。`ALLOW_ANONYMOUS=true` の場合と `npm run dev` ではログインなしで利用できますが、**URLを知っている人は誰でも編集・公開できます**。 | 許可したGoogleアカウントのみが利用できます。 |
| `GITHUB_TOKEN` | 「公開」で必要な設定を案内します。zip での書き出しは可能です。 | サイトの設定で指定したリポジトリに公開できます。 |
| `AI_*` | 「AIに頼む」ボタンは表示されません。 | 「AIに頼む」を利用できます。 |

> [!IMPORTANT]
> インターネットからアクセスできるエディタには、必ずGoogleログインを設定してください。ログインなしで運用してよいのは、ローカル環境でのみ使用する場合と、公開先（`GITHUB_TOKEN`）を設定していないデモに限られます。

## ローカルで起動

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使用している場合は、クローン後に `nvm use` を実行してください。

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

http://localhost:3000 を開くと、ホーム画面（サイトの一覧）が表示されます。「新しいサイト」を選択するとサイトが作成され、`/sites/<id>` でエディタが開きます。

`npm run dev` には次の特徴があります。

- `wrangler.jsonc` に基づき、Cloudflare の D1・KV をローカルで再現します。データは `.wrangler/state` に保存され、`TSUMU_DATA_DIR` より優先されます。
- 環境変数なしで動作し、ログインを省略します（`npm run dev` のみ）。`npm run preview` でもログインを省略するには、`.dev.vars` に `ALLOW_ANONYMOUS=true` を記述します。
- 他の編集者の変更はポーリングで反映されます。WebSocket によるリアルタイムの反映を確認するには、`npm run preview` を使用します。

## エディタのデプロイ

稼働中のエディタを更新する前に、[リリース時の安全確認](docs/releasing.md)（英語）に沿って、ステージングでの確認、バックアップと復元の検証、ロールバック、監視を行ってください。

エディタは次の3つの環境で動作します。機能は共通で、データの保存先と、他の編集者の変更を反映する方式のみが異なります。

| | Cloudflare Workers | Node.js | Docker |
|---|---|---|---|
| 保存先 | D1（サイト情報）・SQLite対応Durable Objects（編集データ）・Workers KV（画像など） | `TSUMU_DATA_DIR` のフォルダ（SQLite・ファイル） | コンテナの `/data`（ボリュームをマウント） |
| 他の編集者の変更の反映 | 即時（WebSocket・Durable Object） | 即時（Server-Sent Events） | 即時（Server-Sent Events） |
| 費用 | 無料プランで運用可能（[制限事項](#制限事項)） | サーバー費用 | サーバー費用 |
| 適した用途 | 自前のサーバーを持たずに運用する場合 | ローカル環境や既存のサーバーで運用する場合 | コンテナで管理する場合 |

D1とローカルSQLiteのテーブルは初回アクセス時に自動作成されます。Cloudflareの編集データ保存には`DOC_STORE`バインディングと`wrangler.jsonc`の`exports.DocumentRoom`（SQLite）の宣言が必要です。保存方式とデプロイ時の確認事項は[編集データの保存設計](docs/durable-object-storage.md)を参照してください。サーバーの保存先がない場合、データはブラウザ内に保存されます（[環境設定](#環境設定)）。

Cloudflareでは、アセット削除操作の時点でD1に7日後の削除候補を記録します。毎日午前3時の処理は期限切れ候補のみ確認し、アップロード失敗などによる孤立ファイルは週1回の調査で補完します。KVの物理削除は既定では無効で、`ASSET_GC_ENABLED=true` を設定した場合のみ実行されます。詳細は[KVアセットのGC](docs/asset-gc.md)を参照してください。

### 共通の準備

#### Googleログイン

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で、種類が「ウェブ アプリケーション」の OAuth クライアントIDを作成します。
2. 承認済みのリダイレクトURIに次を追加します。
   - `https://<エディタのドメイン>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`（ローカル環境でログインを確認する場合のみ）
3. OAuth 同意画面はテストモードのままで構いません。自身をテストユーザーに追加してください。

`AUTH_SECRET`・`AUTH_GOOGLE_ID`・`AUTH_GOOGLE_SECRET` をすべて設定すると、ログインが有効になります。併せて `AUTH_URL` にエディタのURLを設定してください。

`ALLOWED_EMAILS` に記載したアカウントは常にログインできます。その他のアカウントは、ホーム画面の **設定** にある **ログインできるアカウント** で追加します（サーバーの保存先が必要です）。

#### GitHubのトークン

**Fine-grained personal access token** を作成し、公開に使うすべてのリポジトリに **Contents: Read and write** の権限を付与します。トークンは全サイトで共有するため、サイトを追加したらそのリポジトリも対象に加えてください。対象を「All repositories」にすれば、この作業は不要です。

公開先のリポジトリは、ホーム画面で各サイトの **…** メニューにある **設定** から指定します（[サイトの公開先](#サイトの公開先)）。

### Cloudflare Workers

**1. 保存先の作成（任意）**

```bash
npx wrangler login
cp wrangler.jsonc wrangler.local.jsonc
npx wrangler d1 create tsumu                  # 表示された database_id を wrangler.local.jsonc に設定
npx wrangler kv namespace create ASSETS_KV    # 表示された id を wrangler.local.jsonc に設定
```

`wrangler.local.jsonc` は Git の管理対象外のため、リソースの ID がリポジトリに含まれることはありません。このファイルがあれば、`npm run dev`・`npm run preview`・`npm run deploy` が自動で使用します（別のファイルを使う場合は、環境変数 `WRANGLER_CONFIG` で指定します）。

デプロイ時は選択された設定ファイルを検証し、検証を迂回し得る `--config`・`--env` などのCLI引数を拒否します。本番用の別設定を使う場合は、トップレベルにバインディングを記述したファイルを `WRANGLER_CONFIG` で指定してください。

本番デプロイ時、D1・KV・DocumentRoom の設定が揃っていなければ自動的にブラウザ保存を使用します。既存 Worker の保存先バインディングが失われる場合はデプロイを停止します。稼働中の構成を確認できない場合も、安全のため停止します。新規 Worker、ローカルビルド、Worker Preview では保存先 ID は任意です。

**2. シークレットの設定とデプロイ**

必要な変数を `npx wrangler secret put <名前>` で設定します（[環境変数](#環境変数)）。`wrangler.local.jsonc` を使用している場合は、`--config wrangler.local.jsonc` を付けてください。設定後、デプロイします。

```bash
npm run deploy
```

#### push ごとの自動デプロイ（Workers Builds）

Cloudflare Workers Builds で自動デプロイする場合は、リポジトリを接続し、次のように設定します。

- Build command: `node scripts/cloudflare.mjs build`
- Deploy command: `node scripts/cloudflare.mjs deploy`
- Preview command: `node scripts/cloudflare-preview.mjs`（下記参照）
- ビルド変数（任意。Settings → Build → Variables and secrets）: `D1_DATABASE_ID`・`KV_NAMESPACE_ID`

ビルド時に、スクリプトが `wrangler.jsonc` からデプロイ用の設定ファイル `wrangler.generated.jsonc` を生成します。ビルド変数の ID を埋め込み、ID のないバインディングを除外するため、ID をコミットする必要はありません。 Workers Builds が渡す `WRANGLER_CI_OVERRIDE_NAME` を使用して接続先 Worker 名を生成設定に反映するため、リポジトリの既定名を変更する必要はありません。

#### プルリクエストのプレビュー（Worker Previews）

上記の Preview command を設定すると、Workers Builds はプルリクエストごとに **Worker Preview** をデプロイし、その URL をプルリクエストに投稿します。リポジトリの既定のプレビュー設定は、ログイン不要でデータをブラウザ内に保存する公開デモです。スクリプトは空の D1/KV バインディングを用意して `--ignore-base-config` を付けて実行しますが、既存のプレビューに設定済みのシークレットは削除しません。公開デモとして再利用する前に、シークレットを確認してください。

設定方法とテスト用の保存先については、[エディタのプルリクエストのプレビュー](docs/worker-previews.ja.md) を参照してください。サーバーに保存する場合は、D1・KV の ID に加えて、`COLLAB_ROOM` とともに `DOC_STORE` を `DocumentRoom` にバインドする設定をプレビューに明示する必要があります。共有のテスト用保存先を使う前に、ログインを設定してください。

### Node.js

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使用している場合は、クローン後に `nvm use` を実行してください。

環境変数 `TSUMU_DATA_DIR` にフォルダを指定すると、データを `<フォルダ>/tsumu.db`（SQLite）に、アップロードしたファイルを `<フォルダ>/assets/` に保存します。Node.js 組み込みの `node:sqlite` を使用するため、追加のインストールは不要です。

```bash
npm ci
npm run build
TSUMU_DATA_DIR=./data npm start
```

ログインを設定せずにローカルで試す場合は、`ALLOW_ANONYMOUS=true` を指定します。

```bash
ALLOW_ANONYMOUS=true TSUMU_DATA_DIR=./data npm start
```

その他の環境変数は、`.env.local` またはサーバーの環境変数で設定します（[環境変数](#環境変数)）。ポートは `PORT` で変更できます（既定は 3000）。

**運用上の注意**

- **バックアップ**: `TSUMU_DATA_DIR` に書き込むすべてのプロセスを停止し、自動再起動も無効にしてから、フォルダ全体をコピーします。コピーが終わるまで書き込みを再開しないでください。稼働中の SQLite のデータベースと WAL ファイルを1つずつコピーしても、整合したスナップショットにはなりません。`assets/` と、残っている `tsumu.db-wal`・`tsumu.db-shm` も含め、これらを削除しないでください。コピー先はデータフォルダの外の新しい場所にし、使用する前に[使い捨ての環境での復元](docs/releasing.md#backup-and-restore-validation)を検証してください。
- **1つのフォルダにつき1つのエディタ**: 同じ `TSUMU_DATA_DIR` を使うエディタは1つだけ起動してください。他の編集者の変更は、1つのプロセス内で通知しているためです。
- **リバースプロキシ（nginx など）を使用する場合**:
  - `AUTH_URL` に公開 URL を設定し、プロキシで `X-Forwarded-Host` と `X-Forwarded-Proto` を転送してください。設定しないと、Googleログイン後に正しいアドレスへ戻りません。
  - `/api/collab/events` の応答は、バッファリングせずに転送してください。nginx では、応答の `X-Accel-Buffering: no` ヘッダーにより自動でそのように動作します。

### Docker

イメージには Node.js 版のエディタが含まれ、データはコンテナ内の `/data` に保存します。

```bash
docker build -t tsumu .
docker run -d --name tsumu -p 3000:3000 -v tsumu-data:/data --env-file .env.local tsumu
```

ログインを設定せずにローカルで試す場合は、`-e ALLOW_ANONYMOUS=true` を指定します。

環境変数は `--env-file`（または `-e`）で渡します（[環境変数](#環境変数)）。データがボリュームの外に保存されてしまうため、渡すファイルに `TSUMU_DATA_DIR` は記述しないでください。

**データの保存場所**

```
/data/
  tsumu.db, tsumu.db-wal, tsumu.db-shm   サイトの一覧・編集データ・コメント・バックアップなど（SQLite）
  assets/data/                            アップロードした画像・動画などの本体
  assets/meta/                            各ファイルの種類（Content-Type）
```

- `-v tsumu-data:/data` を指定すると、Docker の名前付きボリューム `tsumu-data` に保存します。コンテナを再作成しても、同じボリュームを指定すればデータは保持されます。
- ホスト上のフォルダに保存する場合は、`-v "$(pwd)/data:/data"` と指定します。コンテナは `node` ユーザー（UID 1000）で動作するため、Linux では事前にフォルダの所有者を変更してください（`sudo chown 1000:1000 data`）。
- **`-v` を指定せずに起動しないでください。** データが匿名のボリュームに保存され、コンテナを再作成すると参照できなくなります。

上の例の名前付きボリュームをバックアップするには、まずエディタを再起動し得る外部の監視を無効にし、このボリュームへの他の書き込みを止めます。次のブロック全体を、データのボリュームの外にあるバックアップ用のディレクトリで実行します。

```bash
(
  set -eu
  data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' tsumu)"
  test "$data_volume" = 'tsumu-data'
  docker stop tsumu
  running="$(docker inspect --format '{{.State.Running}}' tsumu)"
  test "$running" = 'false'
  backup_dir="$(mktemp -d "$PWD/tsumu-backup.XXXXXX")"
  docker run --rm \
    --mount type=volume,src=tsumu-data,dst=/data,readonly \
    --mount "type=bind,src=$backup_dir,dst=/backup" \
    busybox sh -ec 'test -s /data/tsumu.db; tar czf /backup/tsumu-data.tgz -C /data .; tar tzf /backup/tsumu-data.tgz >/dev/null'
  printf 'Backup archive (restore validation pending): %s/tsumu-data.tgz\n' "$backup_dir"
  docker start tsumu
)
```

このブロックは、対象のボリュームと停止状態を確かめ、元のデータを読み取り専用でマウントし、実行ごとに別のディレクトリを作成します。失敗した場合は再起動に進まずに終了します。エラーとコンテナの状態を確認し、安全を確かめてからエディタを再起動してください。途中までのアーカイブは使用しないでください。アーカイブを読み込めるだけでは復元できる保証にならないため、[隔離した環境での復元の手順](docs/releasing.md#backup-and-restore-validation)に従って確認してください。

リバースプロキシの設定は [Node.js](#nodejs) と同じです。

## サイトの公開先

ホーム画面で各サイトの **…** メニューにある **設定** を開き、次の項目を指定します。サイトの作成時にも、作成後にも設定できます。

| 項目 | 内容 |
|---|---|
| GitHubリポジトリ | `owner/name`。未指定でも編集はできますが、公開はできません。 |
| 本番のブランチ | 既定は `main` |
| テスト公開のブランチ | 既定は `preview`。空欄にするとテスト公開を無効にします。 |
| 本番サイトのURL・テストサイトのURL | 任意。指定すると、公開画面から各サイトを開けます。 |

公開先のリポジトリは、初回の公開前に作成しておきます。空のリポジトリでも、README 付きで初期化したリポジトリでも構いません。

## 出力形式

エディタ右上の **公開** ボタンと、**⋯** メニューの **zipでエクスポート** では、フレームワーク・言語・スタイルを選択できます。画面を開くたびに Next.js が選択された状態に戻ります。

| フレームワーク | 出力内容 | 実行方法 |
|---|---|---|
| **Next.js**（既定） | すべての機能に対応します。動的パス（`/news/[slug]` など）、リダイレクトとリバースプロキシ、ISR によるサーバー側のデータ取得、HTMLページも出力できます。 | Next.js に対応したホスティング（[下記](#公開サイトのホスティング)） |
| **React + Vite** | シングルページアプリケーションです。データはブラウザで取得します。 | `npm run build` の後、`dist/` を配信 |
| **Vue 3 + Vite** | 付属の Node.js サーバーで描画し、ブラウザ側でハイドレーションします。 | `npm run build && npm start` |
| **Nuxt** | サーバー側で描画する Nuxt アプリケーションです。 | `npm run build` の後、`node .output/server/index.mjs` |
| **SvelteKit** | `@sveltejs/adapter-node` でサーバー側に描画します。 | `npm run build` の後、`node build` |
| **HTML / CSS / JavaScript** | 静的ファイル一式です。npm もビルドも不要です。 | リポジトリのルートを配信（zip では `index.html` を開くだけで表示可能） |
| **単一のHTML** | 1ページを、CSS・JavaScript・画像・フォントを埋め込んだ1つのHTMLファイルとして出力します。 | ファイルを直接開くか、配信 |

- **言語**は TypeScript・JavaScript、**スタイル**は CSS・CSS Modules・Tailwind CSS から選択します。Tailwind CSS でも、デザインを維持するため Tsumu が生成した CSS を含めます。HTML 形式の2つは JavaScript と CSS に固定です。
- HTML 形式で外部データを取得するには、API 側で CORS を許可する必要があります。`file://` では制約があるため、`localhost` や実際のホスティング環境で確認してください。

Next.js 以外の形式では、次の機能を出力できません。サイトがこれらを使用している場合は画面に一覧で表示され、修正するまで書き出し・公開はできません。

- 動的パス（`[slug]`）、リダイレクト・リバースプロキシのページ
- HTMLページ（HTMLを直接記述したページ。HTML 形式の2つでは出力可能）
- 認証情報を送るデータ取得（`Authorization` ヘッダーや、URL・本文に含めた API キーなど）。閲覧者に露出するためです。
- body 末尾のカスタム `<script>`（React・Vue・Nuxt・SvelteKit）
- HTML 形式での CSS Modules・Tailwind CSS
- 単一のHTMLでの2ページ以上の出力

**公開**は常にプロジェクト全体が対象です。Next.js 以外の形式で本番に公開する場合は、リポジトリのファイル構成が変わり、ホスティング側のビルドと公開ディレクトリの設定も変更が必要になるため、確認画面が表示されます。テスト公開は、どの形式でも検索エンジンの対象外です。

**zip での書き出し**では、出力範囲を **現在のページ** または **選択したコンポーネント**（選択中の要素とその子要素を1つのページとして出力）に限定することもできます。単一のHTMLは常に1ページのみを出力します。zip には書き出した範囲の編集データ（`_tsumu/doc.json`）とアセットの対応表（`_tsumu/assets.json`）が含まれるため、後で[インポート](#インポート)し直せます。`_tsumu/` はウェブサーバーに配置しないでください。

> [!NOTE]
> 公開すると、非公開のページや設定も含むサイト全体の編集データが `_tsumu/doc.json` としてコミットされます。公開リポジトリでは誰でも閲覧できます。

## インポート

ホーム画面で **インポート** をクリックするか、ファイルをドロップすると、新しいサイトとして取り込みます。

| ファイル | 結果 |
|---|---|
| Tsumu から書き出した zip（`_tsumu/doc.json` を含むもの） | 画像などのアセットを含めてサイトを復元します。 |
| `doc.json` | サイトを復元します。データURLで埋め込まれたアセットは再アップロードします。 |
| HTML ファイル、またはウェブサイトの zip | すべての HTML ページを編集可能な要素に変換します。zip 内のその他のファイルはアセットとしてアップロードし、HTML 内のパスを書き換えます。 |

復元できなかったアセットなどの注意事項は、新しいサイトを開いた後に表示されます。

エディタのページ設定から、HTML ファイルや zip を個別のページに読み込むこともできます。通常のページでは編集可能な要素に変換し（既存の要素を置き換える前に確認します）、HTMLページでは HTML をそのまま使用します。zip の場合は `index.html` を優先して読み込みます。

サイズの上限は、zip が100MB、`doc.json` と HTML ファイルが12MBです。ウェブサイトの zip は200ファイル・CSS 合計2MBまでで、CSS の文字コードは UTF-8 のみに対応しています。

> [!TIP]
> `skills/tsumu-site/` は、`doc.json` の形式を AI エージェントに伝えるスキルです。AI にサイトを生成させ、インポートして Tsumu で編集を続けることもできます。

## 公開サイトのホスティング

初回の公開後、サイトのリポジトリをホスティングサービスに接続します。次の表は Next.js 形式の場合です。他の形式では、[出力形式](#出力形式)に従ってビルドと公開ディレクトリを設定してください。

| ホスティング | 設定 | テスト公開 |
|---|---|---|
| **Vercel** | リポジトリをインポートします。追加の設定は不要です。 | 本番以外のブランチに、自動でプレビューURLが付与されます。 |
| **Netlify** | リポジトリをインポートします。 | Branch deploys を有効にします。 |
| **Cloudflare Workers Builds** | Build: `npx opennextjs-cloudflare build`<br>Deploy: `npx opennextjs-cloudflare deploy` | [本番以外のブランチのビルド](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)を有効にします。公開サイトは保存先も Durable Object も持たないため、エディタのプレビュー用の設定は不要です。 |
| **Node.js** | `npm install && npm run build && npm start` | テスト公開のブランチは個別にビルドします。 |

### データの更新間隔と Cloudflare

Next.js 形式では、外部の JSON を使うページを、エディタの **サイト** タブで設定する **データの更新間隔** ごとに再生成します。再生成の方式はホスティングによって異なります。

- **一般的なホスティング**（Vercel・Netlify・Node.js）では、Next.js の ISR により、事前に生成したページをバックグラウンドで再生成します。
- **Cloudflare Workers** で ISR を使うには、追加のキャッシュ（R2）とキューが必要です。これらがないと、事前に生成したページは**一度も再生成されません**。これを避けるには、エディタの **サイト** タブの **公開先のホスティング** で **Cloudflare Workers** を選択してください。該当するページをリクエストごとに描画し、取得した JSON を更新間隔の間 Cloudflare のエッジにキャッシュする形で出力します。

いずれのホスティングでも、更新間隔を `0` にするとリクエストごとにデータを取得します。

### ロールバック

**公開** 画面の **公開履歴・ロールバック**（または **⋯** メニューの **履歴・ロールバック**）に、ブランチごとのコミットが表示されます。各版に対して次の操作ができます。

- **サイトを戻す**: 選択した版のファイルを、新しいコミットとしてブランチの先頭に再コミットします。履歴は残るため、ロールバック自体も取り消せます。
- **編集内容を復元**: 公開時に保存された編集データ（`_tsumu/doc.json`）をエディタに読み込みます。通常の編集として扱われるため、⌘Z で元に戻せます。

同じ画面には、サーバーに保存された編集データの日次バックアップ（曜日ごとに1つ、計7日分）も表示されます。

## AIに頼む（任意）

`AI_ENABLED=true` と API キーを設定すると、**AIに頼む** ボタンが表示されます。リクエストはエディタのサーバーの `/api/ai` を経由するため、API キーがブラウザに渡ることはありません。

### 仕組み

1. ブラウザが、編集中のページの要約（要素の階層・テキスト・スタイル）を送信します。他のページは名前のみを送信します。
2. サーバーが、エディタのデータ構造の説明と `edit_site` ツールを加えて AI に渡します。
3. AI が編集操作（スタイルの変更、要素の追加・移動、テキストの変更など）を返します。
4. サーバーが、その操作をページの複製に試験的に適用します。失敗した操作があれば、エラーを AI に返して修正させます。
5. 正常に適用できた操作のみがブラウザに返され、1回で取り消せる変更として適用されます。

スクリプト・データの設定・アセットは、AI による編集の対象外です。

### プロバイダの選択

| `AI_PROVIDER` | APIキー | `AI_MODEL` の既定 | 備考 |
|---|---|---|---|
| `anthropic`（既定） | `ANTHROPIC_API_KEY` | `claude-opus-5-5` | `claude-sonnet-5-5`・`claude-haiku-5-5` で費用を抑えられます |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` | Gemini の OpenAI 互換 API を使用します。最も安価なのは `gemini-2.5-flash-lite` で、無料枠があります |
| `openai` | `OPENAI_API_KEY` | `AI_MODEL` で指定 | |
| `openai-compatible` | `AI_API_KEY` | `AI_MODEL` で指定 | ツール呼び出しに対応した Chat Completions API（OpenRouter・Ollama など）。`AI_BASE_URL` を指定します |

- `AI_API_KEY` は、すべてのプロバイダで使用できます。
- `AI_EFFORT`（`low` 〜 `max`、既定は `medium`）で推論の量を調整できます。低いほど費用を抑えられます。
- 小規模なモデルほど編集操作の誤りが増えます。誤りはサーバーが検出して修正させるためページは破損しませんが、やり取りの回数が増えます。
- Gemini などの無料枠では、送信した内容がサービスの改善に利用される場合があります。

### 例: Gemini を使用する場合

エディタの実行環境に次の値を設定します。設定先は、ローカル環境と Node.js では `.env.local`、Docker では `--env-file` で渡すファイル、Cloudflare では Worker の Variables and Secrets です。

```dotenv
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your-api-key
```

API キーはシークレットとして保存してください。`AI_API_KEY` はプロバイダ別のキーより優先されるため、プロバイダを切り替える際は古い共通キーが残っていないか確認してください。Claude・OpenAI・互換 API を使う場合も、上の表に従って設定します。

### 動作の確認

ログインした状態で `/api/ai` を開くと、AI の利用可否と使用するモデルを確認できます。`AI_ENABLED` を設定しても利用可能にならない場合は、不足している設定がサーバーのログに出力されます。設定の変更後は、ローカル環境・Node.js・Docker ではエディタを再起動し、Cloudflare では設定を反映してから、エディタに戻ってください。

### 編集内容の保護

AI による編集は、ページに反映する前に必ず作業用の複製で検証します。

- 通信の切断、タイムアウト、解消されない操作のエラー、生成の途中終了が発生した場合は、何も適用しません。
- 応答を待つ間に同じページを編集した場合は、その編集を上書きしないよう、AI の結果を適用しません。
- 依頼はチャットの中止ボタンで取り消せます。適用された変更は、1回の「元に戻す」で取り消せます。
- 処理中のチャットには、AI による簡潔な説明、変更案の準備・検証・修正の進捗、経過時間が表示されます。完了後も「作業の記録」で確認できます。AI の内部の思考過程や署名は表示しません。

## 環境変数

すべて任意です（[環境設定](#環境設定)）。

| 変数 | 内容 |
|---|---|
| `AUTH_SECRET` | セッションの秘密鍵。`npx auth secret` で生成します。 |
| `ALLOW_ANONYMOUS` | `true` にすると、Googleログインが未設定でもログインなしで利用できます（`npm run dev` では不要）。URLを知っている人は誰でも編集・公開できるため、ローカル環境かデモに限って使用してください。 |
| `AUTH_URL` | 本番環境のエディタのURL（例: `https://tsumu.example.com`） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google の OAuth クライアント |
| `ALLOWED_EMAILS` | 常にログインを許可するGoogleアカウント（カンマ区切り）。画面からは削除できません。その他のアカウントは、ホーム画面の **設定** で管理します。 |
| `GITHUB_TOKEN` | 公開先のすべてのリポジトリに Contents: Read and write の権限を持つトークン（全サイト共通） |
| `AI_ENABLED` | `true` で「AIに頼む」を有効にします。 |
| `AI_PROVIDER` | `anthropic`（既定）・`gemini`・`openai`・`openai-compatible` |
| `AI_API_KEY` | API キー（`ANTHROPIC_API_KEY`・`GEMINI_API_KEY`・`OPENAI_API_KEY` でも可） |
| `AI_MODEL` | モデル ID。既定は `claude-opus-5-5`（anthropic）・`gemini-3.8-flash`（gemini） |
| `AI_BASE_URL` | `openai-compatible` で使用する API の URL（例: `https://openrouter.ai/api/v1`） |
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
| Durable Objects内SQLiteの1項目 | 最大8MB | 編集データはページ・要素などの個別行へ保存し、Tsumuでは各項目を最大7MBに制限します。 |
| KV | 合計1GB、1ファイル25MB、書き込みは1日1,000回まで | 容量は全サイトで共有されます。アセットタブには全サイトの合計が表示されます。 |
| KV の整合性 | 結果整合性 | アップロードしたファイルが全体に反映されるまで、数秒かかる場合があります。 |
| GitHub API | 1時間あたり5,000リクエスト | 1回の公開で数回から十数回のリクエストを使用します。 |

### サイト

- サイトを削除すると、その編集データと自動バックアップも削除されます。公開済みのリポジトリと、保存先の画像は削除されません。
- サイト間でコピーした画像は、同じ保存先を共有します。Cloudflareでは同時編集による誤削除を防ぐため、アセットの参照を削除してもKV内のファイルは即時削除されません。不要ファイルの回収には別途ガベージコレクションが必要です。
- D1 がない場合、サイトはそのブラウザ内にのみ保存され、ブラウザのデータを削除すると失われます。

### 同時編集

**コメント**

- コメントは編集データとは別に保存され、公開サイトには含まれず、「元に戻す」の対象にもなりません。編集・削除できるのは投稿者本人のみです。
- スレッドを開くと一覧と切り替わり、いずれもパネルの高さ全体に表示されます。未送信の返信や新規コメントは、送信またはキャンセルするまでスレッドごとに保持され、一覧に戻ったり一覧を切り替えたりしても失われません。
- 要素やページを削除しても、コメントは保持されます。削除された要素へのコメントはラベルを強調して通常の一覧に表示され、削除されたページへのコメントがある場合は「すべてのページ」への切り替えを案内します。いずれも表示・返信・解決が可能です。削除を元に戻すと要素は同じ ID で復元され、コメントも再び関連付けられます。対象を削除・非表示にしても、入力中の返信や新規コメントは失われません。
- パネル上部のボタンでキャンバス上のピンを非表示にし、下のデザインを確認できます。⌥（Alt）キーを押している間も非表示になります。
- コメント一覧は、作成日時の新しい順に1,000スレッドずつ読み込み、古い一覧・新しい一覧へ移動できます。絞り込みとキャンバス上のピンは、読み込んだ範囲に適用されます。スレッド内の返信はまとめて読み込みます。
- 返信の入力中にスレッドが削除された場合、未送信の文章は閉じるまでコピーできる状態で残ります。削除されたスレッドは復元されず、以降の送信はできません。

**編集のマージ**

- マージは要素の項目単位で行います。異なる要素、または同じ要素の異なる項目（テキストと色など）を同時に編集した場合は、両方の変更が保持されます。同じ項目を同時に編集した場合は、後から保存した変更が優先されます。
- スクリプトの手順などの一覧は、全体を1つの項目として扱います。
- 未保存の変更がある間や文字の入力中は、他の編集者の変更を入力の完了後に取り込みます。
- 他の編集者の変更を取り込むと、「元に戻す」の履歴もそれに合わせて再構成されます。

**記録とアクセス**

- 編集・公開の記録には、各ユーザーが最後に編集・公開した時刻が保存されます。Googleログインを使用していない場合は、全員が1人のゲストとして表示されます。
- 許可リストから削除したアカウントは、ログイン済みであっても次の API アクセスから拒否されます。同時編集の接続も、読み込み・保存・更新通知の前に権限を再確認します。

### エディタと書き出し

- **公開は通常のコミットです。** Tsumu が生成したファイルはエディタの内容で置き換え、手動で追加したファイルは保持します。両者は `_tsumu/generated.json` で区別します。
- **GitHub 上での変更を検出します。** 生成したファイルが GitHub 上で編集されていた場合は、上書きの前に確認を求めます。生成したファイルを手動で変更し続ける場合は、別のブランチで行ってください。
- **初回の公開でも既存のファイルを保持します。** 同じパスのファイルを上書きする前には確認を求めます。
- **`_tsumu/` は Tsumu の管理情報専用です。** 生成したファイルの一覧が破損している場合は、公開を中止します。
- ページ専用のカスタムコードは、`<head>` ではなくページ本文の先頭と末尾に挿入されます。
- キャンバスでは、カスタムコードとアイコンを無害化して表示し、カスタムコード内の iframe はエディタとは別オリジンのサンドボックスで実行します。スクリプトやイベント属性が実行されるのは公開したサイトのみで、ログイン中のエディタの権限で実行されることはありません。
- `next/image` は、すべてのホスティングで動作するよう `unoptimized` で出力します。
- HTMLページ（HTMLを直接記述したページ）には、共通のレイアウト・メタデータ・カスタムコードは適用されません。出力できるのは Next.js 形式と HTML 形式のみです。
- テキストを span に分割した後は、span ごとに編集します。
- ログインは Google アカウントのみに対応しています。

## 開発

設計の概要（`SiteDoc` のデータ構造、公開・同時編集・AI の仕組み）は [ARCHITECTURE.ja.md](ARCHITECTURE.ja.md) にまとめています。

```
app/
  page.tsx            ホーム（サイトの一覧）
  sites/[id]/         エディタ
  login/              ログイン画面
  api/sites/          サイトの一覧・作成・設定・削除
  api/doc/            サイトごとの編集データ、日次バックアップ
  api/comments/       キャンバスのコメント
  api/activity/       最近編集した人・最後に公開した人
  api/publish/        生成したファイルの GitHub へのコミット、履歴とロールバック
  api/assets/         画像などのアップロード・配信・使用量
  api/ai/             AIに頼む
  api/collab/         同時編集（WebSocket のログイン確認、Server-Sent Events）
  api/fetch-json/     エディタでのデータ取得（サーバー経由）
  api/allowed-users/  ログインできるアカウント
  api/status/         ログイン・保存先の設定状況と、ログイン中のユーザー
components/           画面（Home・Editor・Canvas・各パネル・ScriptEditor・HelpCenter など）
  canvas/ left-panel/ style-panel/ script-editor/   大きな画面の部品
lib/
  types.ts            SiteDoc のデータ構造
  sites.ts            サイトの型・入力の検証・D1 への保存
  site.ts             開いているサイト・ブラウザ保存のキー・D1 がない場合のサイトの一覧
  generator.ts        SiteDoc → Next.js プロジェクト（部品は generator/）
  export-formats.ts   出力形式の選択肢・制限と、zip・公開で共通の出力処理
  exportZip.ts        書き出す zip（再インポート用の編集データを含む）
  site-import.ts      Tsumu の zip・doc.json の復元（サイトの作成は import-site-file.ts）
  html-to-site.ts     HTML を編集可能な要素に変換（html-file-import.ts・html-zip.ts）
  script.ts           スクリプトのデータ構造（実行ランタイムは script-runtime.ts。キャンバスと書き出したサイトで共用）
  site-document-service.ts  サイトごとの編集データの保存先の振り分け（Cloudflare は Durable Object、それ以外はローカルの SQLite）
  structured-document-store.ts  DocumentRoom（Durable Object）内の SQLite の構造（ページ・要素ごとの行）
  node-storage.ts     Cloudflare 以外での保存先（SQLite・ファイル。TSUMU_DATA_DIR）
  store.ts            エディタの状態（zustand）と元に戻す履歴
  clip-transfer.ts    サイト間のコピー＆ペースト
  page-transfer.ts    ページを他のサイトへコピー
  comments.ts         サーバーでのコメントの保存（サーバーがない場合は comment-store.ts がブラウザ内に保存）
  activity.ts         編集・公開の記録
  aiOps.ts            AI の編集操作（サーバーとブラウザの両方で適用）
  manualTopics.ts     ヘルプの記事
  locales/            英語の訳
custom-worker.ts      同時編集の Durable Object を含む Cloudflare Worker のエントリポイント
document-room.ts      サイトごとの編集データを保存する Durable Object（DocumentRoom）
scripts/cloudflare.mjs  デプロイ用の wrangler 設定を生成し、OpenNext を実行
```

```bash
npm run typecheck      # tsc --noEmit
npm test               # 同時編集・元に戻す・スクリプト・公開などの回帰テスト
npm run i18n:check     # 英訳の漏れを検出（他の言語は npm run i18n:check -- <言語コード>）
npm run build && npm run test:e2e   # 実際のブラウザによるE2Eテスト（Playwright。初回は npx playwright install chromium firefox webkit）
```

出力形式のビルドを確認するには、サンプルのプロジェクトを生成してビルドします（CI では全フレームワークを TypeScript と JavaScript の両方で確認しています）。

```bash
node --import tsx scripts/smoke-export-build.mts vue typescript   # nextjs・react・vue・nuxt・sveltekit
cd .generated-export-smoke && npm install && npm run build
```

### 翻訳

画面の文言は日本語で記述し、`tr("…")` で囲みます（`lib/i18n.ts`）。他の言語は、日本語の原文と訳を対応付けた辞書 `lib/locales/<言語コード>.ts` で管理します。英語のヘルプとチュートリアルの文言は `en-help.ts` に分けています。

訳がない文言は英語で、英訳もない場合は日本語の原文で表示されます。値を埋め込む場合は `tr("{name}を削除", { name })` のように記述します。

#### 言語の追加

1. `lib/lang.ts` の `LANGUAGES` に言語を追加します。キーは `zh`・`ko`・`fr` のような BCP 47 の言語コードです。
2. `Dict` をエクスポートするファイル `lib/locales/<言語コード>.ts` を作成します。`en.ts` を複製して値を翻訳するのが最も簡単です。未翻訳の項目は削除すれば英語で表示されます。
3. `lib/locales/index.ts` の `LOCALES` に登録します。
4. `npm run i18n:check -- <言語コード>` で、未翻訳の文言を確認します。

追加した言語は、ホーム画面の **設定** にある **表示言語**（エディタでは **⋯** メニューの **設定**）に表示され、ブラウザの言語設定に応じて自動で選択されます。

### ヘルプの記事

ヘルプの記事は `lib/manualTopics.ts` に記述します。各記事は、質問、1行の要約、本文のブロック（段落・箇条書き・表・ヒント・図解）で構成されます。

- 本文では `**強調**`・`` `コード` ``・`[[記事ID|リンクの文字]]` を使用できます。
- 図解は `components/HelpFigures.tsx` の React コンポーネントで、説明対象の CSS そのものを使って描画します。
- 操作ガイドの各ステップの `target` には、画面側の `data-tutorial` 属性の値を指定します。

## コントリビュート

Issue とプルリクエストを歓迎します（英語・日本語のいずれでも可）。手順と実行するチェックは [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)、脆弱性の非公開での報告は [SECURITY.ja.md](SECURITY.ja.md)、行動規範は [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（英語）を参照してください。

## ライセンス

[MIT](LICENSE) © abshrimp
