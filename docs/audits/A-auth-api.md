# A — 認証・認可・API監査

- 監査基準: `1ba32974d4b5ecf441e36428e765d0542207c421`（2026-11-09）
- ブランチ: `audit/A-auth-api`
- 方針: 全ルートのアクセス境界を調査し、修正と回帰テストを**このブランチと単一PR**に集約する。
- 既存PR重複: #22（`app/api/allowed-users/route.ts` の非同期応答とアカウント管理UI）、#19（`app/api/sites/route.ts` のインポート原子性）を事前確認。これらの変更を独立に再実装しない。

## APIアクセス制御表（初回静的コードレビュー）

略号: `R` = `requireAuth()`（Google認証時は現在の許可リスト、認証未設定時は明示的な匿名許可または開発モード）、`M` = Google認証必須、`S` = 正しい有効期限付き署名による例外、`N` = NextAuth内部の認証フロー。Rの利用者は現在の仕様上**すべてのサイト**にアクセス可能。

| エンドポイント | メソッド | アクセス条件 | 主な入力・危険な操作 |
| --- | --- | --- | --- |
| `/api/auth/[...nextauth]` | GET, POST | N（認証の設定がなければ503） | OAuth・Cookie・コールバック |
| `/api/status` | GET | R | 設定有無、ユーザー情報 |
| `/api/sites` | GET, POST | R | サイト一覧・作成・複製 |
| `/api/sites/[id]` | GET, PATCH, DELETE | R | ID、サイト設定・削除 |
| `/api/doc` | GET, PUT, PATCH | R | site、rev、文書・部分更新 |
| `/api/doc/backups` | GET | R | site、day、バックアップ本文 |
| `/api/assets` | GET, POST, DELETE | R | site、multipart、path、ファイル削除 |
| `/api/assets/file` | GET | R または S | path、exp、sig、MIME・CORS |
| `/api/assets/sign` | POST | R | paths、期限付きURL |
| `/api/allowed-users` | GET, POST, DELETE | M | email、許可リスト変更 |
| `/api/activity` | GET | R | site、編集・公開履歴 |
| `/api/comments` | GET, POST | R | site、カーソル、コメント操作 |
| `/api/collab/events` | GET | R | SSE、clientId、権限失効 |
| `/api/collab/authorize` | GET | R | WebSocketへのサーバー側認証結果 |
| `/api/fetch-json` | POST | R | URL、HTTPメソッド、ヘッダー、外部通信 |
| `/api/ai` | GET, POST | R | AI入力、ストリーム |
| `/api/publish` | GET, POST | R | 公開先、公開ツリー、blob、コミット |
| `/api/publish/history` | GET, POST | R | 公開履歴・ロールバック |

計18ルートファイル、32メソッドハンドラー。認証済み利用者によるサイト横断アクセスは仕様であり、IDごとの個別権限がないこと自体は発見事項としない。middlewareを経由しない場合にもR/Mの判定があることを確認する。OAuth認証経路はNextAuth内部のCSRF・Cookie機構も個別に調べる。

## 監査チェックリスト

| 項目 | 確認対象 | 状態 |
| --- | --- | --- |
| A-1 | 未設定、部分設定、匿名、ログイン、失効、許可変更、OAuth、Cookie、リダイレクト | 静的監査中 |
| A-2 | 全32ハンドラーの認証・認可、IDの改変、署名付きアセット | アクセス制御表を作成 |
| A-3 | Origin / Sec-Fetch-Site / Host、CORS、HTTPメソッド、JSON・multipart境界値、重複パラメータ、巨大入力、エラー、処理量 | 静的監査中 |
| 回帰 | 認証状態別と悪意ある入力の自動試験 | 未実施 |
| 動的 | Node.js・Cloudflare環境での本番相当の実行 | 未実施 |

## 初回確認した既存の防御

- `requireAuth()` はミドルウェアとは別に各ルート側でも呼ばれる。署名付きファイルのGETだけは正しいトークンがある場合の例外。
- `lib/auth-policy.ts` はGoogleの `email_verified` をサインイン時に確認し、JWT利用時も動的許可リストを再確認する。
- `custom-worker.ts` のWebSocket入口はOriginを検証し、ルーム内の配信と受信でも許可リストを調べる。
- `/api/ai` の本文は4 MiBまで、`/api/assets` のmultipartはストリーム全体を制限済み。
- `/api/fetch-json` の外部送信は`fetchPublic`経由。ただし送信リクエストの上限や特殊ヘッダーの扱いは引き続き監査する。

## 更新記録

- 2026-11-09: 基準コミット・既存PR・18ルートを確認し、アクセス制御表を作成。**この時点では動的試験と網羅性の完了を主張しない。**
