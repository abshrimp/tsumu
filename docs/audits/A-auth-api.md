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

## 発見事項と処置

| ID | 重要度 | 再現条件（修正前） | 原因 | 対処 | 回帰試験 |
| --- | --- | --- | --- | --- | --- |
| AUD-A-001 | Medium | 古いブラウザ相当で `Sec-Fetch-Site` がなく、Originと宛先が同じHost・異なるschemeの場合に書き込みを許可。また `same-origin`/ `none` があると矛盾するOriginを未検証 | Originのhostしか比較せず、Fetch Metadataを優先して早期return | scheme・host・portの一致を検査し、Originが付くときはメタデータと合わせて検証 | `tests/csrf-origin.test.mts` |
| AUD-A-002 | Low | `POST /api/allowed-users` に `{"email":["editor@example.com"]}` を送ると、単一要素の配列を文字列化して許可対象にできる | `String(input.email)` で型の違いを無視 | メールアドレスはJSONの文字列型のみ受理 | `tests/allowed-users-shapes.test.mts` |
| AUD-A-003 | Medium | `POST /api/assets/sign` が巨大なJSON本文を無制限にパースし、複数パスの署名を繰り返せる | `req.json()` の前に容量制限がない。重複パスも署名 | 1MiBのストリーム全体制限、長さの申告値と実測値の照合、Content-Type検証、同一パス署名の重複排除 | `tests/api-json-limits.test.mts` |
| AUD-A-004 | Low | `GET /api/doc/backups?day=` は0、`?day=0x1` は1と扱い、重複したdayの先頭だけを利用 | `Number(dayParam)` の寛容な変換 | `0`〜`6` の1桁・1個だけを受理 | `tests/backup-day-input.test.mts` |

いずれも静的コード比較による修正前条件と根本原因の特定。CIで新規テストを実行した最終結果はPR #33のchecksを正とする。

## 認証状態別の確認項目

| 状態 | 想定する動作 | 対象の既存回帰テスト |
| --- | --- | --- |
| Google認証がすべて設定済み・許可リストに存在 | API利用可。編集・公開・アカウント管理は全アカウント同権限 | `tests/auth-policy.test.mts`, `tests/login-routing.test.mts` |
| Google認証設定済み・未ログイン | 通常APIは401。ログイン画面は閲覧可 | `tests/login-routing.test.mts` |
| Google認証設定済み・許可削除後の旧Cookie | APIの現行許可照合で401。SSE・WebSocketも利用時の許可を再判定 | `tests/auth-policy.test.mts`, `tests/collab-security.test.mts` |
| Google認証が未設定・開発モードまたは`ALLOW_ANONYMOUS=true` | 全サイト利用可（意図した匿名モード）。管理アカウントAPIは503 | `tests/login-routing.test.mts`, `tests/asset-font-cors.test.mts` |
| Google認証が未設定・匿名不可 | APIは503で利用不可 | `tests/login-routing.test.mts`, `tests/asset-font-cors.test.mts` |
| 署名付きアセットGET | 期限内の正しいパス署名でCookie不要、誤署名は通常の認証へ戻す | `tests/security.test.mts`, `tests/asset-font-cors.test.mts` |
| 別オリジンからAPI書き込み | 403（middleware） | `tests/csrf-origin.test.mts`, `tests/security.test.mts` |

## 異常入力の検証計画・期待結果

| 入力 | 期待結果 | テスト |
| --- | --- | --- |
| 複数のOrigin / 異なるscheme・port、null Origin、未知のFetch Metadata | 403相当（判定関数true） | `csrf-origin` |
| OAuthプロファイルの`email_verified`がtrue以外、許可外・失効済みメール | サインイン拒否・JWT無効 | `auth-policy` |
| 許可メールが文字列以外、空欄、構造不正 | 400、許可リスト不変 | `allowed-users-shapes` |
| アセット署名JSONの巨大Content-Length・実際のストリーム容量超過 | 413、署名なし | `api-json-limits` |
| 署名JSONの不一致Content-Type、無効UTF-8 | 415または400 | `api-json-limits` |
| 重複アセットパス | 200、パスごとに1回のみ署名 | `api-json-limits` |
| バックアップ曜日が空、16進数、指数表記、重複 | 400、DB照会なし | `backup-day-input` |
| 全ルートを走査して認証境界を検査 | 意図した公開ルートを除き明示ガードあり | `api-auth-coverage` |

## 横断上の未検証事項と担当境界

