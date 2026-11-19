# Tsumu 詳細ガイド

[README](../README.ja.md) · [English](user-guide.md)

## 構成

以下の図は `PUBLISH_PROVIDER=github`（GitHub または GitLab.com へのコミット）の構成です。`netlify`・`cloudflare` の場合は、Gitリポジトリを介さず、サイトごとの公開プロジェクトへ生成済みの静的HTML・CSS・JavaScriptだけを送信します。編集用データは公開しません。

```
Tsumu（このリポジトリ）
│  Cloudflare Workers ／ Node.js ／ Docker のいずれかで動作
│  ホーム（サイトの一覧）・エディタ /sites/<id>・Googleログイン（任意）
│
│  公開 → main ／ テスト公開 → preview
▼
サイトごとのリポジトリ（GitHub ／ GitLab.com）
│  サイトA・サイトB・…（それぞれ main が本番、preview がテスト）
│
│  ブランチごとに自動でビルド
▼
ホスティング（任意）
   Vercel / Netlify / Cloudflare Workers / Node.js
```

構成要素は次の3つです。

- **エディタ**: Cloudflare Workers・Node.js・Docker で動作する Next.js アプリケーションです（[エディタのデプロイ](#エディタのデプロイ)）。サイトの一覧、編集データ、コメント、編集・公開の記録、ログインの許可リスト、アップロードしたアセット（画像・動画・音声・カスタムフォント・インポートした HTML ZIP のファイル）を保存します。アップロードしたアセットの参照権限はサイトごとに管理され、サイト間でページや要素をコピーした場合は保存先のファイルを共有します。保存先は実行環境によって異なります。
- **公開サイト**: GitHubまたはGitLab.comのサイト別リポジトリにコミットするアプリケーション、またはNetlify・Cloudflare Pagesへ直接アップロードする静的HTMLサイトです。エディタと同じ環境で動作させる必要は**ありません**。
- **テスト公開**: 同じリポジトリの別ブランチ（既定は `preview`）にコミットします。Vercel・Netlify・Cloudflare Workers Builds は本番以外のブランチをプレビューとしてビルドできるため、1つのホスティング設定で本番とテストの両方を扱えます（Netlify と Cloudflare Workers Builds では、この機能を有効にします。[公開サイトのホスティング](#公開サイトのホスティング)を参照）。テスト版は robots.txt・`noindex`・`X-Robots-Tag` ヘッダー・クローラーの拒否により、検索エンジンの対象外としています。

## 環境設定

ローカル開発は環境変数なしで開始できます。本番では Google ログインを設定するか、匿名アクセスを明示的に許可します。保存先・公開先・AI はそれぞれ個別に設定します。

| 設定 | 未設定の場合 | 設定した場合 |
|---|---|---|
| サーバーの保存先（Cloudflare は D1・Durable Objects・KV、Node.js・Docker は `TSUMU_DATA_DIR`） | サイトの一覧・編集データ・コメント・アップロードしたファイルをブラウザ内に保存します。参照できるのはそのブラウザのみで、ファイルは1つ2MBまでです。保存先があっても `TSUMU_STORAGE_MODE=local` を設定すると、この動作になります。 | サーバーに保存します。別の端末からの編集や、複数人での編集・コメントが可能になり、日次バックアップと編集・公開の記録も保存されます。ファイルは1つ25MBまでです。 |
| Googleログイン（`AUTH_*`） | ローカル開発ではループバック宛ての匿名アクセスを受け付けます。本番環境で匿名アクセスを許可するには `ALLOW_ANONYMOUS=true` の設定が必要です。 | 許可したGoogleアカウントのみがログインできます（**編集者**または**閲覧のみ**の権限）。 |
| 公開先（`PUBLISH_PROVIDER` と各サービスの認証情報） | 「公開」で必要な設定を案内します。zip での書き出しは可能です。 | 選んだサービスに公開できます（[サイトの公開先](#サイトの公開先)）。 |
| `AI_*` | 「AIに頼む」ボタンは表示されません。 | 「AIに頼む」を利用できます。 |

> [!IMPORTANT]
> インターネットからアクセスできるエディタには、必ずGoogleログインを設定してください。ログインなしで運用してよいのは、ローカル環境でのみ使用する場合と、サーバーに公開用のトークン（`GITHUB_TOKEN`・`GITLAB_TOKEN`・`CLOUDFLARE_API_TOKEN`）を置かない構成に限られます。後者の例は[ログインなしで Netlify に公開する構成](#ログインなしで-netlify-に公開する構成)です。

## ローカルで起動

Node.js 26.12.1 以上と npm 12.2.1 以上が必要です。nvm を使用している場合は、クローン後に `nvm use` を実行してください。

```bash
git clone https://github.com/abshrimp/tsumu.git
cd tsumu
npm ci
npm run dev
```

http://localhost:3000 を開くと、ホーム画面（サイトの一覧）が表示されます。「新しいサイト」を選択するとサイトが作成され、`/sites/<id>` でエディタが開きます。

`npm run dev` で起動すると、次のように動作します。

- `wrangler.jsonc` に基づき、Cloudflare の D1・KV をローカルで再現します。データは `.wrangler/state` に保存されます。`TSUMU_DATA_DIR` を設定していても、こちらが優先されます。
- Google ログインが未設定の開発サーバーは、既定でリクエストのホスト名を確認します。`localhost`、末尾が `.localhost` の名前、`127.0.0.0/8` の IPv4 アドレス、`[::1]` を受け付けます。いずれもポート番号を指定できます。
- LAN 内の別端末から匿名で試す場合は、`.env.local` に `ALLOW_ANONYMOUS=true` を設定して開発サーバーを再起動します。ローカルの Worker プレビューでは `.dev.vars` に設定します。この設定では他のホスト名からもアクセスできるため、サーバーに届く人は誰でも編集でき、設定済みの公開先への公開もできます。
- WebSocket は使えないため、他の編集者の変更は Server-Sent Events（SSE）で反映されます。SSE も使えない場合は、10秒間隔のポーリングに切り替わります。WebSocket によるリアルタイムの反映を確認するには、`npm run preview` を使用します。

## エディタのデプロイ

稼働中のエディタを更新する前に、[リリース時の安全確認](releasing.md)（英語）に沿って、ステージングでの確認、バックアップと復元の検証、ロールバック、監視を行ってください。

エディタの実行環境によって、保存先、削除したアセットを復元できる期間、共同編集の通信方式が異なります。

| | Cloudflare Workers | Node.js | Docker |
|---|---|---|---|
| 保存先 | D1（サイト情報）・SQLite対応Durable Objects（編集データ）・Workers KV（画像など） | `TSUMU_DATA_DIR` のフォルダ（SQLite・ファイル） | コンテナの `/data`（ボリュームをマウント） |
| アップロードしたアセットの削除 | **アセット → ゴミ箱** から復元・完全削除できます | 他のサイトが使っていなければ、その場でファイルを削除します | Node.js と同じ |
| 他の編集者の変更の反映 | 即時（WebSocket・Durable Object） | 即時（Server-Sent Events） | 即時（Server-Sent Events） |
| 費用 | 無料プランで運用可能（[制限事項](#制限事項)） | サーバー費用 | サーバー費用 |
| 適した用途 | 自前のサーバーを持たずに運用する場合 | ローカル環境や既存のサーバーで運用する場合 | コンテナで管理する場合 |

D1とローカルSQLiteのテーブルは、初回のアクセス時に自動で作成されます。Cloudflareで編集データを保存するには、`DOC_STORE`バインディングと、`wrangler.jsonc`の`exports.DocumentRoom`（SQLite）の宣言が必要です。保存方式とデプロイ時の確認事項は[編集データの保存設計](durable-object-storage.md)（英語）を参照してください。サーバーの保存先がない場合、データはブラウザ内に保存されます（[環境設定](#環境設定)）。

Cloudflare のゴミ箱に入ったファイルもストレージ使用量に含まれます。自動削除は既定で無効です。`ASSET_GC_ENABLED=true` にすると、毎日午前3時（日本時間）に、猶予期間（既定は7日、`ASSET_GC_GRACE_DAYS` で変更可）を過ぎたファイルを確認します。他のサイトで使われているファイルは保持します。ゴミ箱の **完全に削除** は自動削除が無効でも使えます。参照の確認範囲と週次の調査は [KV アセットの削除処理](asset-gc.md)（英語）を参照してください。

### 共通の準備

#### Googleログイン

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で、種類が「ウェブ アプリケーション」の OAuth クライアントIDを作成します。
2. 承認済みのリダイレクトURIに次を追加します。
   - `https://<エディタのドメイン>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`（ローカル環境でログインを確認する場合のみ）
3. OAuth 同意画面はテストモードのままで構いません。自身をテストユーザーに追加してください。

`AUTH_SECRET`・`AUTH_GOOGLE_ID`・`AUTH_GOOGLE_SECRET` をすべて設定すると、ログインが有効になります。併せて `AUTH_URL` にエディタのURLを設定してください。

`ALLOWED_EMAILS` に記載したアカウントは、復旧のため全サイトを管理できる全体管理者です。その他のアカウントは、ホーム画面の **設定** にある **ログインできるアカウント** で**編集者**または**閲覧のみ**として追加します（サーバーの保存先が必要です）。

ログインできるだけでは、サーバーに保存された個々のサイトにはアクセスできません。サイトの作成者が最初の**オーナー**になります。オーナーは、ホーム画面で各サイトの **… → メンバーと権限** を開き、登録済みのアカウントに **オーナー**・**編集者**・**閲覧のみ** の権限を設定できます。

- 編集者はそのサイトを編集・公開でき、閲覧者は変更できません。
- サイトのメンバーでない利用者には、そのサイトを一覧に表示せず、URL を直接開いても拒否します。
- アカウント全体の権限が「閲覧のみ」の場合は、サイトの権限で編集者にしても編集できません。
- 各サイトには、オーナーが1人以上必要です。

#### GitHub・GitLabのトークン

GitHubの場合は **Fine-grained personal access token** を作成し、公開先に **Contents: Read and write** の権限を付与します。GitLab.comの場合は **api** スコープと対象プロジェクトへの書き込み権限のあるトークンを `GITLAB_TOKEN` に設定します。認証情報は各サービスごとにサーバー内の全サイトで共有されるため、必要なリポジトリだけに権限を付与してください。

公開先のリポジトリは、ホーム画面で各サイトの **…** メニューにある **設定** から指定します（[サイトの公開先](#サイトの公開先)）。

### Cloudflare Workers

**1. 保存先の作成（任意）**

```bash
npx wrangler login
cp wrangler.jsonc wrangler.local.jsonc
npx wrangler d1 create tsumu                  # 表示された database_id を wrangler.local.jsonc に設定
npx wrangler kv namespace create ASSETS_KV    # 表示された id を wrangler.local.jsonc に設定
```

`wrangler.local.jsonc` は Git の管理対象外のため、リソースの ID がリポジトリに含まれることはありません。このファイルがあれば、`npm run dev`・`npm run preview`・`npm run deploy` は自動でこのファイルを使用します（別のファイルを使う場合は、環境変数 `WRANGLER_CONFIG` で指定します）。

デプロイ時には、選択された設定ファイルを検証します。この検証を迂回できる `--config`・`--env` などのCLI引数は受け付けません。本番用の別設定を使う場合は、トップレベルにバインディングを記述したファイルを `WRANGLER_CONFIG` で指定してください。

本番へのデプロイで D1・KV・DocumentRoom の設定が揃っていない場合は、データをブラウザ内に保存する構成になります。ただし、既存の Worker の保存先バインディングが失われる場合はデプロイを停止します。稼働中の構成を確認できない場合も、安全のため停止します。新規の Worker、ローカルビルド、Worker Preview では、保存先の ID は任意です。

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

ビルド時に、スクリプトが `wrangler.jsonc` からデプロイ用の設定ファイル `wrangler.generated.jsonc` を生成します。このファイルにはビルド変数の ID が埋め込まれ、ID のないバインディングは除外されるため、ID をコミットする必要はありません。接続先の Worker 名も、Workers Builds が渡す `WRANGLER_CI_OVERRIDE_NAME` から生成した設定に反映されるため、リポジトリにある既定の名前を変更する必要はありません。

#### プルリクエストのプレビュー（Worker Previews）

上記の Preview command を設定すると、Workers Builds はプルリクエストごとに **Worker Preview** をデプロイし、その URL をプルリクエストに投稿します。リポジトリの既定のプレビュー設定は、ログイン不要でデータをブラウザ内に保存する公開デモです。スクリプトは空の D1/KV バインディングを用意し、`--ignore-base-config` を付けて実行します。ただし、既存のプレビューに設定済みのシークレットは削除しません。公開デモとして再利用する前に、シークレットを確認してください。

設定方法とテスト用の保存先については、[エディタのプルリクエストのプレビュー](worker-previews.ja.md) を参照してください。サーバーに保存する場合は、D1・KV の ID に加えて、`COLLAB_ROOM` とともに `DOC_STORE` を `DocumentRoom` にバインドする設定をプレビューに明示する必要があります。共有のテスト用保存先を使う前に、ログインを設定してください。

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

- **バックアップ**: `TSUMU_DATA_DIR` に書き込むすべてのプロセスを停止し、自動再起動も無効にしてから、フォルダ全体をコピーします。コピーが終わるまで書き込みを再開しないでください。稼働中の SQLite のデータベースと WAL ファイルを1つずつコピーしても、整合したスナップショットにはなりません。`assets/` と、残っている `tsumu.db-wal`・`tsumu.db-shm` も含め、これらを削除しないでください。コピー先はデータフォルダの外の新しい場所にし、使用する前に[使い捨ての環境での復元](releasing.md#backup-and-restore-validation)を検証してください。
- **1つのフォルダにつき1つのエディタ**: 同じ `TSUMU_DATA_DIR` を使うエディタは1つだけ起動してください。他の編集者の変更の通知は、1つのプロセスの中でだけ届くためです。
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

上の例の名前付きボリュームをバックアップするには、まずエディタを自動で再起動する外部の監視を無効にし、このボリュームへの他の書き込みを止めます。次のブロック全体を、データのボリュームの外にあるバックアップ用のディレクトリで実行します。

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

このブロックは、対象のボリュームとコンテナの停止を確かめたうえで、元のデータを読み取り専用でマウントし、実行のたびに別のディレクトリへアーカイブを作成します。途中で失敗した場合は、コンテナを再起動せずに終了します。エラーとコンテナの状態を確認し、安全を確かめてからエディタを再起動してください。途中までのアーカイブは使用しないでください。アーカイブを読み込めても、復元できるとは限らないため、[隔離した環境での復元の手順](releasing.md#backup-and-restore-validation)に従って確認してください。

リバースプロキシの設定は [Node.js](#nodejs) と同じです。

## サイトの公開先

公開先のサービスは、サーバーの `PUBLISH_PROVIDER` で Tsumu 全体に1つ選びます。認証情報はサイトの設定には保存しません。

| `PUBLISH_PROVIDER` | 公開のしかた | テスト公開 | 必要な設定 |
|---|---|---|---|
| `github`（既定） | サイトごとの GitHub または GitLab.com のリポジトリに、生成したコードと編集データをコミットします。 | 同じリポジトリの別ブランチ | `GITHUB_TOKEN`・`GITLAB_TOKEN`（[共通の準備](#共通の準備)） |
| `netlify` | 利用者自身の Netlify アカウントに、生成した静的ファイルをアップロードします。Tsumu へのログインやサーバーの保存先がなくても使えます。 | 別の Netlify プロジェクト | Netlify の OAuth アプリ（[下記](#ログインなしで-netlify-に公開する構成)） |
| `cloudflare` | Cloudflare Pages に、生成した静的ファイルをアップロードします。 | プレビューブランチ（`tsumu-preview`） | `CLOUDFLARE_ACCOUNT_ID`・`CLOUDFLARE_API_TOKEN` とサーバーの保存先 |

Netlify と Cloudflare Pages では、初回の公開時にサイトごとの公開プロジェクトを自動で作成します。プロジェクト名は `<PUBLISH_PROJECT_PREFIX>-<サイトのID>` です。アップロードするのは生成した静的な HTML・CSS・JavaScript・アセットだけで、編集データは含みません。Next.js のサーバー専用の機能は使えません。

独自ドメインは公開サービスで設定し、必要に応じてサイトの設定に URL を入力します。Tsumu でサイトを削除しても、公開サービスのプロジェクトやリポジトリは削除されません。

**GitHub・GitLab.com** を使う場合、`PUBLISH_PROVIDER=github` とし、ホーム画面で各サイトの **… → 設定** を開き、次の項目を指定します。サイトの作成時にも、作成後にも設定できます。

| 項目 | 内容 |
|---|---|
| Gitサービス | GitHub または GitLab.com |
| リポジトリ | GitHubは `owner/name`、GitLabは `group/project` や `group/subgroup/project`。未指定でも編集できますが、公開はできません。 |
| 本番のブランチ | 既定は `main` |
| テスト公開のブランチ | 既定は `preview`。空欄にするとテスト公開を無効にします。 |
| 本番サイトのURL・テストサイトのURL | 任意。指定すると、公開画面から各サイトを開けます。 |

公開先のリポジトリは、初回の公開前に作成しておきます。空のリポジトリでも、README 付きで初期化したリポジトリでも構いません。

### ログインなしで Netlify に公開する構成

`tsumu.ebii.net` のように、誰でも開けるエディタでは次のように設定します。

1. `PUBLISH_PROVIDER=netlify`・`TSUMU_STORAGE_MODE=local`・`ALLOW_ANONYMOUS=true` を設定します。Googleログインの `AUTH_SECRET`・`AUTH_GOOGLE_ID`・`AUTH_GOOGLE_SECRET` は設定しません。Cloudflare D1 が接続されていても、訪問者の編集データはブラウザごとに保存します。KV へのアセットの保存も無効になり、アセットはブラウザ内に保存します（1ファイル2MBまで）。
2. Netlify の **User settings → Applications** で OAuth アプリを作成し、リダイレクト先に `https://tsumu.ebii.net/netlify/callback` を登録します。Tsumu には `NETLIFY_OAUTH_CLIENT_ID` と、登録したものと同じ `NETLIFY_OAUTH_REDIRECT_URI` だけを設定します。共通の Netlify API トークンや OAuth の Client Secret は不要です。
3. 利用者が **公開** を押すと、初回だけ自身の Netlify アカウントで認証します。認証後は同じサイトの公開画面に戻ります。Netlify のチームが1つなら自動で選ばれ、複数あれば利用者が選びます。本番とテストには別々の Netlify プロジェクトを使います。
4. Netlify のアクセストークンとサイトごとの公開先の ID は、ブラウザの localStorage に保存します。公開するときだけ、Tsumu のサーバーが Netlify API への要求を中継し、ZIP の内容と Netlify のチームを確認します。**Tsumu のサーバーには、トークンや編集データを保存しません。** Netlify の無料枠と請求は、利用者が選んだチームに属します。

localStorage のトークンは、同じオリジンで動くスクリプトから読み取れます。不審なスクリプトやブラウザ拡張に注意してください。別のブラウザからは、編集データも Netlify の接続情報も参照できません。ブラウザのデータを削除すると、編集データと公開先の対応は失われますが、Netlify に公開済みのサイトは残ります。編集データはバックアップ ZIP で保管してください。別のブラウザから以前の Netlify プロジェクトに自動でつなぎ直す機能はありません。

## 出力形式

**GitHub・GitLab** では、エディタ右上の **公開** ボタンと、**⋯** メニューの **zipでエクスポート** で開く画面からフレームワーク・言語・スタイルを選択できます。サーバー保存を使用しているサイトでは、テスト・本番のどちらに公開した場合も、前回 Git への push に成功したときのフレームワーク・言語・スタイルを次回の公開に引き継ぎます。初回の公開と毎回の ZIP 書き出しは、Next.js・TypeScript・CSS が初期値です。

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

Next.js 以外の形式では、次の機能を出力できません。サイトがこれらを使用している場合は画面に一覧で表示され、修正するまで書き出しと公開はできません。

- 動的パス（`[slug]`）、リダイレクト・リバースプロキシのページ
- HTMLページ（HTMLを直接記述したページ。HTML 形式の2つでは出力可能）
- body 末尾のカスタム `<script>`（React・Vue・Nuxt・SvelteKit）
- 外部データを使うページのカスタム `<script>`（React）
- カスタムコードと読み込み画面（Vue・Nuxt・SvelteKit）
- HTML 形式での CSS Modules・Tailwind CSS
- 単一のHTMLでの2ページ以上の出力

認証情報を送るデータ取得（`Authorization` ヘッダーや、URL・本文に含めた API キーなど）は、Next.js を含むどの形式でも書き出し・公開できません。生成したソースファイルや zip 内の編集データに値が残るためです。認証情報はサーバーの環境変数や API のプロキシで管理してください。

**公開**は常にプロジェクト全体が対象です。Next.js 以外の形式で本番に公開すると、リポジトリのファイル構成が変わり、ホスティング側のビルドと公開ディレクトリの設定も変更が必要になります。そのため、公開の前に確認画面が表示されます。

本番公開では、**検索・シェア（SEO）** の **Googleなどの検索結果に表示させない** を選んだページに `noindex` を設定します。React ではブラウザでこの設定を反映します。静的 HTML でも、同じパスを使うページでクエリごとに設定が異なる場合は、ブラウザで反映します。リンクからは引き続き閲覧できます。テスト公開ではサイト全体に `noindex` を設定します。

**zip での書き出し**では、出力する範囲を **現在のページ** または **選択したコンポーネント**（選択中の要素と子要素を1つのページとして出力）に限定することもできます。zip には書き出した範囲の編集データ（`_tsumu/doc.json`）とアセットの対応表（`_tsumu/assets.json`）が含まれるため、後で[インポート](#インポート)できます。ウェブサーバーには、生成されたウェブサイトのファイルだけを配置してください。

**単一のHTML** を選ぶと、現在のページまたは選択したコンポーネントを1つの `.html` ファイルとしてダウンロードできます。後で元の編集データとアセットを復元するには、ZIP で書き出してください。外部 API や埋め込み動画の利用には通信が必要です。

> [!NOTE]
> GitHub・GitLab.com に公開すると、非公開のページや設定も含むサイト全体の編集データが `_tsumu/doc.json` としてコミットされます。公開リポジトリでは誰でも閲覧できます。

## インポート

ホーム画面で **インポート** をクリックするか、ファイルをドロップすると、ファイルを新しいサイトとして取り込みます。

| ファイル | 結果 |
|---|---|
| Tsumu から書き出した zip（`_tsumu/doc.json` と `_tsumu/assets.json` を含むもの） | 画像などのアセットを含めてサイトを復元します。 |
| `doc.json` | サイトを復元します。データURLで埋め込まれたアセットは再アップロードします。 |
| HTML ファイル、またはウェブサイトの zip | すべての HTML ページを編集可能な要素に変換します。ページ間のリンクは元の HTML のベース URL を基準に解決し、クエリとフラグメントを引き継ぎます。zip 内のその他のファイルはアセットとしてアップロードし、HTML 内のパスを書き換えます。 |

Tsumu MCP が生成したサイトの一時リンクを開いた場合も、その内容から新しいサイトを作成します。既存のサイトには書き込みません。新しいサイトを保存できた後、一時データは MCP サーバーから削除されます。

編集データを含まない ZIP をホーム画面にドロップした場合は、HTML の変換前に案内が表示されます。復元できなかったアセットなどの注意事項は、新しいサイトを開いた後に表示されます。サーバー保存中に通信が切れ、保存を確認できなかった場合は、もう一度インポートする前にホーム画面のサイト一覧を確認してください。

エディタのページ設定から、HTML ファイルや zip を1つのページに読み込むこともできます。通常のページでは HTML を編集可能な要素に変換し（既存の要素を置き換える前に確認します）、HTMLページでは HTML をそのまま使用します。zip の場合は `index.html` を優先して読み込みます。

復元した HTML ページでアセットの欠落が報告された場合は、そのページの設定で **HTMLとアセットのZIPをそのまま読み込む** を押し、元のウェブサイトの ZIP を選びます。ページの HTML を読み込み直し、不足するファイルを ZIP からアップロードします。

フォームを編集可能な要素に変換すると、送信方式、送信先、各項目の送信名、ボタンごとの送信先や送信方式を引き継ぎます。公開時は、フォームを受け付ける送信先を用意してください。数値・日付の範囲と刻み、ファイル欄の種類指定と複数選択も引き継ぎます。

通常の `<img>` を編集可能な画像に変換すると、`src` を引き継ぎ、`srcset` と `sizes` は取り込みません。画面幅などに応じた画像の切り替えを保つには、HTML ページとして読み込んでください。`<picture>` はカスタムコードの要素として保持します。

サイズの上限は、zip が100MB、`doc.json` と HTML ファイルが12MBです。ウェブサイトの zip は200ファイル・CSS 合計2MBまでで、zip 内の HTML と CSS は UTF-8 に対応しています。

> [!TIP]
> `skills/tsumu-site/` は、Tsumu で編集可能なサイトを AI に生成させるスキルです。Tsumu MCP に接続・認可している場合は `stage_site_doc` でサイトデータを一時保存し、1時間有効な非公開のインポートリンクを返します。MCP を利用できない場合は `doc.json` または ZIP を生成して手動でインポートできます。リンクの発行だけではサイトは公開されません。

## ページの複製と別サイトへのコピー

1ページだけコピーするには、**ページ** パネルでそのページを右クリックします。複数ページをまとめてコピーするには、**ページを選ぶ** を押し、対象にチェックを入れます。最初は編集中のページにチェックが入っています。⌘＋クリック（Windows・Linux は Ctrl＋クリック）で個別に選択を切り替え、Shift＋クリックで範囲を選択することもできます。選んだページのいずれかを右クリックして操作します。

| コピー先 | 操作 |
| --- | --- |
| 同じサイト | **複製**（2ページを選んだ場合は **2ページを複製**）を選びます。各コピーは元のページの直後に追加されます。「元に戻す」1回でまとめて取り消せます。 |
| ほかのサイト | **ほかのサイトへコピー…**（2ページなら **2ページをほかのサイトへコピー…**）を選び、コピー先のサイト名を押します。ページは元の順番でコピー先の末尾に追加され、要素、スクリプト、使用中のアセット・コンポーネント・カスタムフォント・アップロードしたフォント・Adobe Fonts の Web プロジェクト設定も引き継がれます。完了後に **新しいタブで開く** を押すと結果を確認できます。 |

エディタでページを選んで設定したリンクは、リンク元とリンク先を一緒に複製・コピーすると、コピー同士がつながります。ページや要素のスクリプトで使う **ページやリンクを開く** も同様で、条件分岐や繰り返しの中で選んだページにも適用されます。同じサイト内で複製すると、選択外へのリンクは元のページを指し、配置済みのコンポーネントは複製元と同じコンポーネントを参照します。

ほかのサイトへコピーすると、選択外へのリンクは、コピー先に同じパスとクエリ条件のページがあればそのページを指します。該当するページがなければ、コピー先のエディタでリンク先を確認し、移動したいページを指定してください。たとえば `/blog?tab=news` と `/blog?tab=archive` は別のリンク先です。コピーするページと同じパス・クエリ条件がすでに使われている場合、コピーしたページのパスには `/blog-copy` のように接尾辞が付きます。URL 欄やカスタム HTML にパスを直接書いた箇所からコピーへ移動したい場合は、該当するパスを書き換えてください。

要素を個別にコピーするには、要素を選んで ⌘C を押し、コピー先のサイトをエディタで開いて ⌘V を押します（Windows・Linux は Ctrl+C と Ctrl+V）。使用中のアセット・コンポーネントと、アップロードしたフォントや Adobe Fonts の Web プロジェクトを含むフォント設定も引き継ぎます。貼り付けた要素と新たに追加されたフォント設定は、「元に戻す」「やり直す」1回でまとめて操作できます。

## 公開サイトのホスティング

初回の公開後、サイトのリポジトリをホスティングサービスに接続します。次の表は Next.js 形式の場合です。他の形式では、[出力形式](#出力形式)に従ってビルドと公開ディレクトリを設定してください。

| ホスティング | 設定 | テスト公開 |
|---|---|---|
| **Vercel** | リポジトリをインポートします。追加の設定は不要です。 | 本番以外のブランチに、自動でプレビューURLが付与されます。 |
| **Netlify** | リポジトリをインポートします。 | Branch deploys を有効にします。 |
| **Cloudflare Workers Builds** | Build: `npx opennextjs-cloudflare build`<br>Deploy: `npx opennextjs-cloudflare deploy` | [本番以外のブランチのビルド](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)を有効にします。公開サイトは保存先も Durable Object も持たないため、エディタのプレビュー用の設定は不要です。 |
| **Node.js** | `npm install && npm run build && npm start` | テスト公開のブランチは個別にビルドします。 |

### データの更新間隔と Cloudflare

Next.js 形式では、外部の JSON を使うページを、エディタの **サイト** タブで設定した **データの更新間隔** ごとに再生成します。再生成の方式はホスティングによって異なります。

- **一般的なホスティング**（Vercel・Netlify・Node.js）では、Next.js の ISR により、事前に生成したページをバックグラウンドで再生成します。
- **Cloudflare Workers** で ISR を使うには、追加のキャッシュ（R2）とキューが必要です。これらがないと、事前に生成したページは**一度も再生成されません**。これを避けるには、エディタの **サイト** タブの **公開先のホスティング** で **Cloudflare Workers** を選択してください。この設定では、該当するページをリクエストごとに描画し、取得した JSON を更新間隔のあいだ Cloudflare のエッジにキャッシュするコードを出力します。

いずれのホスティングでも、更新間隔を `0` にするとリクエストごとにデータを取得します。

### ロールバック

**GitHub・GitLab** では、**公開** 画面の **公開履歴・ロールバック**（または **⋯** メニューの **履歴・ロールバック**）に、ブランチごとのコミットが表示されます。各版に対して次の操作ができます。

- **サイトを戻す**: 選択した版のファイルを、新しいコミットとしてブランチの先頭に再コミットします。履歴は残るため、ロールバック自体も取り消せます。
- **編集内容を復元**: 公開時に保存された編集データ（`_tsumu/doc.json`）をエディタに読み込みます。読み込みは通常の編集として扱われるため、⌘Z で元に戻せます。

Netlify・Cloudflare Pagesでは、公開画面に各サービスのデプロイ履歴と復元操作を表示します。編集用データはデプロイされないため、デプロイ履歴からは編集内容を復元できません。編集データの復元には別のバックアップを使ってください。

**履歴・ロールバック** 画面には、サーバーに保存された編集データの日次バックアップ（曜日ごとに1つ、計7日分）も表示されます。

「**履歴・ロールバック**」の「**バックアップZIPを書き出す**」では、アセット一覧にあるすべての画像・動画・フォントなど（未使用のファイルも含む）をサイトの編集データと一緒に ZIP で保存できます。「**バックアップファイルを読み込む**」でその ZIP を現在のエディタに復元し、アセットも現在の保存先にアップロードします。アセットが取得・復元できない場合は、不完全なバックアップを黙って作成・適用せず、エラーを表示します。現在の形式の単体の `doc.json` も読み込めますが、サーバー保存のアセット本体は JSON には含まれません。

## AIに頼む（任意）

`AI_ENABLED=true` と API キーを設定すると、**AIに頼む** ボタンが表示されます。リクエストはエディタのサーバーの `/api/ai` を経由するため、API キーがブラウザに渡ることはありません。

### 仕組み

1. ブラウザが、編集中のページの要約（要素の階層・テキスト・スタイル）を送信します。他のページは名前のみを送信します。
2. サーバーが、エディタのデータ構造の説明と `edit_site` ツールを加えて AI に渡します。
3. AI が編集操作（スタイルの変更、要素の追加・移動、テキストの変更など）を返します。
4. サーバーが、その操作をページの複製に試しに適用します。失敗した操作があれば、エラーを AI に返して修正させます。
5. 正常に適用できた操作だけがブラウザに返され、1回で取り消せる変更として適用されます。

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
- 小規模なモデルほど編集操作の誤りが増えます。誤りはサーバーが検出して AI に修正させるため、ページが壊れることはありませんが、やり取りの回数は増えます。
- Gemini などの無料枠では、送信した内容がサービスの改善に利用される場合があります。

### 例: Gemini を使用する場合

エディタの実行環境に次の値を設定します。設定先は、ローカル環境と Node.js では `.env.local`、Docker では `--env-file` で渡すファイル、Cloudflare では Worker の Variables and Secrets です。

```dotenv
AI_ENABLED=true
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash
GEMINI_API_KEY=your-api-key
```

API キーはシークレットとして保存してください。`AI_API_KEY` はプロバイダ別のキーより優先されるため、プロバイダを切り替えるときは、古い共通のキーが残っていないか確認してください。Claude・OpenAI・互換 API を使う場合も、上の表に従って設定します。

### 動作の確認

ログインした状態で `/api/ai` を開くと、AI の利用可否と使用するモデルを確認できます。`AI_ENABLED` を設定しても利用可能にならない場合は、不足している設定がサーバーのログに出力されます。設定を変更した後は、ローカル環境・Node.js・Docker ではエディタを再起動し、Cloudflare では設定を反映してから、エディタを開き直してください。

### 編集内容の保護

AI による編集は、ページに反映する前に、必ず作業用の複製で検証します。

- 通信の切断、タイムアウト、解消されない操作のエラー、生成の途中終了が発生した場合は、何も適用しません。
- 応答を待つ間に同じページを編集した場合は、その編集を上書きしないよう、AI の結果を適用しません。
- 依頼はチャットの中止ボタンで取り消せます。適用された変更は、1回の「元に戻す」で取り消せます。
- 処理中のチャットには、AI による短い説明、変更案の準備・検証・修正の進み具合、経過時間が表示されます。完了後も「作業の記録」で確認できます。AI の内部の思考過程や署名は表示しません。

### 外部 AI クライアントからの編集（MCP）

既存のサイトに AI アプリを接続するには、対象サイトをエディタで開きます。AI アプリからの操作はこのタブで処理するため、作業中は開いたままにしてください。

1. **⋯ → AIと接続（MCP）** を開きます。AI アプリに Tsumu を追加する手順は、画面内の **使い方の案内を見る** から確認できます。
2. 閲覧のみにする場合は **編集を許可する** のチェックを外します。**接続を開始** を押して、表示された **接続コード** をコピーします。
3. AI アプリから Tsumu に接続し、10 分以内に認可画面にコードを入力します。
4. 作業が終わったら、エディタで **接続を解除して失効** を押します。

接続先は、そのタブで開いているサイトです。編集を許可すると、AI アプリはページの追加や編集ができます。公開やアセットの削除は Tsumu 上で行います。

## 環境変数

すべて任意です（[環境設定](#環境設定)）。

| 変数 | 内容 |
|---|---|
| `AUTH_SECRET` | セッションの秘密鍵。`npx auth secret` で生成します。 |
| `ALLOW_ANONYMOUS` | `true` にすると、Googleログインが未設定でもループバック以外や本番環境でログインなしで利用できます（`npm run dev` でのループバック宛てのアクセスには不要）。URLを知っている人は誰でも編集・公開できるため、ローカル環境かデモに限って使用してください。 |
| `AUTH_URL` | 本番環境のエディタのURL（例: `https://tsumu.example.com`） |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google の OAuth クライアント |
| `ALLOWED_EMAILS` | 常に**編集者**としてログインを許可するGoogleアカウント（カンマ区切り）。全サイトをオーナーとして管理でき、画面からは削除や権限変更はできません。その他の**編集者**・**閲覧のみ**のアカウントは、ホーム画面の **設定** で管理します。 |
| `PUBLISH_PROVIDER` | サーバーで使う公開先（`github` が既定、`netlify`、`cloudflare`） |
| `PUBLISH_PROJECT_PREFIX` | Netlify・Cloudflare Pages のプロジェクト名の接頭辞（既定は `tsumu`）。Tsumu のインスタンスごとに別の値にします。 |
| `GITHUB_TOKEN` | GitHubの公開先に Contents: Read and write の権限を持つトークン |
| `GITLAB_TOKEN` | GitLab.comの公開先に書き込み権限とapiスコープを持つトークン |
| `NETLIFY_OAUTH_CLIENT_ID` | Netlify の OAuth アプリのクライアント ID。Tsumu のインスタンスごとに設定します。 |
| `NETLIFY_OAUTH_REDIRECT_URI` | Netlify の OAuth アプリに登録したリダイレクト先の URL（例: `https://tsumu.ebii.net/netlify/callback`） |
| `TSUMU_STORAGE_MODE` | `local` にすると、サーバーの保存先があっても、サイトと編集データをブラウザ内だけに保存します。KV へのアセットの保存も無効になります。 |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | Cloudflare Pagesのみ。アカウントIDとPages: Edit権限を持つAPIトークン |
| `AI_ENABLED` | `true` で「AIに頼む」を有効にします。 |
| `AI_PROVIDER` | `anthropic`（既定）・`gemini`・`openai`・`openai-compatible` |
| `AI_API_KEY` | API キー（`ANTHROPIC_API_KEY`・`GEMINI_API_KEY`・`OPENAI_API_KEY` でも可） |
| `AI_MODEL` | モデル ID。既定は `claude-opus-5-5`（`anthropic`）・`gemini-3.8-flash`（`gemini`）。`openai` と `openai-compatible` では指定が必要です。 |
| `AI_BASE_URL` | `openai-compatible` で使用する API の URL（例: `https://openrouter.ai/api/v1`） |
| `AI_EFFORT` | `low`・`medium`（既定）・`high`・`xhigh`・`max` |
| `NEXT_PUBLIC_TSUMU_MCP_URL` | 外部 MCP 接続に使う `tsumu-mcp` サーバーのビルド時ベース URL（既定は `https://mcp.tsumu.ebii.net`。変更後は再ビルドが必要） |
| `TSUMU_DATA_DIR` | Node.js で動作させる場合の保存先フォルダ（[Node.js](#nodejs)）。Docker では `/data` に固定されます。 |
| `ASSET_GC_ENABLED` | Cloudflare のみ。`true` にすると、使われなくなったアセットを KV から削除します（既定は削除しない試行のみ。[KV アセットの削除処理](asset-gc.md)（英語））。 |
| `ASSET_GC_GRACE_DAYS` / `ASSET_GC_MAX_DELETES` | Cloudflare のみ。削除までの日数（既定は7）と、1回の処理で削除する件数の上限（既定・最大とも500） |

設定先は次のとおりです。

- ローカル開発と Node.js: `.env.local`
- Docker: `--env-file` で渡すファイル
- Cloudflare: `wrangler secret put`

すべての変数は [`.env.example`](../.env.example) にも記載しています。

## 制限事項

### Cloudflare 無料プラン（エディタを Cloudflare Workers で動作させる場合）

| 項目 | 制限 | 影響 |
|---|---|---|
| Workers の CPU 時間 | 1リクエストあたり10ms | アセットの多いサイトを公開すると、超過する場合があります。Workers Paid（月額5ドル、CPU 30秒）では問題になりません。 |
| Durable Objects内SQLiteの1項目 | 最大8MB | 編集データはページ・要素などの個別行へ保存し、Tsumuでは各項目を最大7MBに制限します。 |
| KV | 合計1GB、1ファイル25MB、書き込みは1日1,000回まで | KV 名前空間の容量は全サイトで共有され、各サイトのアセットタブにはそのサイトの使用量とゴミ箱が表示されます。 |
| KV の整合性 | 結果整合性 | アップロードしたファイルが全体に反映されるまで、数秒かかる場合があります。 |
| GitHub API | 1時間あたり5,000リクエスト | 1回の公開で数回から十数回のリクエストを使用します。 |

### サイト

- サイトを削除すると、その編集データと自動バックアップも削除されます。公開済みのリポジトリと、保存先の画像はすぐには削除されません。
- サイト間でコピーした画像は、同じ保存先を共有します。Cloudflareでは、同時編集による誤った削除を防ぐため、アセットの参照を削除してもKV内のファイルはすぐには削除されません。使われなくなったファイルは、`ASSET_GC_ENABLED=true` を設定した場合に、ガベージコレクションで削除されます（[KV アセットの削除処理](asset-gc.md)（英語））。
- サーバーの保存先がない場合や `TSUMU_STORAGE_MODE=local` の場合、サイトはそのブラウザ内にのみ保存され、ブラウザのデータを削除すると失われます。

### 同時編集

**コメント**

- コメントは編集データとは別に保存され、公開サイトには含まれず、「元に戻す」の対象にもなりません。編集・削除できるのは投稿者本人のみです。
- スレッドを開くと一覧から切り替わり、一覧とスレッドはどちらもパネルの高さいっぱいに表示されます。未送信の返信や新規コメントは、送信またはキャンセルするまでスレッドごとに保持され、一覧に戻ったり一覧を切り替えたりしても失われません。
- 要素やページを削除しても、コメントは保持されます。削除された要素へのコメントはラベルを強調して通常の一覧に表示され、削除されたページへのコメントがある場合は「すべてのページ」への切り替えを案内します。いずれも表示・返信・解決が可能です。削除を元に戻すと要素は同じ ID で復元され、コメントも再び関連付けられます。対象を削除・非表示にしても、入力中の返信や新規コメントは失われません。
- パネル上部のボタンでキャンバス上のピンを非表示にし、下のデザインを確認できます。⌥（Alt）キーを押している間も非表示になります。
- コメント一覧は、作成日時の新しい順に1,000スレッドずつ読み込み、古い一覧・新しい一覧へ移動できます。絞り込みとキャンバス上のピンは、読み込んだ範囲に適用されます。スレッド内の返信はまとめて読み込みます。
- 返信の入力中にスレッドが削除された場合、未送信の文章は閉じるまでコピーできる状態で残ります。削除されたスレッドは復元されず、以降の送信はできません。

**編集のマージ**

- マージは要素の項目単位で行います。異なる要素、または同じ要素の異なる項目（テキストと色など）を同時に編集した場合は、両方の変更が保持されます。同じ項目を同時に編集した場合は、後から保存した変更が優先されます。
- スクリプトの手順などの一覧は、全体を1つの項目として扱います。
- 未保存の変更があるときや文字の入力中は、他の編集者の変更を、入力が終わってから取り込みます。
- タブを離れている間に接続が切れても、タブに戻ると切断中に保存された変更を取り込みます。ページを再読み込みせず、そのまま編集を続けられます。
- 他の編集者の変更を取り込むと、「元に戻す」の履歴もそれに合わせて再構成されます。

**記録とアクセス**

- 編集・公開の記録には、各ユーザーが最後に編集・公開した時刻が保存されます。Googleログインを使用していない場合は、全員が1人のゲストとして表示されます。
- アカウントの権限を**閲覧のみ**に変更したり許可リストから削除したりすると、ログイン済みであっても次の API アクセスから反映されます。同時編集の接続も、読み込み・保存・更新通知の前に権限を再確認します。

### エディタと書き出し

- **公開は通常のコミットです。** Tsumu が生成したファイルはエディタの内容で置き換え、手動で追加したファイルは保持します。両者は `_tsumu/generated.json` で区別します。
- **リポジトリ上での変更を検出します。** 生成したファイルが GitHub・GitLab 上で編集されていた場合は、上書きの前に確認を求めます。リポジトリ上で削除されたファイルも、今回の公開で再作成する場合は確認を求めます。生成したファイルを手動で変更し続ける場合は、別のブランチで行ってください。
- **初回の公開でも既存のファイルを保持します。** 同じパスのファイルを上書きする前には確認を求めます。
- **`_tsumu/` は Tsumu の管理情報専用です。** 生成したファイルの一覧が破損している場合は、公開を中止します。
- ページ専用のカスタムコードは、`<head>` ではなくページ本文の先頭と末尾に挿入されます。
- キャンバスでは、カスタムコードとアイコンを無害化して表示します。埋め込み（`embed`）の iframe はサンドボックス化し、同一オリジンのエディタの URL と認証情報を含む URL を拒否します。カスタムコード内の iframe も、エディタとは別オリジンのサンドボックスで実行します。スクリプトやイベント属性が実行されるのは公開したサイトだけで、ログイン中のエディタの権限で実行されることはありません。
- `next/image` は、どのホスティングでも動作するよう `unoptimized` を付けて出力します。
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
  api/sites/          サイトの一覧・作成・設定・削除・サイト別のメンバー管理
  api/doc/            サイトごとの編集データ、日次バックアップ
  api/comments/       キャンバスのコメント
  api/activity/       最近編集した人・最後に公開した人
  api/publish/        GitHub・GitLab（gitlab/）・Cloudflare Pages（static/）・Netlify（netlify/）への公開、履歴とロールバック
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
  sites.ts            サーバーのサイト保存（D1・SQLite。ブラウザでも使う型・検証は site-model.ts）
  site-access.ts      サイトごとのオーナー・編集者・閲覧のみの権限判定（アセット参照権限は site-asset-access.ts）
  site.ts             開いているサイト・tsumu-* ブラウザ保存キー・D1 がない場合のサイトの一覧
  generator.ts        SiteDoc → Next.js プロジェクト（部品は generator/）
  export-formats.ts   出力形式の選択肢・制限と、zip・公開で共通の出力処理
  exportZip.ts        書き出す zip（再インポート用の編集データを含む。外部依存なしの zip.ts を使用）
  site-import.ts      Tsumu の zip・doc.json の復元（サイトの作成は import-site-file.ts）
  site-backup.ts      編集データとアセット一式をまとめたバックアップ zip
  html-to-site.ts     HTML を編集可能な要素に変換（html-file-import.ts・html-zip.ts）
  script.ts           スクリプトのデータ構造（実行ランタイムは script-runtime.ts。キャンバスと書き出したサイトで共用）
  site-document-service.ts  サイトごとの編集データの保存先の振り分け（Cloudflare は Durable Object、それ以外はローカルの SQLite）
  structured-document-store.ts  DocumentRoom（Durable Object）内の SQLite の構造（ページ・要素ごとの行）
  node-storage.ts     Cloudflare 以外での保存先（SQLite・ファイル。TSUMU_DATA_DIR）
  browser-doc-storage.ts  ブラウザのみに保存するサイトの文書・アセット用 IndexedDB（tsumu-documents）
  uploaded-fonts.ts   アップロードしたフォント（@font-face）の情報とアセット参照
  store.ts            エディタの状態（zustand）と元に戻す履歴（「AIに頼む」のチャット状態は ai-store.ts）
  clip-transfer.ts    サイト間のコピー＆ペースト
  page-transfer.ts    ページを他のサイトへコピー
  comments.ts         サーバーでのコメントの保存（サーバーがない場合は comment-store.ts がブラウザ内に保存）
  activity.ts         編集・公開の記録
  aiOps.ts            AI の編集操作（サーバーとブラウザの両方で適用）
  external-edit/      開いているエディタを外部の tsumu-mcp に接続する WebSocket ブリッジ
  manualTopics.ts     ヘルプの記事
  locales/            言語の辞書と自動生成した登録情報
workers/custom-worker.ts      同時編集の Durable Object を含む Cloudflare Worker のエントリポイント
workers/document-room.ts      サイトごとの編集データを保存する Durable Object（DocumentRoom）
scripts/cloudflare.mjs  デプロイ用の wrangler 設定を生成し、OpenNext を実行
```

```bash
npm run typecheck      # tsc --noEmit
npm test               # 同時編集・元に戻す・スクリプト・公開などの回帰テスト
npm run i18n:check -- --all   # 翻訳漏れを警告表示（厳格チェックは -- --strict ja）
npm run build && npm run test:e2e   # 実際のブラウザによるE2Eテスト（Playwright。初回は npx playwright install chromium firefox webkit）
```

出力形式のビルドを確認するには、サンプルのプロジェクトを生成してビルドします（CI では全フレームワークを TypeScript と JavaScript の両方で確認しています）。

```bash
node --import tsx scripts/smoke-export-build.mts vue typescript   # nextjs・react・vue・nuxt・sveltekit
cd .generated-export-smoke && npm install && npm run build
```

### 翻訳

画面の文言は英語を原文とし、`tr("Save")` のように英語の原文をそのまま翻訳キーにします。日本語訳は `lib/locales/ja.ts` に記述します。未翻訳の文言は英語で表示されます。キーがすでに英語なので、`lib/locales/en.ts` には原文と表示を変えたい英語だけを書きます。たとえば複数形（`"{n} pages": "{n, plural, one {# page} other {# pages}}"`）です。同じ英語でも場所によって訳し分けたいときは、場所ごとに括弧で補足を付けた別のキーにして（`tr("Done (tutorial step)")`）、`en.ts` で英語に戻します（`"Done (tutorial step)": "Done"`）。ほかの言語で訳が無いときも、この英語を使います。翻訳に含まれる `{name}` のような置換変数は変更しないでください。

#### 言語の追加

1. `lib/locales/<言語コード>.ts` を作り、英語原文から翻訳への対応を `Dict` のデフォルトエクスポートとして定義します。例: `fr.ts` に `{ Save: "Enregistrer" }` を指定します。部分的な翻訳でも構いません。訳にも同じ複数形の書き方を使えます。どの形を使うかは、その言語の規則で決まります。
2. `npm run dev` または `npm run build` を実行します。ファイル名から対応言語一覧と辞書の遅延読み込み先が自動生成され、言語選択にも表示されます。**`lib/lang.ts` や `lib/locales/index.ts` を編集する必要はありません。** 言語の表示名にはその言語自身の名称を使用します。
3. `npm run i18n:check -- fr` で未翻訳の文言を警告として確認できます。`npm run i18n:check -- --strict fr` は翻訳漏れがあると失敗し、`npm run i18n:check -- --all` は全辞書を確認します。CI では `npm run i18n:check -- --all` を警告として実行し、未翻訳の文言は英語にフォールバックするため PR を妨げません。

この自動生成は、`typecheck`・`test`・`build:worker` の実行前にも行われます（`test:e2e` は事前の `npm run build` で生成されます）。npm を経由せずにツールを直接実行する場合は、先に `npm run locales:sync` を実行してください。英語は原文の言語なので、`en.ts` の有無にかかわらず登録されます。

追加した言語は、ホーム画面の **設定** にある **表示言語**（エディタでは **⋯** メニューの **設定**）に表示され、ブラウザの言語設定に応じて自動選択されます。日本語・英語の既存 E2E は、追加言語ごとに変更する必要はありません。

### ヘルプの記事

ヘルプの記事は `lib/manualTopics.ts` に記述します。各記事は、質問、1行の要約、本文のブロック（段落・箇条書き・表・ヒント・図解）で構成されます。

- 本文では `**強調**`・`` `コード` ``・`[[記事ID|リンクの文字]]` を使用できます。
- 図解は `components/HelpFigures.tsx` の React コンポーネントです。説明する CSS そのものを使って描画します。
- 操作ガイドの各ステップの `target` には、画面側の `data-tutorial` 属性の値を指定します。