- H担当のPR #27が`/api/fetch-json`の入力・SSRFを担当。同ルートの修正をA側では取り消し、送信本文のUTF-8実バイト数とヘッダー数・長さの不備を #27 に報告。上限付きJSON読取ヘルパーはHの新設関数と重複しているため、統合時に一本化が必要。
- G担当のPR #29が`/api/publish`および履歴ロールバックを修正。認証が各ハンドラーの先頭で行われることを静的確認し、コミット・ツリー破壊の試験はG担当に委譲。
- B担当のPR #31がSiteDoc不変条件、保存・同期を監査。A側は`/api/doc`と`/api/sites`の認証境界を確認し、内部の競合・データ整合性はB担当に委譲。
- E担当のPR #26はインポート・アセットの内部検証を担当。A側は配信・署名のアクセス制御を確認。
- 本番プロキシ設定（信頼される`X-Forwarded-Host`/`X-Forwarded-Proto`）、NextAuthの実Cookie属性、Google OAuth実接続、Cloudflare上の動的アクセス失効、レート制限は実配備での検証が必要。リクエスト頻度制御は持続的な共有ストア・エッジの設定が必要であり、メモリー内だけの暫定レートリミットは追加しない。
- 本監査は「脆弱性0件の保証」ではない。CI結果と別担当のレビュー結果、および新しいmainへの統合テストを確認して完了判定する。


## 二次監査（2026-11-09）

前回の全CI成功後に、各APIの `req.json()` / JSON読取のサイズ制限を再点検した。認証済み利用者に限られる経路であっても、巨大な本文による無制限なデコードを許さない。

| ID | 重要度 | 問題と再現条件 | 修正 | 回帰テスト |
| --- | --- | --- | --- | --- |
| AUD-A-005 | Medium | `POST /api/allowed-users`、`POST /api/comments`、`PATCH /api/sites/[id]` は入力項目の型・長さを後から確認していたが、JSON本文の読込自体に上限がなかった。巨大・分割送信の本文による過剰なメモリ/CPU使用につながる。 | バイト数の実測とContent-Lengthを確認して読込み前／途中に413。上限はアカウント16KiB、コメント64KiB、サイト設定64KiB。通常のJSON本文のContent-Type受理条件は変えない。 | `tests/allowed-users-shapes.test.mts`、`tests/comment-storage.test.mts`、`tests/site-settings-concurrency.test.mts`、`tests/api-json-limits.test.mts` |
| AUD-A-006 | Low | `DELETE /api/allowed-users` に `email` クエリパラメータが複数あると先頭だけで削除し、呼び出し側のパラメータ解釈と食い違う可能性があった。 | `email` は1件のみ許可し、重複・欠落は400。 | `tests/allowed-users-errors.test.mts` |

### ブランチ整合性と範囲

- `main` の #19/#22 による更新をAブランチへマージし、アカウント一覧の保存後リフレッシュで例外を正しく捕捉する処理を維持した。
- API全体の残存注意点: `/api/doc` の大容量SiteDocはB、`/api/publish` のアップロード本文はG、`/api/fetch-json` はHの担当範囲としてサイズ・処理量・失敗時の負荷を別途検証する。Aの修正がこれらの問題を解消したとはみなさない。
- 未認証アクセスが上記書き込みAPIを直接呼べることは今回確認していない。これは認証・許可済み利用者に対する堅牢性修正であり、認証回避の発見を意味しない。
- 最新コミットでのCI/結合試験が成功するまで、二次監査の完了とマージ適格性は宣言しない。


## 三次監査：署名発行効率とセッション形式（2026-11-09）

| ID | 重要度 | 調査結果 | 修正と回帰試験 |
| --- | --- | --- | --- |
| AUD-A-007 | Low（性能・可用性） | `/api/assets/sign` は最大500パスの処理で、HMAC鍵をファイルごとに再インポートしていた。Node.js WebCryptoによる合成ベンチマークでは500回のインポートと署名に約69ms、1回インポートして500回署名する構成に約13ms要した。Cloudflare Workersで同じ差が出ると断定するものではない。 | `signAssetPaths` でリクエストごとに鍵と期限を共有し、署名は重複パスを除き1回ずつ実行。`tests/asset-token-batch.test.mts` で鍵インポート回数、パス・期限の一致、匿名利用時の無署名動作を確認。 |
| AUD-A-008 | Low（防御の堅牢性） | `requireAuth` は`auth()`がtruthyなら、`session.user.email`が存在しない場合もログイン済みと判定するコードになっていた。Google OAuthの通常セッションには検証済みメールが入るため、実運用での認証回避は確認されていない。 | セッションに空でない文字列のメールが存在することをAPI境界で要求。実際のGoogleサインイン判定・JWTの許可リスト照合は従来通り。`tests/server-auth-identity.test.mts` で不完全セッションと匿名許可を検証。 |

### 対象に含めないリスク

- 既に発行された署名URLは、有効期限内はBearer URLとして機能する。許可アカウントを削除しても署名URLは期限まで独立して有効。プレビューがCookieを送れない設計上の制約があり、失効条件・期限変更は仕様決定を要する。署名鍵をローテートすると既発行URLは無効になる。
- Cloudflare Workersのリクエスト頻度制限や実OAuth/Cookie属性は本番相当の動的試験が必要。


## 四次監査：認証済みGET応答のキャッシュ（2026-11-09）

| ID | 重要度 | 発見・影響 | 対応と検証 |
| --- | --- | --- | --- |
| AUD-A-009 | Low（多層配備時の防御不足） | アカウント管理、サイト一覧・設定、コメント、操作履歴、アセット使用量、文書バックアップ、認証確認のGET応答に `Cache-Control` が明示されていなかった。標準のNext.js/Workers構成で実際に共有キャッシュへ保存された事実は未確認だが、外部CDNのキャッシュ規則が変更されても認証済みデータを再利用させないよう明示すべき。 | `private, no-store` を各成功レスポンスへ付与。バックアップは一覧JSONと保存済み文書本文の両方を対象とする。 `tests/private-api-cache.test.mts` で全9ルート・バックアップ本文を実行して確認。 |

変更対象:
- `app/api/allowed-users/route.ts`
- `app/api/status/route.ts`
- `app/api/sites/route.ts`
- `app/api/sites/[id]/route.ts`
- `app/api/comments/route.ts`
- `app/api/activity/route.ts`
- `app/api/assets/route.ts`
- `app/api/doc/backups/route.ts`
- `app/api/collab/authorize/route.ts`

`/api/assets/file` は元から `private, no-store` を指定している。Bの`/api/doc`、Gの`/api/publish`系列など他担当のGETルートはMへ横断確認を依頼した。また、`lib/errors.ts` の例外文表示を日本語文字の有無だけで判断している点は共有のエラー応答ポリシーとしてMに報告した。日本語を含むデバッグ例外がAPIに流れた場合の情報漏洩リスクを解消したと主張しない。

テストの成功は、未検証の配備環境・認可トークンの失効・キャッシュ規則を含めて脆弱性不存在を示すものではない。


## 五次監査：署名URLの異常入力（2026-11-09）

| ID | 重要度 | 発見と対処 | 回帰テスト |
| --- | --- | --- | --- |
| AUD-A-010 | Low（不正入力・処理量） | 署名パラメータ付き`GET /api/assets/file`は、ルートでHMACを検証するためミドルウェアのセッション判定を通過できる設計。旧`verifyAssetToken`は署名文字列の長さ・文字集合を確かめず、任意の長い`sig`を`atob`・`Uint8Array`変換へ渡していた。HTTPプロキシ等によるURL長の制限は配備依存であり、実際のDoSは再現未確認。 | `verifyAssetToken`で、HMAC-SHA256署名のパディングなしBase64URL表現（43文字）以外を鍵インポートより前に拒否。期限は安全整数・期限内のみ受理。既発行の署名形式と1時間の有効期限は変更しない。 `tests/asset-token-batch.test.mts` に長大・非正規の署名入力を追加。 |

署名URLの期限内の再利用は、プレビューが別オリジンからファイルを取得するための仕様であり、この修正で失効条件は変わらない。


## 六次監査：JSON APIのメディアタイプ（2026-11-09）

| ID | 重要度 | 発見・対処 | 回帰テスト |
| --- | --- | --- | --- |
| AUD-A-011 | Low（CSRFに対する追加防御） | 署名API以外の一部JSON更新APIは、本文のJSONとしての構造だけを検査し、`text/plain`でも受け入れていた。これによりブラウザの単純なフォーム・fetchリクエストでもJSONを送れ、CSRF防御の負担がOrigin/Fetch Metadataに集中する。これ自体による認証回避・CSRF成立は未確認。 | `POST /api/allowed-users`、`POST /api/comments`、`PATCH /api/sites/[id]`を`application/json`要求に統一し、不一致は415。共通リーダーの寛容な切替分岐は削除。実クライアント側のJSONヘッダー指定は既存通り。各テストで`text/plain`がデータ更新前に拒否されることを確認。 |

**注意:** Content-Typeの検証はCSRF対策の代わりではなく、既存のOrigin・Fetch Metadata検証を維持する。認証設定・匿名利用・署名URLの公開範囲も変更しない。
