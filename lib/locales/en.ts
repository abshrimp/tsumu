/** 英語の訳。キーは日本語の原文（lib/i18n.ts を参照） */

import type { Dict } from "../i18n";
import help from "./en-help";

const en: Dict = {
  ...help,
  "ページ情報を送信しています…": "Sending page information\u2026",
  "変更内容を検討しています…": "Planning the changes\u2026",
  "変更案を作成しています…": "Preparing edits\u2026",
  "変更案を検証しています…": "Validating edits\u2026",
  "変更案を修正しています…": "Correcting edits\u2026",
  "結果を確認しています…": "Reviewing the result\u2026",
  "スタイル変更": "Style changes",
  "文字変更": "Text changes",
  "要素追加": "Elements added",
  "要素移動": "Elements moved",
  "要素削除": "Elements removed",
  "要素複製": "Elements duplicated",
  "名前変更": "Names changed",
  "リンク変更": "Links changed",
  "画像変更": "Images changed",
  "表示設定": "Visibility settings",
  "ページ設定": "Page settings",
  "{name} {n}件": "{name}: {n}",
  "変更案を{n}件検証しました": "Validated {n} proposed edits",
  "変更案を確認しました": "Checked the proposed edits",
  "{n}件の操作に修正が必要です": "{n} operations need correction",
  "作業の記録": "Activity log",
  "変更した要素": "Changed elements",
  "この要素を選ぶ": "Select this element",
  "{n}秒": "{n}s",
  "変更は完了後にまとめて反映します。": "Changes will be applied together when complete.",
  "応答を待っています。このまま待つか、中止できます。": "Waiting for the response. You can keep waiting or stop the request.",

  "AIの応答が時間内に完了しませんでした。もう一度お試しください。":
    "The AI response timed out. Please try again.",
  "AIの編集を完了できませんでした。変更は適用していません。依頼を小さく分けてお試しください。":
    "The AI couldn't complete the edit. No changes were applied. Try a smaller request.",
  "AIへの依頼を中止しました。変更は適用していません。":
    "The AI request was stopped. No changes were applied.",
  "待機中に編集内容が変わったため、AIの変更は適用していません。もう一度依頼してください。":
    "The document changed while waiting, so the AI edits were not applied. Please ask again.",
  "中止": "Stop",
  // app/api/allowed-users/route.ts
  "ログインが必要です":
    "You need to sign in",
  "指定が正しくありません":
    "Invalid parameters",
  "リクエストが正しくありません":
    "Invalid request",
  "ログインが設定されていないため、アカウント管理は使えません":
    "Account management isn't available because sign-in isn't configured",
  "メールアドレスの形式が正しくありません":
    "Invalid email address",
  "このアカウントはすでに許可されています":
    "This account already has access",
  "自分自身のアカウントは削除できません":
    "You can't remove your own account",
  "サーバーの設定で許可されているため、ここからは削除できません":
    "Allowed by the server settings, so it can't be removed here",
  "このアカウントは見つかりません":
    "Account not found",
  // app/api/assets/file/route.ts
  "パスが正しくありません":
    "Invalid path",
  "見つかりません":
    "Not found",
  // app/api/assets/route.ts
  "ファイルがありません":
    "No file was provided",
  "この種類のファイルはアップロードできません":
    "This file type can't be uploaded",
  "ファイルが大きすぎます（25MBまで）":
    "The file is too large (max 25MB)",
  // app/api/fetch-json/route.ts
  "http(s) のURLを指定してください":
    "Enter an http(s) URL",
  "URLを読み取れません":
    "Couldn't read the URL",
  "このホストへのアクセスは許可されていません":
    "Access to this host isn't allowed",
  "読み込めませんでした（HTTP {status}）":
    "Couldn't load (HTTP {status})",
  "JSONが大きすぎます（5MBまで）":
    "The JSON is too large (max 5MB)",
  "JSONとして読み取れませんでした":
    "Couldn't parse it as JSON",
  "読み込みがタイムアウトしました（15秒）":
    "Loading timed out (15 seconds)",
  "読み込めませんでした":
    "Couldn't load",
  // app/api/publish/route.ts
  "認証が設定されていません":
    "Authentication isn't configured",
  "{step}に失敗しました（{status}）":
    "{step} failed ({status})",
  "アセット（{path}）のアップロード":
    "Uploading asset ({path})",
  "アセットの保存先が設定されていません。管理者に確認してください":
    "Asset storage isn't configured. Contact your administrator",
  "アセットを読み込めませんでした: {path}":
    "Couldn't load asset: {path}",
  "許可されていないアセット指定です: {source}":
    "Asset source not allowed: {source}",
  "ブランチの取得":
    "Fetching the branch",
  "ツリーの取得":
    "Fetching the tree",
  "アセットの指定が正しくありません":
    "Invalid asset reference",
  "リポジトリの初期化":
    "Initializing the repository",
  "ツリーの作成":
    "Creating the tree",
  "コミットの作成":
    "Creating the commit",
  "ブランチの更新":
    "Updating the branch",
  "ブランチの作成":
    "Creating the branch",
  // app/error.tsx
  "画面を表示できませんでした":
    "Something went wrong",
  "編集中のデータは保存されています。もう一度表示するか、ページを再読み込みしてください。":
    "Your work has been saved. Try again, or reload the page.",
  "もう一度表示する":
    "Try again",
  "再読み込み":
    "Reload",
  // app/global-error.tsx
  "編集中のデータは保存されています。ページを再読み込みしてください。":
    "Your work has been saved. Please reload the page.",
  // app/layout.tsx
  "Webサイトを見たまま編集して公開するエディタです。":
    "A visual editor for building and publishing websites.",
  // app/login/page.tsx
  "ログイン | Tsumu":
    "Sign in | Tsumu",
  "見たままの画面で、文字や画像を直接編集":
    "Edit text and images directly on the page",
  "スマホでの見え方も、その場で確かめて調整":
    "Check and adjust the phone layout as you go",
  "できあがったら、ボタン1つでサイトに公開":
    "Publish your site with a single click",
  "Webサイトを見たまま編集して、そのまま公開できるエディタです。":
    "Edit your website visually and publish it as is.",
  "このGoogleアカウントは、まだ利用が許可されていません。管理者にアカウントの追加を依頼してください。":
    "This Google account doesn't have access yet. Ask an administrator to add it.",
  "ログインできませんでした。時間をおいて、もう一度お試しください。":
    "Couldn't sign in. Please wait a moment and try again.",
  "Googleでログイン":
    "Sign in with Google",
  "Googleに移動しています…":
    "Redirecting to Google…",
  "利用を許可されたGoogleアカウントでログインします。":
    "Sign in with a Google account that has been granted access.",
  // app/page.tsx
  "⌘ を押しながらクリックすると、いちばん奥の要素を直接選べます。":
    "⌘-click to select the innermost element directly.",
  "⇧Enter で、選んでいる要素の親を選べます。":
    "Press ⇧Enter to select the parent of the current element.",
  "⌘D で、選んでいる要素をまとめて複製できます。":
    "Press ⌘D to duplicate everything you've selected.",
  "⌘[ と ⌘] で、左右のパネルを開け閉めできます。":
    "Press ⌘[ and ⌘] to show or hide the left and right panels.",
  "並べ方は、並べたい要素ではなく、それを囲む親のボックスで決めます。":
    "How items are arranged is set on the box around them, not on the items themselves.",
  "幅を % で決めて「最大幅」を付けると、どの画面でも崩れにくくなります。":
    "Set widths in % and add a Max width so layouts hold up on any screen.",
  "スマホ表示で変えた設定は、スマホにだけ効きます。":
    "Changes made in the phone view apply to phones only.",
  "色の付いた項目名を右クリックすると、その画面幅での変更を取り消せます。":
    "Right-click a highlighted property name to undo its change for this screen size.",
  "どのページにも置くヘッダーは、右クリックから「コンポーネント化」すると1か所の修正で済みます。":
    "Turn a header used on every page into a component (right-click) so one edit updates them all.",
  "公開した版は、公開履歴からいつでも戻せます。":
    "You can roll back to any published version from the publish history.",
  "? キーでヘルプを開くと、やりたいことから操作を探せます。":
    "Press ? to open Help and search by what you want to do.",
  "エディタを準備しています":
    "Preparing the editor",
  "ヒント":
    "Tip",
  // middleware.ts
  "認証が設定されていません。AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / ALLOWED_EMAILS を環境変数に設定してください。":
    "Authentication isn't configured. Set AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / ALLOWED_EMAILS as environment variables.",
  // lib/db.ts
  "データベースが設定されていません。管理者に確認してください":
    "The database isn't configured. Contact your administrator",
  // lib/kv.ts
  // components/Canvas.tsx
  "アップロードできませんでした":
    "Couldn't upload",
  "（コンポーネントが自分自身を含んでいるため表示できません）":
    "(Can't display: the component contains itself)",
  "送信":
    "Submit",
  "動画のURLを設定パネルで指定してください":
    "Set the video URL in the Settings panel",
  "音声のURLを設定パネルで指定してください":
    "Set the audio URL in the Settings panel",
  "YouTubeのURLを設定パネルで指定してください":
    "Set the YouTube URL in the Settings panel",
  "住所またはマップのURLを設定パネルで指定してください":
    "Set an address or map URL in the Settings panel",
  "埋め込むURLを設定パネルで指定してください":
    "Set the URL to embed in the Settings panel",
  "リストの設定で、並べる配列を選んでください":
    "Choose the array to list in the list settings",
  "表示できる項目がありません（データの読み込み・絞り込み条件を確認してください）":
    "No items to show (check the data source and filters)",
  "（コンポーネントが見つかりません）":
    "(Component not found)",
  "このページは「{redirectTo}」へ301リダイレクトします":
    "This page redirects (301) to \"{redirectTo}\"",
  "このページは外部サイト「{rewriteTo}」の内容を中継して表示します":
    "This page shows content from the external site \"{rewriteTo}\"",
  "右パネルで301リダイレクト先または表示する外部サイトを設定してください":
    "Set a 301 redirect target or an external site in the right panel",
  "右パネルにHTMLコードを入力するか、ファイルを読み込んでください":
    "Enter HTML code in the right panel, or load a file",
  "アップロード中…":
    "Uploading…",
  "ドロップして画像を追加":
    "Drop to add images",
  "幅 {customWidth}px（{label}）を編集中":
    "Editing at {customWidth}px ({label})",
  "変更は{scope}。パソコンの見た目は変わりません":
    "{scope}. The desktop layout won't change",
  "変更は{scope}":
    "{scope}",
  "パソコン表示に戻る":
    "Back to desktop",
  "コンポーネントを編集中:":
    "Editing component:",
  "（変更はすべてのインスタンスに反映されます）":
    " (changes apply to every instance)",
  "完了":
    "Done",
  "表示中のデータ:":
    "Showing data:",
  "（該当なし）":
    "(No match)",
  "項目 {p1}":
    "Item {p1}",
  "一致するデータがありません（公開サイトでは404）":
    "No matching data (shows 404 on the live site)",
  "読み込み中…":
    "Loading…",
  "読み込み直す":
    "Reload",
  "左の「追加」タブから要素を置いてください":
    "Add elements from the Add tab on the left",
  "親要素を選択":
    "Select parent",
  "親要素を選択（⇧Enter）":
    "Select parent (⇧Enter)",
  // components/DataView.tsx
  "一覧・{length}件":
    "List · {length} items",
  "{length}項目":
    "{length} fields",
  "{p1}番目":
    "#{p1}",
  "（空）":
    "(empty)",
  "{length}件":
    "{length} items",
  "番号":
    "#",
  "{n}件目の中身":
    "Contents of item {n}",
  "行をクリックすると、配列や入れ子の中身まで確認できます。":
    "Click a row to inspect arrays and nested values.",
  "はい":
    "Yes",
  "いいえ":
    "No",
  "ほか{n}件":
    "and {n} more",
  "取得したデータの {p1}":
    "{p1} in the fetched data",
  "表示の切り替え":
    "Switch view",
  "表":
    "Table",
  "ツリー":
    "Tree",
  "取得したデータ":
    "Fetched data",
  // components/DialogHost.tsx
  "キャンセル":
    "Cancel",
  "お知らせ":
    "News",
  "入力してください":
    "Enter a value",
  "確認":
    "Confirm",
  // components/Editor.tsx
  "ヘルプ":
    "Help",
  "貼り付けたSVG":
    "Pasted SVG",
  "貼り付けた画像":
    "Pasted image",
  "Figmaでは「SVGとしてコピー」、Illustratorでは「SVGコードを含める」でコピーしてください":
    "In Figma use \"Copy as SVG\"; in Illustrator, enable \"Include SVG code\" when copying",
  "デザインを貼り付けています…":
    "Pasting design…",
  "画像データを読み取れませんでした":
    "Couldn't read the image data",
  "SVGをベクター画像として貼り付けました":
    "Pasted the SVG as a vector image",
  "画像を貼り付けました":
    "Image pasted",
  "貼り付けできませんでした":
    "Couldn't paste",
  "送信できませんでした":
    "Couldn't send",
  "左のパネル":
    "Left panel",
  "キャンバス":
    "Canvas",
  "右のパネル":
    "Right panel",
  "操作ガイド":
    "Guide",
  "チュートリアル":
    "Tutorial",
  "保存されていない変更があります":
    "You have unsaved changes",
  "前回このブラウザで編集した内容が、サーバーに保存されないまま残っています。どちらの内容で編集を続けますか？":
    "Edits you made in this browser last time were never saved to the server. Which version do you want to keep editing?",
  "サーバーの最終保存:":
    "Last saved to server:",
  "（他の人や別ブラウザの変更が含まれている可能性があります）":
    " (may include changes from other people or browsers)",
  "「このブラウザの内容」を選ぶとサーバーへ上書き保存され、「サーバーの内容」を選ぶとこのブラウザの変更は破棄されます。":
    "\"Use this browser's version\" overwrites the server copy. \"Use the server version\" discards this browser's changes.",
  "サーバーの内容を使う":
    "Use the server version",
  "このブラウザの内容を使う":
    "Use this browser's version",
  // components/Footer.tsx
  "ローディング画面":
    "Loading screen",
  "{name}（/{slug}）":
    "{name} (/{slug})",
  "{pages}ページ · {nodes}要素":
    "{pages} pages · {nodes} elements",
  "最終公開 {p1}":
    "Last published {p1}",
  "まだ公開されていません":
    "Not published yet",
  "未公開の変更あり":
    "Unpublished changes",
  "公開済み":
    "Published",
  "未公開":
    "Not published",
  "サーバー保存が設定されていません。クリックで再接続します":
    "Server saving isn't configured. Click to reconnect",
  "クリックで再接続します":
    "Click to reconnect",
  "サーバーに保存 {p1}":
    "Saved to server {p1}",
  "同期を確認中…":
    "Checking sync…",
  "サーバーへ保存中…":
    "Saving to server…",
  "サーバー保存済み":
    "Saved to server",
  "このブラウザにのみ保存":
    "Saved in this browser only",
  "サーバーに保存できません（このブラウザには保存済み）":
    "Couldn't save to server (saved in this browser)",
  "初期状態に戻す":
    "Reset",
  "サイト全体を初期状態に戻します（「元に戻す」で復帰できます）。\n実行するには「初期状態に戻す」と入力してください。":
    "This resets the entire site to its initial state (you can undo it).\nType \"Reset\" to continue.",
  "初期状態に戻しますか？":
    "Reset the site?",
  // components/FrameStage.tsx
  "ドラッグで画面幅を変更（⌥を押しながらで吸着しない・ダブルクリックで元の幅に戻す）":
    "Drag to change the screen width (hold ⌥ to disable snapping, double-click to reset)",
  // components/Glyph.tsx
  "上":
    "Top",
  "下":
    "Bottom",
  "左":
    "Left",
  "右":
    "Right",
  // components/Header.tsx
  "Next.jsプロジェクトとして書き出し":
    "Export as a Next.js project",
  "プロジェクト一式をzipでダウンロードします。展開して {cmd} を実行すると、そのまま動きます。":
    "Downloads the whole project as a zip. Unzip it and run {cmd} to start it.",
  "公開前チェックをすべて通過しました。":
    "All pre-publish checks passed.",
  "次の画像は保存先に見つからなかったため、zipに含めていません（削除済みの可能性があります）。\n{p1}":
    "These images weren't found in storage, so they were left out of the zip (they may have been deleted).\n{p1}",
  "一部の画像を含めずにダウンロードしました":
    "Downloaded without some images",
  "zipを生成できませんでした":
    "Couldn't create the zip",
  "生成中…":
    "Generating…",
  "zipをダウンロード":
    "Download zip",
  "{fallback}（{status}）":
    "{fallback} ({status})",
  "テストサイト":
    "Test site",
  "本番サイト":
    "Live site",
  "公開済みの内容を確認しています…":
    "Checking what's already published…",
  "公開済みの内容を取得できませんでした":
    "Couldn't load the published content",
  "アセットを送信中… 0/{length}":
    "Uploading assets… 0/{length}",
  "アセット（{path}）をアップロードできませんでした":
    "Couldn't upload the asset ({path})",
  "アセットを送信中… {uploadedAssets}/{length}":
    "Uploading assets… {uploadedAssets}/{length}",
  "GitHubへコミットしています…":
    "Committing to GitHub…",
  "公開できませんでした":
    "Couldn't publish",
  "ほか{count}件":
    "and {count} more",
  "次のファイルは、前回の公開のあとにGitHub上で編集されたか、手で追加したファイルと同じ名前です。公開するとエディタの内容で上書きされます（上書き前の内容はGitの履歴に残ります）。\n\n{list}":
    "These files were edited on GitHub after the last publish, or were added by hand with the same name as a generated file. Publishing replaces them with the editor's version (the previous content stays in the Git history).\n\n{list}",
  "GitHub上の変更を上書きしますか？":
    "Overwrite changes made on GitHub?",
  "上書きして公開":
    "Overwrite and publish",
  "ログインが設定されていません":
    "Sign-in is not configured",
  "公開できないファイルの場所が含まれています":
    "The publish includes a file path that isn't allowed",
  "{site}に公開":
    "Publish to {site}",
  "サイトを公開":
    "Publish site",
  "公開データを準備しています…":
    "Preparing files to publish…",
  "コミットしました。まもなくビルドが始まります。":
    "Committed. The build will start shortly.",
  "{w}（このファイルは含めずに公開しました）":
    "{w} (published without this file)",
  "コミットを見る":
    "View commit",
  "閉じる":
    "Close",
  "再試行":
    "Retry",
  "読み込めませんでした（{status}）":
    "Couldn't load ({status})",
  "追加できませんでした":
    "Couldn't add",
  "「{target}」はこのエディタにログインできなくなります。":
    "{target} will no longer be able to sign in to this editor.",
  "ログイン許可を取り消しますか？":
    "Remove sign-in access?",
  "取り消す":
    "Remove",
  "削除できませんでした":
    "Couldn't delete",
  "自分":
    "You",
  "固定":
    "Fixed",
  "自分自身は削除できません":
    "You can't remove yourself",
  "ログイン許可を取り消す":
    "Remove sign-in access",
  "設定":
    "Settings",
  "表示言語":
    "Language",
  "切り替えると画面を読み込み直します。作成中のサイトの内容は変わりません。":
    "The editor reloads when you switch. Your site's content isn't changed.",
  "ログインできるアカウント":
    "Accounts with access",
  "このエディタにGoogleアカウントでログインできるメールアドレスです。":
    "Email addresses that can sign in to this editor with Google.",
  "読み込んでいます…":
    "Loading…",
  "許可されたアカウントがありません。":
    "No accounts have access yet.",
  "追加":
    "Add",
  "追加・削除は次回のログインから反映されます（削除しても、ログイン中のセッションは有効期限まで残ります）。":
    "Changes apply from the next sign-in (removed accounts stay signed in until their session expires).",
  "ログアウトしますか？":
    "Sign out?",
  "もう一度使うには、Googleアカウントでログインし直す必要があります。":
    "You'll need to sign in with Google again to continue.",
  "サーバーへ保存しています。保存が終わってからログアウトすると安全です。":
    "Saving to the server. It's safest to sign out after saving finishes.",
  "サーバーに保存されていない変更があります。このブラウザには残りますが、他の端末からは見えません。":
    "Some changes haven't been saved to the server. They're kept in this browser but won't appear on other devices.",
  "ログアウト":
    "Sign out",
  "左パネルを閉じる":
    "Close left panel",
  "左パネルを開く":
    "Open left panel",
  "サイト共通":
    "Site-wide",
  "{name}（非公開）":
    "{name} (unpublished)",
  "元に戻す":
    "Undo",
  "やり直す":
    "Redo",
  "{label}で表示":
    "View as {label}",
  "画面幅を指定（キャンバス左右の端をドラッグしても変えられます）":
    "Set screen width (you can also drag the canvas edges)",
  "ブレークポイントを編集":
    "Edit breakpoints",
  "ブレークポイント（各デバイスの画面幅）を編集":
    "Edit breakpoints (screen widths for each device)",
  "⌘+スクロールでもズームできます":
    "You can also zoom with ⌘ + scroll",
  "フィット":
    "Fit",
  "デザイン":
    "Design",
  "プレビュー":
    "Preview",
  "ボタンやリンクの動きを試す":
    "Try out buttons and links",
  "zipでエクスポート":
    "Export as zip",
  "公開":
    "Publish",
  "ヘルプ・使い方":
    "Help",
  "右パネルを閉じる":
    "Close right panel",
  "右パネルを開く":
    "Open right panel",
  // components/IconPicker.tsx
  "英語で検索（例: heart, arrow, music）":
    "Search (e.g. heart, arrow, music)",
  "見つかりませんでした":
    "No results",
  // components/ImagePicker.tsx
  "アセットから選択":
    "Choose from assets",
  "クリックで別の画像を選択":
    "Click to choose another image",
  "クリア":
    "Clear",
  "新しい画像をアップロード":
    "Upload a new image",
  "アセットがありません。左パネルの「アセット」から追加してください。":
    "No assets yet. Add some from the Assets tab in the left panel.",
  "アセットを検索":
    "Search assets",
  "「{p1}」に一致するアセットはありません":
    "No assets match \"{p1}\"",
  // components/LeftPanel.tsx
  "複製":
    "Duplicate",
  "ロック解除":
    "Unlock",
  "ロック":
    "Lock",
  "削除":
    "Delete",
  "{p1}では非表示 ― クリックで{p2}":
    "Hidden on {p1} — click to {p2}",
  "・":
    ", ",
  "名前を変更":
    "Rename",
  "展開":
    "Expand",
  "折りたたむ":
    "Collapse",
  "コンポーネント「{name}」を編集中":
    "Editing component \"{name}\"",
  "要素がありません。":
    "No elements yet.",
  "「追加」タブから置けます。":
    "Add some from the Add tab.",
  "bodyの中":
    "Inside body",
  "「{name}」の中":
    "Inside \"{name}\"",
  "「{name}」の後":
    "After \"{name}\"",
  "コンポーネント「{name}」の中":
    "Inside component \"{name}\"",
  "ページ直下":
    "Top level of the page",
  "挿入先":
    "Insert into",
  "クリックで挿入・キャンバスへドラッグでも置けます":
    "Click to insert, or drag onto the canvas",
  "コンポーネント":
    "Components",
  "要素を右クリックして「コンポーネント化」で作れます。ヘッダーなど、複数のページで使い回す部品に使います。":
    "Right-click an element and choose \"Create component\". Use components for parts shared across pages, like headers.",
  "まだありません":
    "None yet",
  "ページの末尾に挿入（コンポーネントの編集を終えます）":
    "Insert at the end of the page (exits component editing)",
  "挿入先に挿入":
    "Insert at the target",
  "マスターを編集":
    "Edit main component",
  "削除（すべてのインスタンスも削除）":
    "Delete (also deletes every instance)",
  "ページに置いた、このコンポーネントの使用箇所（インスタンス）もすべて削除されます。":
    "Every instance of this component placed on pages will also be deleted.",
  "コンポーネント「{name}」を削除しますか？":
    "Delete component \"{name}\"?",
  "ページの要素もすべて削除されます（「元に戻す」で戻せます）。":
    "All elements on the page will be deleted too (you can undo this).",
  "ページ「{name}」を削除しますか？":
    "Delete page \"{name}\"?",
  "公開する":
    "Publish",
  "非公開にする（下書き）":
    "Unpublish (draft)",
  "ページ":
    "Pages",
  "フォルダを作る":
    "New folder",
  "フォルダを作る（ページの整理用。URLには影響しません）":
    "New folder (for organizing pages; doesn't affect URLs)",
  "ページを追加":
    "Add page",
  "ダブルクリックで名前を変更":
    "Double-click to rename",
  "このフォルダにページを追加":
    "Add a page to this folder",
  "フォルダを削除（中のページはフォルダの外へ出ます）":
    "Delete folder (its pages move out of the folder)",
  "ページをここへドラッグして入れられます":
    "Drag pages here",
  "サーバーに保存したアセット {length}件{p2}":
    "{length} assets on the server{p2}",
  "（うち{unknown}件はサイズ不明）":
    " ({unknown} with unknown size)",
  "使用量":
    "Usage",
  "サーバーに保存したファイルも削除され、元に戻せません。":
    "Files on the server will also be deleted. This can't be undone.",
  "使用していないアセット {length}件を削除しますか？":
    "Delete {length} unused assets?",
  "サーバーに保存できないため、このブラウザ内に保存しました。画面下の保存状態を確認してください。":
    "Couldn't save to the server, so it was saved in this browser. Check the save status at the bottom of the screen.",
  "まだサーバーに保存できません。画面下の保存状態を確認してください。":
    "Can't save to the server yet. Check the save status at the bottom of the screen.",
  "サーバーへ移せませんでした":
    "Couldn't move it to the server",
  "{used}箇所で使用中です。使っている要素からも外して削除します。サーバーのファイルも削除されます。":
    "Used in {used} places. It will be removed from those elements and deleted, including the file on the server.",
  "サーバーに保存したファイルも削除されます。":
    "The file on the server will also be deleted.",
  "「{name}」を削除しますか？":
    "Delete \"{name}\"?",
  "ファイルを追加（ドロップでも追加できます）":
    "Add files (or drop them here)",
  "{length} / {length2}件":
    "{length} / {length2}",
  " · 未使用 {length}件":
    " · {length} unused",
  "ページ・サイト設定・スタイルのどこにも使われていないアセットを削除":
    "Delete assets not used in any page, site setting or style",
  "未使用を削除":
    "Delete unused",
  "アセットがありません。":
    "No assets yet.",
  "ファイルをアップロードすると、ここに表示されます。":
    "Uploaded files will appear here.",
  "選択中の画像に適用":
    "Apply to selected image",
  "ページに挿入":
    "Insert into page",
  "{name}（ダブルクリックで名前を変更）":
    "{name} (double-click to rename)",
  "動画":
    "Video",
  "音声":
    "Audio",
  " · {used}箇所":
    " · used in {used}",
  "サーバーへアップロード":
    "Upload to server",
  "ダウンロード":
    "Download",
  "レイヤー":
    "Layers",
  "アセット":
    "Assets",
  "サイト":
    "Site",
  " · このブラウザのみ":
    " · this browser only",
  // components/NodeContextMenu.tsx
  "コンポーネントを編集":
    "Edit component",
  "インスタンスを解除":
    "Detach instance",
  "コンポーネント化":
    "Create component",
  "リスト化":
    "Turn into list",
  "アセットを表示":
    "Show in assets",
  "テキストを編集":
    "Edit text",
  "コピー":
    "Copy",
  "切り取り":
    "Cut",
  "貼り付け":
    "Paste",
  "前へ移動":
    "Move up",
  "後ろへ移動":
    "Move down",
  "親を選択":
    "Select parent",
  "削除（ロック中）":
    "Delete (locked)",
  // components/PagePanel.tsx
  "このページ":
    "This page",
  "要素が未選択":
    "No element selected",
  "ZIPに入れられるファイルは200個までです":
    "A zip can contain up to 200 files",
  "ZIP内にHTMLファイルが見つかりません":
    "No HTML file found in the zip",
  "アセットをアップロード中… {p1} / {length}":
    "Uploading assets… {p1} / {length}",
  "{name} と {length}個のアセットを読み込みました":
    "Loaded {name} and {length} assets",
  "ZIPを読み込めませんでした":
    "Couldn't load the zip",
  "このページの要素は表示・編集できなくなります（データは残るので、元の種類に戻せばまた表示されます）。":
    "This page's elements will no longer be shown or editable (they're kept, so switching back restores them).",
  "HTMLページに切り替えますか？":
    "Switch to an HTML page?",
  "リダイレクトページに切り替えますか？":
    "Switch to a redirect page?",
  "切り替える":
    "Toggle",
  "ページ設定 ― {name}":
    "Page settings — {name}",
  "このページを公開する":
    "Publish this page",
  "非公開のページは書き出し・公開に含まれません（下書きとして残ります）。":
    "Unpublished pages are left out of exports and publishing (they stay as drafts).",
  "名前":
    "Name",
  "ページのアドレスです（例: blog なら {p1}/blog）。\n「blog?tab=news」のようにクエリを付けると、このページへのリンクに付き、ページ内では {tab} として使えます。\n「blog/[slug]」のように [slug] を入れると、データの1件ごとの詳細ページになります。":
    "The page's address (e.g. blog becomes {p1}/blog).\nAdd a query like \"blog?tab=news\" to append it to links to this page; inside the page it's available as {tab}.\nInclude [slug], as in \"blog/[slug]\", to create a detail page for each data item.",
  "（トップページ）":
    "(Home page)",
  "データの1件ごとの詳細ページ":
    "A detail page for each data item",
  "1つのデザインから、データの1件ごとにページが作られます（例: /{base}/1、/{base}/2 …）。\nこのページのスクリプト「ページを開いたとき」で、URLに {slug} を入れて1件を取得するか、一覧から項目が {slug} の1件を探して変数にしてください。":
    "One design generates a page for each data item (e.g. /{base}/1, /{base}/2 …).\nIn this page's \"When the page opens\" script, fetch one item using {slug} in the URL, or find the item whose field matches {slug} in a list and store it in a variable.",
  "外側の背景色":
    "Outer background color",
  "ページの端を越えてスクロールしたときに見える色です。未設定のときはbodyの背景色を使います。":
    "The color shown when scrolling past the edge of the page. Uses the body background color if not set.",
  "スクリプト":
    "Scripts",
  "「ボタンをクリックしたとき」などのきっかけに、ページを開く・要素を表示するといった動作をつないで、ページに動きを付けられます。":
    "Connect triggers like \"when a button is clicked\" to actions like opening a page or showing an element to make your page interactive.",
  "スクリプトを編集":
    "Edit scripts",
  "検索・シェア（SEO）":
    "Search & sharing (SEO)",
  "タイトル":
    "Title",
  "説明文":
    "Description",
  "検索結果やSNSでシェアされたときに表示される紹介文です。":
    "A short summary shown in search results and when shared on social media.",
  "シェア用画像（OGP）":
    "Share image (OGP)",
  "SNSでリンクがシェアされたときに表示される画像です。未設定のときはサイト設定の画像を使います。1200×630pxがおすすめです。":
    "The image shown when a link is shared on social media. Uses the site's default image if not set. 1200×630px is recommended.",
  "Googleなどの検索結果に表示させない":
    "Hide from search results (Google, etc.)",
  "カスタムコード":
    "Custom code",
  "ページの種類":
    "Page type",
  "キャンバスで要素を組み立てる標準のページです。「HTML」にすると、このページをコードで直接書けます。":
    "A standard page built from elements on the canvas. Choose \"HTML\" to write this page directly in code.",
  "通常":
    "Standard",
  "コードを直接書いて配信":
    "Serve hand-written code",
  "リダイレクト":
    "Redirect",
  "別のURLへ301転送":
    "301 redirect to another URL",
  "301リダイレクト先":
    "301 redirect target",
  "このページへアクセスしたブラウザを転送先へ恒久的に移動します。リダイレクトページのキャンバスは編集できません。":
    "Permanently sends visitors of this page to the target. Redirect pages can't be edited on the canvas.",
  "/new-page または https://example.com/...":
    "/new-page or https://example.com/...",
  "外部サイトを表示（リバースプロキシ）":
    "Show an external site (reverse proxy)",
  "ブラウザのURLは変えず、指定した外部サイトの内容をこのURLで中継して表示します。このページ以下のパスも転送先の同じパスへ中継されます。301リダイレクトとは同時に設定できません。":
    "Shows the external site's content at this URL without changing the address bar. Paths under this page are forwarded to the same paths on the target. Can't be combined with a 301 redirect.",
  "HTMLファイルを読み込む":
    "Load an HTML file",
  "index.html を優先して読み込みます。同梱のファイルはアセットにアップロードし、HTML内のパスを自動で書き換えます":
    "Loads index.html first. Bundled files are uploaded as assets and paths in the HTML are rewritten automatically",
  "ZIPを読み込み中…":
    "Loading zip…",
  "HTMLとアセットのZIPを読み込む":
    "Load a zip of HTML and assets",
  "HTMLコード":
    "HTML code",
  "scriptやCSSを含むHTMLをそのまま配信します（このページにはNext.jsのレイアウトやメタデータは適用されません）。":
    "Serves the HTML, including scripts and CSS, as is (Next.js layouts and metadata don't apply to this page).",
  "先頭コード（このページのみ）":
    "Head code (this page only)",
  "このページのHTMLの先頭・末尾に挿入されます。このページだけで使う計測タグや構造化データ（JSON-LD）などに使います。タイトルや説明文は「検索・シェア」で設定してください。":
    "Inserted at the start or end of this page's HTML. Use it for page-specific tracking tags, structured data (JSON-LD) and so on. Set the title and description under \"Search & sharing\".",
  "末尾コード（このページのみ）":
    "End code (this page only)",
  // components/RightPanel.tsx
  "スタイル":
    "Style",
  // components/SafeBoundary.tsx
  "{label}を表示できませんでした。編集中のデータは保存されています。":
    "Couldn't display {label}. Your work has been saved.",
  "この部分を表示できませんでした。編集中のデータは保存されています。":
    "Couldn't display this part. Your work has been saved.",
  // components/ScriptEditor.tsx
  "変数":
    "Variables",
  "配列":
    "Array",
  "なし":
    "None",
  "きっかけ":
    "Triggers",
  "ずっとくり返す":
    "forever",
  "データ":
    "Data",
  "移動":
    "Navigation",
  "入力":
    "Input",
  "ストレージ":
    "Storage",
  "制御":
    "Control",
  "［URL］のデータを取得して［名前］とする":
    "Fetch data from ［URL］ as ［name］",
  "［要素］を［表示する / 隠す / 切り替える］":
    "［Show / Hide / Toggle］［element］",
  "［ページ / URL］を開く":
    "Open ［page / URL］",
  "［要素］までスクロールする":
    "Scroll to ［element］",
  "［入力欄］に［値］を入れる":
    "Set ［field］ to ［value］",
  "文字列［］を［,］で分解して配列［］とする":
    "Split text ［］ by ［,］ into array ［］",
  "配列［］を［、］でつないで変数［］とする":
    "Join array ［］ with ［, ］ into variable ［］",
  "配列［］の件数を変数［］とする":
    "Store the count of array ［］ in variable ［］",
  "配列［］の要素のうち、項目［］が［値］のものを変数［］とする":
    "Find the item in array ［］ whose ［］ is ［value］ and store it in ［］",
  "配列［］の［…］を項目［］として格納する":
    "Store ［…］ as field ［］ in each item of array ［］",
  "配列［］の要素ごとにくり返す":
    "For each item in array ［］",
  "配列［］を［項目］で絞り込む":
    "Filter array ［］ by ［field］",
  "配列［］の絞り込みを解除する":
    "Clear filters on array ［］",
  "配列［］を［項目］の［小さい順］に並べ替える":
    "Sort array ［］ by ［field］ ［ascending］",
  "ストレージの［キー］に［値］を保存する":
    "Save ［value］ to storage key ［key］",
  "ストレージの［キー］を読み込んで変数［］とする":
    "Load storage key ［key］ into variable ［］",
  "［値 / {データ.位置}］を変数［］とする":
    "Set variable ［］ to ［value / {data.path}］",
  "［{数} + 1］を計算して変数［］とする":
    "Calculate ［{count} + 1］ into variable ［］",
  "［文字］の［A］を［B］に置き換えて変数［］とする":
    "Replace ［A］ with ［B］ in ［text］ into variable ［］",
  "変数［］の［.］区切りに［値］を［切り替える］":
    "［Toggle］［value］ in variable ［］ (separated by ［.］)",
  "［文字］をコピーする":
    "Copy ［text］",
  "［1］秒待つ":
    "Wait ［1］ seconds",
  "もし［条件］なら（でなければ）":
    "If ［condition］ then (else)",
  "［3］回くり返す":
    "Repeat ［3］ times",
  "きっかけの要素":
    "Triggering element",
  "#{value}（見つかりません）":
    "#{value} (not found)",
  "入力欄を選択":
    "Select a field",
  "要素を選択":
    "Select an element",
  "IDの無い要素は、選ぶとIDを自動で付けます":
    "Elements without an ID get one automatically when selected",
  "要素名・IDで検索":
    "Search by name or ID",
  "開く":
    "Open",
  "「{p1}」に一致する要素はありません":
    "No elements match \"{p1}\"",
  "選べる要素がありません":
    "No elements to choose from",
  "新しいタブ":
    "New tab",
  "の値が":
    "'s value",
  "がチェックされている":
    "is checked",
  "がチェックされていない":
    "is not checked",
  "が表示されている":
    "is visible",
  "が隠れている":
    "is hidden",
  "にホバーしている":
    "is hovered",
  "にホバーしていない":
    "is not hovered",
  "と同じ":
    "equals",
  "と違う":
    "does not equal",
  "を含む":
    "contains",
  "を含まない":
    "does not contain",
  "で始まる":
    "starts with",
  "で終わる":
    "ends with",
  "より大きい":
    "is greater than",
  "より小さい":
    "is less than",
  "のいずれかと同じ":
    "is one of",
  "空":
    "is empty",
  "空でない":
    "is not empty",
  "値":
    "Value",
  "要素":
    "Element",
  "{変数}":
    "{variable}",
  "値 / {変数}":
    "value / {variable}",
  "{value}{op}":
    "{op} {value}",
  "{left}が{cond}":
    "{left} {cond}",
  "{target}{action}":
    "{action} {target}",
  "を表示する":
    "Show",
  "を隠す":
    "Hide",
  "の表示を切り替える":
    "Toggle visibility of",
  "{kind}{page}を開く":
    "Open {kind} {page}",
  "ページを選択":
    "Select a page",
  "（削除されたページ）":
    "(deleted page)",
  "{kind}{url}を開く":
    "Open {kind} {url}",
  "https://~ / #ID / {変数}":
    "https://~ / #ID / {variable}",
  "{target}までスクロールする":
    "Scroll to {target}",
  "{target}に{value}を入れる":
    "Set {target} to {value}",
  "文字列{source}を{sep}で分解して配列{into}とする":
    "Split text {source} by {sep} into array {into}",
  "名前（例: 一覧）":
    "Name (e.g. items)",
  "配列{array}の{which}を解除する":
    "Clear {which} on array {array}",
  "ストレージの{key}に{value}を保存する":
    "Save {value} to storage key {key}",
  "キー":
    "Key",
  "ストレージの{key}を読み込んで変数{into}とする":
    "Load storage key {key} into variable {into}",
  "{seconds}秒待つ":
    "Wait {seconds} seconds",
  "配列{array}の件数を変数{into}とする":
    "Store the count of array {array} in variable {into}",
  "{p1}の件数":
    "{p1} count",
  "名前（例: 件数）":
    "Name (e.g. count)",
  "{expr}を計算して変数{into}とする":
    "Calculate {expr} into variable {into}",
  "{数} + 1":
    "{count} + 1",
  "名前（例: 合計）":
    "Name (e.g. total)",
  "{source}の{find}を{to}に置き換えて変数{into}とする":
    "Replace {find} with {to} in {source} into variable {into}",
  "{文字}":
    "{text}",
  "置き換える文字":
    "Text to replace",
  "空なら取り除く / $1":
    "Empty removes it / $1",
  "空なら取り除く":
    "Empty removes it",
  "名前（例: 整形後）":
    "Name (e.g. cleaned)",
  "正規表現":
    "Regex",
  "正規表現の書き方が正しくないため、置き換えません":
    "The regex is invalid, so nothing will be replaced",
  "変数{into}の{sep}区切りに{value}を{op}":
    "{op} {value} in variable {into} (separated by {sep})",
  "足す":
    "Add",
  "取り除く":
    "Remove",
  "{value}をコピーする":
    "Copy {value}",
  "文字 / {変数}":
    "text / {variable}",
  "{value}を変数{into}とする":
    "Set variable {into} to {value}",
  "値 / {データ.位置}":
    "value / {data.path}",
  "{length}件の一覧（リスト要素で並べられます）":
    "A list of {length} items (can be shown with a List element)",
  "要素では {{into}.項目名} のように使えます":
    "Use it in elements like {{into}.field}",
  "見本: {p1}":
    "Sample: {p1}",
  "{domain} の全サブドメインと共有":
    "Share with all subdomains of {domain}",
  "サブドメインと共有":
    "Share with subdomains",
  "サイト設定の公開URLを入れると共有されます":
    "Set the site URL in Site settings to enable sharing",
  "データを読み取れませんでした。WebページではなくJSONを返すURLか確認してください":
    "Couldn't read the data. Make sure the URL returns JSON, not a web page",
  "{url}のデータを取得して{as}とする":
    "Fetch data from {url} as {as}",
  "https://~（{slug} などの変数も使えます）":
    "https://~ (variables like {slug} work too)",
  "名前（例: 商品データ）":
    "Name (e.g. products)",
  "データを見る":
    "View data",
  "最後":
    "Last",
  "一覧の位置（例: products）":
    "List path (e.g. products)",
  "項目（例: name）":
    "Field (e.g. name)",
  "位置（例: data.title）":
    "Path (e.g. data.title)",
  "一覧を選択":
    "Select a list",
  "位置を選択":
    "Select a path",
  "項目を選択":
    "Select a field",
  "全体":
    "Everything",
  "ひとつ上へ":
    "Up one level",
  "ここ全体":
    "All of this",
  "{label} の中を見る":
    "Look inside {label}",
  "中に項目がありません":
    "No fields inside",
  "一覧（配列）が見つかりません":
    "No list (array) found",
  "名前（例: 商品）":
    "Name (e.g. product)",
  "同じ名前の変数がほかのブロックにもあります。後から動いたブロックの値で上書きされます":
    "Another block uses the same variable name. Whichever block runs last wins",
  "上書き":
    "Overwrites",
  "配列を選択":
    "Select an array",
  "配列がありません":
    "No arrays",
  "（見つかりません）":
    "(not found)",
  "変数を選択":
    "Select a variable",
  "変数がありません":
    "No variables",
  "変数の中の配列":
    "Arrays inside variables",
  "配列{array}の要素のうち、項目{field}が{value}のものを変数{into}とする":
    "Find the item in array {array} whose {field} is {value} and store it in {into}",
  "値 / {slug}":
    "value / {slug}",
  "見本では一致する要素がありません":
    "No matching item in the sample",
  "配列{array}の{value}を項目{field}として格納する":
    "Store {value} as field {field} in each item of array {array}",
  "値 / {項目}":
    "value / {field}",
  "項目名":
    "Field name",
  "くり返し中の要素だけに格納します":
    "Stores only into the current item of the loop",
  "リストの項目では {{field}} として使えます（見本: {sample}）":
    "Use it in list items as {{field}} (sample: {sample})",
  "{p1}の文字":
    "{p1} text",
  "配列{array}の{field}を{sep}でつないで変数{into}とする":
    "Join {field} of array {array} with {sep} into variable {into}",
  "配列{array}を{sep}でつないで変数{into}とする":
    "Join array {array} with {sep} into variable {into}",
  "見本:":
    "Sample:",
  "配列{array}を{field}の{dir}に並べ替える":
    "Sort array {array} by {field} {dir}",
  "小さい順":
    "ascending",
  "大きい順":
    "descending",
  "すべての絞り込み":
    "all filters",
  "絞り込み{n}":
    "Filter {n}",
  "絞り込み{n}（見つかりません）":
    "Filter {n} (not found)",
  "配列{array}を{field}が{cond}":
    "Filter array {array} to items where {field} {cond}",
  "{field}が{cond}":
    "{field} {cond}",
  "ものに絞り込む":
    " ",
  "かつ":
    "and",
  "または":
    "or",
  "絞り込みの番号（自動）。「絞り込みを解除する」で番号を選ぶと、この絞り込みだけを外せます":
    "Filter number (automatic). Choose it in \"Clear filters\" to remove just this filter",
  "同じ配列のほかの絞り込みとのつなぎ方":
    "How this combines with other filters on the same array",
  "ほかの絞り込みと「かつ」":
    "AND with other filters",
  "ほかの絞り込みと「または」":
    "OR with other filters",
  "この条件を削除":
    "Remove this condition",
  "配列{array}の要素ごとにくり返す":
    "For each item in array {array}",
  "中では要素の項目を {項目} で使えます":
    "Inside, use the item's fields as {field}",
  "取得したデータの配列は、ページを開いたときのスクリプトの直下で、中を「項目として格納」と変数の「もし」だけにすると動きます":
    "For fetched data arrays, this only works directly under the page's \"When the page opens\" script, with only \"Store as field\" and variable \"If\" blocks inside",
  "{times}{mode}":
    "Repeat {times} {mode}",
  "回くり返す":
    "times",
  "中に「秒待つ」を入れると間隔を決められます":
    "Add a \"Wait\" block inside to set the interval",
  "もし{cond}なら":
    "If {cond} then",
  "でなければ":
    "Else",
  "「でなければ」を外す":
    "Remove \"Else\"",
  "ページを開いたときのスクリプトの下に置くと動きます":
    "Works when placed under the page's \"When the page opens\" script",
  "動作をここへ":
    "Drop actions here",
  "表示した要素の上ではホバー中とみなす":
    "Treat hovering over shown elements as still hovering",
  "リンクとして出力":
    "Output as a link",
  "要素を選ぶまで実行されません":
    "Won't run until an element is chosen",
  "きっかけが無いため実行されません":
    "Won't run without a trigger",
  "取得し直す":
    "Fetch again",
  "（{p1} に取得した見本。一覧は先頭20件まで）":
    "(sample fetched {p1}; lists show the first 20 items)",
  "クリックでスクリプトを編集":
    "Click to edit scripts",
  "きっかけなし（実行されません）":
    "No trigger (won't run)",
  "ほか{n}件の動作":
    "and {n} more actions",
  "動作がありません":
    "No actions",
  "スクリプト画面":
    "Script editor",
  "{name}（#{attrId}）":
    "{name} (#{attrId})",
  "ブロック一覧を閉じる":
    "Close block list",
  "ブロック一覧を開く":
    "Open block list",
  "ページ「{name}」のすべての要素のスクリプト":
    "Scripts for all elements on \"{name}\"",
  "{n}個を選択中":
    "{n} selected",
  "表示倍率":
    "Zoom",
  "縮小":
    "Zoom out",
  "100%に戻す":
    "Reset to 100%",
  "拡大":
    "Zoom in",
  "取り消す（⌘Z）":
    "Undo (⌘Z)",
  "やり直す（⇧⌘Z）":
    "Redo (⇧⌘Z)",
  "ここで離すと削除":
    "Release here to delete",
  "左の「きっかけ」をここへドラッグし、どの要素のきっかけかを選んでから、その下に動作のブロックをつなげます。":
    "Drag a trigger from the left onto this area, choose its element, then attach action blocks below it.",
  "例: 「［ボタン］クリックしたとき」{arrow}「［ページ］を開く」":
    "Example: \"［Button］ When clicked\" {arrow} \"Open ［page］\"",
  "データを表示するときは、「［URL］のデータを取得して［名前］とする」の下に「［値］を変数［］とする」をつなげて中身を取り出します（ページを開いたときに実行されます）。一覧を入れた変数をリスト要素の設定で選ぶと、1件ずつ並びます。":
    "To show data, attach \"Set variable ［］ to ［value］\" under \"Fetch data from ［URL］ as ［name］\" to pull out what you need (it runs when the page opens). Choose a variable holding a list in a List element's settings to show each item.",
  "ドラッグでつなげる・並べ替え":
    "Drag to connect and reorder",
  "+クリック・空き部分のドラッグで複数選択":
    "+click or drag on empty space to multi-select",
  "全選択":
    "Select all",
  "取り消し・やり直し":
    "Undo/redo",
  "「クリックしたとき」にページやURLを開くだけのスクリプトは、リンク（aタグ）として出力されます。\nストレージは localStorage → このサイトだけのクッキー → メモリ（ページを閉じると消える）の順に、使えるところへ保存します。":
    "Scripts that only open a page or URL \"When clicked\" are output as links (a tags).\nStorage uses localStorage, then a cookie for this site only, then memory (lost when the page closes), whichever is available.",
  "{menuCount}個のブロックを削除":
    "Delete {menuCount} blocks",
  "スクリプトを削除":
    "Delete script",
  "このブロックを削除":
    "Delete this block",
  // components/SettingsPanel.tsx
  "アイコン一覧を読み込み中…":
    "Loading icons…",
  "text（テキスト）":
    "text",
  "email（メールアドレス）":
    "email (email address)",
  "password（パスワード）":
    "password",
  "number（数値）":
    "number",
  "tel（電話番号）":
    "tel (phone number)",
  "url（URL）":
    "url",
  "search（検索）":
    "search",
  "date（日付）":
    "date",
  "time（時刻）":
    "time",
  "datetime-local（日時）":
    "datetime-local (date and time)",
  "month（月）":
    "month",
  "week（週）":
    "week",
  "color（色）":
    "color",
  "range（範囲）":
    "range (slider)",
  "ID属性":
    "ID attribute",
  "この要素の値は {{attrId}} として、データの取得先URLやリンクに差し込めます。":
    "This element's value can be inserted into data URLs and links as {{attrId}}.",
  "ページ内リンクのアンカーや、{変数} として値を差し込むときの名前になります。":
    "Used as the anchor for in-page links, and as the name when inserting the value as a {variable}.",
  "アンカー・{変数} の名前":
    "Anchor / {variable} name",
  "ID「slug」は、このページの変数 {slug} と重なっています。別のIDにしてください。":
    "The ID \"slug\" conflicts with this page's {slug} variable. Use a different ID.",
  "ID「{id}」がこのページの{n}個の要素で重なっています。{変数}やアンカーが正しく動かないので、別々のIDにしてください。":
    "The ID \"{id}\" is used by {n} elements on this page. Variables and anchors won't work correctly, so give each a unique ID.",
  "ロック中は削除できません":
    "Can't delete while locked",
  "複数のページで使い回せる部品にします（マスターを編集すると、すべての使用箇所に反映されます）":
    "Turn into a reusable part for multiple pages (edits to the main component apply everywhere)",
  "このボックスをお手本にして、データの件数分くり返すリストにします":
    "Use this box as a template and repeat it for each data item",
  "コンポーネント ― {name}":
    "Component — {name}",
  "コンポーネントのインスタンスです。中身を変えるにはマスターを編集します（すべての使用箇所に反映されます）。":
    "This is an instance of a component. To change its content, edit the main component (changes apply everywhere it's used).",
  "リスト":
    "List",
  "リストの1つ目がお手本のカードです。カードの中の文字で「{」を入力して項目を選ぶと、すべてのカードに反映されます。\n並べ替えや絞り込みは、スクリプトの「並べ替える」「絞り込む」で行います。":
    "The first item is the template card. Type \"{\" in its text and pick a field to apply it to every card.\nSort and filter with the \"Sort\" and \"Filter\" script actions.",
  "配列 · ページを開いてから値が決まる":
    "Array · set after the page opens",
  "配列 · 見本{length}件":
    "Array · {length} sample items",
  "外側のリストの項目 · 見本{count}件":
    "Outer list item · {count} samples",
  "並べる配列":
    "Array to list",
  "選択してください":
    "Select…",
  "{p1}（配列になっていません）":
    "{p1} (not an array)",
  "スクリプトで変数に入れると選べるようになります":
    "Store it in a variable with a script to make it selectable",
  "スクリプトでデータを変数に入れるか、文字列を分解して配列にすると、ここで選べるようになります":
    "Store data in a variable or split text into an array with a script, and it will appear here",
  "スクリプトで配列を作る":
    "Create an array with a script",
  "表示件数":
    "Items to show",
  "意味付け（出力タグ）":
    "Meaning (output tag)",
  "{label}（{value}）":
    "{label} ({value})",
  "pre・aside など、出力するタグ名を自由に指定します":
    "Specify any tag name to output, such as pre or aside",
  "タグ名":
    "Tag name",
  "空欄や使えないタグ名のときは div で出力します":
    "Outputs a div when empty or when the tag name can't be used",
  "「クリックしたとき」などのきっかけに、ページを開く・要素を表示するといった動作をつないで、要素に動きを付けられます。":
    "Connect triggers like \"when clicked\" to actions like opening a page or showing an element to make it interactive.",
  "\n「クリックしたとき」にページやURLを開くだけのスクリプトは、リンク（a タグ）として出力されます。":
    "\nA script that only opens a page or URL \"when clicked\" is output as a link (a tag).",
  "ページのスクリプトを編集":
    "Edit page scripts",
  "画像":
    "Image",
  "（アセット画像）":
    "(asset image)",
  "https:// または {変数}":
    "https:// or {variable}",
  "代替テキスト":
    "Alt text",
  "画像の説明（必須）":
    "Describe the image (required)",
  "代替テキストが未設定です。公開前チェックで警告されます。":
    "No alt text. The pre-publish check will warn about this.",
  "優先して読み込む（最初に見える画像向け）":
    "Load first (for images visible on page load)",
  "iPhoneで影がぼやけるのを防ぐ（公開時に適用）":
    "Prevent blurry shadows on iPhone (applied when publishing)",
  "元のサイズ: {w} × {h}px":
    "Original size: {w} × {h}px",
  "アイコン ― {name}":
    "Icon — {name}",
  "色はスタイルの「テキスト → 色」、大きさは「サイズ」で調整できます。":
    "Change the color with Style → Text → Color, and the size with Size.",
  "アイコン {name}":
    "Icon {name}",
  "フォーム部品":
    "Form field",
  "上の「ID属性」が入力値の名前になります。{ID} と書くと、データの取得先URLなどに差し込めます。":
    "The ID attribute above becomes the value's name. Write {ID} to insert it into data URLs and more.",
  "\n同じID属性のラジオボタンは、1つだけ選べるグループになります。":
    "\nRadio buttons with the same ID form a group where only one can be selected.",
  "表示テキスト":
    "Label",
  "初期値":
    "Default value",
  "選択肢と同じ文字を入力":
    "Enter text matching an option",
  "最初から入力されている文字":
    "Text entered by default",
  "プレースホルダ":
    "Placeholder",
  "未入力時に薄く表示される文字":
    "Faint text shown when empty",
  "選択肢（1行に1つ）":
    "Options (one per line)",
  "ID属性が未設定のため、この部品の値は送信されません。":
    "This field has no ID attribute, so its value won't be submitted.",
  "mp4・mp3などのファイルのURLを指定します。YouTubeは「YouTube」要素を使ってください。":
    "Enter the URL of a file such as mp4 or mp3. For YouTube, use the YouTube element.",
  "ファイルURL":
    "File URL",
  "（アセットの動画）":
    "(asset video)",
  "（アセットの音声）":
    "(asset audio)",
  "対応するアセットがありません。左パネルの「アセット」から追加してください。":
    "No matching assets. Add some from the Assets tab in the left panel.",
  "くり返し再生":
    "Loop",
  "自動再生（ミュートされます）":
    "Autoplay (muted)",
  "ミュート":
    "Mute",
  "Googleマップ":
    "Google Maps",
  "URL埋め込み":
    "Embed URL",
  "埋め込みを許可していないサイトは表示されないことがあります。":
    "Sites that don't allow embedding may not appear.",
  "動画のURL":
    "Video URL",
  "住所・場所名・マップのURL":
    "Address, place name or map URL",
  "埋め込むページのURL":
    "URL of the page to embed",
  "例: 東京駅":
    "e.g. Eiffel Tower",
  "URLを読み取れませんでした。形式を確認してください。":
    "Couldn't read the URL. Check its format.",
  "カスタムコード（HTML）":
    "Custom code (HTML)",
  "そのままHTMLとして埋め込まれます。":
    "Embedded as HTML as is.",
  // components/SitePanel.tsx
  "ローディングテキスト":
    "Loading text",
  "ローディング画面を表示する":
    "Show a loading screen",
  "見た目は、通常のページと同じようにキャンバスで要素を追加・編集できます。":
    "Design it on the canvas, just like a regular page.",
  "ローディング画面を編集":
    "Edit loading screen",
  "最短の表示時間（ms）":
    "Minimum display time (ms)",
  "フェード（ms）":
    "Fade (ms)",
  "同じタブでは初回だけ表示する":
    "Show only once per tab",
  "スタンドアロン":
    "Standalone",
  "アドレスバーのない、アプリと同じ見た目で開きます。":
    "Opens like an app, without the address bar.",
  "最小UI":
    "Minimal UI",
  "戻る・再読み込みなど、最小限の操作だけを残して開きます。":
    "Opens with only minimal controls like back and reload.",
  "全画面":
    "Full screen",
  "ステータスバーも隠して画面全体に表示します。ゲームや展示向けです。":
    "Hides the status bar too and fills the whole screen. Good for games and kiosks.",
  "PWAとして公開する":
    "Publish as a PWA",
  "スマートフォンやパソコンで「ホーム画面に追加」「アプリをインストール」したとき、ブラウザの枠なしでアプリのように開けます。":
    "When added to the home screen or installed as an app, the site opens like an app without the browser frame.",
  "アプリ名":
    "App name",
  "短い名前":
    "Short name",
  "ホーム画面のアイコンの下に出る名前です。12文字程度までにします。":
    "The name shown under the home screen icon. Keep it to about 12 characters.",
  "アイコン":
    "Icon",
  "512×512pxの正方形のPNGがおすすめです。未設定のときはホーム画面アイコンを、それもなければファビコンを使います。":
    "A 512×512px square PNG is recommended. Falls back to the home screen icon, then the favicon.",
  "表示モード":
    "Display mode",
  "テーマ色":
    "Theme color",
  "アプリとして開いたときの、タイトルバーやステータスバーの色です。":
    "The title bar and status bar color when opened as an app.",
  "背景色":
    "Background color",
  "起動してからページが表示されるまでの画面の色です。アイコンの余白にも使われます。":
    "The screen color shown while the app starts. Also used around the icon.",
  "{used}個の要素に設定した「{label}」用のスタイル・表示設定も削除されます（「元に戻す」で戻せます）。":
    "Styles and visibility settings for \"{label}\" on {used} elements will also be deleted (you can undo this).",
  "「{label}」を削除しますか？":
    "Delete \"{label}\"?",
  "追加した{names}用のスタイル（{used}個の要素）が削除されます。":
    "Styles for the added {names} ({used} elements) will be deleted.",
  "「{name}」":
    "\"{name}\"",
  "ブレークポイントを既定に戻しますか？":
    "Reset breakpoints to the defaults?",
  "既定に戻す":
    "Reset to defaults",
  "ブレークポイント":
    "Breakpoints",
  "画面幅ごとにスタイルを変えるための区切りです。それぞれのスタイルは、その幅以下の画面に効きます（小さい幅のほうが優先）。\n「パソコン」はキャンバスで表示するときの幅です。名前の変更や、追加・削除もできます。":
    "Breakpoints let you change styles by screen width. Each one applies to screens at or below its width (smaller ones take priority).\n\"Desktop\" is the width shown on the canvas. You can rename, add and remove breakpoints.",
  "キャンバスで表示する幅":
    "Width shown on the canvas",
  "幅":
    "Width",
  "ブレークポイントの名前":
    "Breakpoint name",
  "{maxWidth}px以下の画面に効きます":
    "Applies to screens up to {maxWidth}px wide",
  "{label}を削除":
    "Delete {label}",
  "{MAX_BREAKPOINTS}個まで追加できます":
    "You can add up to {MAX_BREAKPOINTS}",
  "エディタで保存したバックアップファイルか確認してください。":
    "Make sure it's a backup file saved from this editor.",
  "このファイルは読み込めませんでした":
    "Couldn't load this file",
  "ページや要素の情報が見つかりません。エディタで保存したバックアップファイルを選んでください。":
    "No page or element data found. Choose a backup file saved from this editor.",
  "編集データの形式ではありません":
    "Not an editor data file",
  "バックアップを読み込みますか？":
    "Load the backup?",
  "読み込む":
    "Load",
  "サイト名":
    "Site name",
  "ブラウザのタブの名前が「ページ名 | サイト名」の形になります。":
    "Browser tabs show \"Page name | Site name\".",
  "サイトURL":
    "Site URL",
  "公開したサイトのアドレスです（例: https://example.com）。シェア用画像のURLなどに使います。":
    "Your published site's address (e.g. https://example.com). Used for things like share image URLs.",
  "言語":
    "Language",
  "このページの文章の言語です。「サイトと同じ」のときは、サイト設定の言語になります。":
    "The language this page is written in. \"Same as site\" uses the language from the site settings.",
  "サイトと同じ（{lang}）":
    "Same as site ({lang})",
  "ページの文章の言語です。ブラウザの読み上げ・翻訳や検索エンジンが、この言語として扱います。":
    "The language your pages are written in. Screen readers, browser translation and search engines treat the text as this language.",
  "データの更新間隔（秒）":
    "Data refresh interval (seconds)",
  "ファビコン（タブのアイコン）":
    "Favicon (tab icon)",
  "正方形のPNG・SVG・ICOがおすすめです。":
    "A square PNG, SVG or ICO is recommended.",
  "ホーム画面アイコン":
    "Home screen icon",
  "iPhone・iPadで「ホーム画面に追加」したときのアイコンです（apple-touch-icon）。180×180pxのPNGがおすすめです。":
    "The icon used when added to the home screen on iPhone or iPad (apple-touch-icon). A 180×180px PNG is recommended.",
  "デフォルトのシェア用画像（OGP）":
    "Default share image (OGP)",
  "ページで設定していないときに使われます。1200×630pxがおすすめです。":
    "Used when a page doesn't set its own. 1200×630px is recommended.",
  "カスタムコード（全ページ共通）":
    "Custom code (all pages)",
  "head内コード":
    "Head code",
  "全ページの <head> に挿入されます。":
    "Inserted into <head> on every page.",
  "body末尾コード":
    "End of body code",
  "全ページの </body> 直前に挿入されます。":
    "Inserted just before </body> on every page.",
  "バックアップ":
    "Backup",
  "サイト全体の編集データをバックアップファイルとして保存・復元します。公開時にリポジトリへ保存される _tsumu/doc.json も読み込めます。":
    "Save or restore the whole site's data as a backup file. You can also load the _tsumu/doc.json saved to the repository when publishing.",
  "書き出す":
    "Export",
  // components/StylePanel.tsx
  "右クリックでリセット":
    "Right-click to reset",
  "選択":
    "Select",
  "左上":
    "Top left",
  "右上":
    "Top right",
  "中央":
    "Center",
  "背面へ移動":
    "Send backward",
  "重なり順（z-index）":
    "Stacking order (z-index)",
  "前面へ移動":
    "Bring forward",
  "位置":
    "Position",
  "カスタム":
    "Custom",
  "追従":
    "Sticky",
  "横の基準点":
    "Horizontal anchor",
  "左から":
    "From left",
  "右から":
    "From right",
  "縦の基準点":
    "Vertical anchor",
  "上から":
    "From top",
  "下から":
    "From bottom",
  "基準にする要素":
    "Relative to",
  "親要素":
    "Parent element",
  "画面全体":
    "Viewport",
  "上端から":
    "From the top edge",
  "回転":
    "Rotation",
  "重なり順":
    "Stacking order",
  "残り":
    "Fill",
  "親の残りを埋めています（数値を入れると固定されます）":
    "Filling the parent's remaining space (enter a number to fix the size)",
  "残りを埋める":
    "Fill remaining space",
  "残りを埋めています（押すと解除）":
    "Filling remaining space (click to turn off)",
  "親の残りの幅をすべて使う":
    "Use all of the parent's remaining width",
  "親の残りの高さをすべて使う":
    "Use all of the parent's remaining height",
  "レイアウト":
    "Layout",
  "フロー":
    "Flow",
  "自動（block）":
    "Auto (block)",
  "垂直フロー（flex column）":
    "Vertical (flex column)",
  "水平フロー（flex row）":
    "Horizontal (flex row)",
  "サイズ":
    "Size",
  "最小・最大サイズと縦横比":
    "Min/max size and aspect ratio",
  "最小幅":
    "Min width",
  "最大幅":
    "Max width",
  "最小高さ":
    "Min height",
  "最大高さ":
    "Max height",
  "縦横比":
    "Aspect ratio",
  "例: 16 / 9":
    "e.g. 16 / 9",
  "配置":
    "Alignment",
  "間隔":
    "Gap",
  "自動（両端に寄せて均等に配置）":
    "Auto (space evenly between the ends)",
  "列":
    "Columns",
  "行":
    "Rows",
  "セル内の横揃え":
    "Horizontal align in cell",
  "伸ばす":
    "Stretch",
  "セル内の縦揃え":
    "Vertical align in cell",
  "はみ出し":
    "Overflow",
  "列の間隔（横）":
    "Column gap",
  "行の間隔（縦）":
    "Row gap",
  "1:1（正方形）":
    "1:1 (square)",
  "16:9（横長）":
    "16:9 (landscape)",
  "3:4（縦長）":
    "3:4 (portrait)",
  "2:3（縦長）":
    "2:3 (portrait)",
  "元の比率":
    "Original ratio",
  "{value}（カスタム）":
    "{value} (custom)",
  "切り抜き方":
    "Fit",
  "はみ出した部分を切り取って、枠いっぱいに表示します（写真向け）":
    "Crops the overflow to fill the frame (good for photos)",
  "画像全体が枠に収まるように表示します（ロゴ向け）":
    "Fits the whole image inside the frame (good for logos)",
  "枠に合わせて縦横を引き伸ばします":
    "Stretches the image to the frame's shape",
  "見せる位置":
    "Focal point",
  "混在":
    "Mixed",
  "左右":
    "Left & right",
  "上下":
    "Top & bottom",
  "4方向を個別に設定":
    "Set each side",
  "まとめて設定に戻す":
    "Set all sides together",
  "余白":
    "Spacing",
  "外見":
    "Appearance",
  "不透明度":
    "Opacity",
  "角の丸み":
    "Corner radius",
  "4隅を個別に設定":
    "Set each corner",
  "カーソル":
    "Cursor",
  "default（矢印）":
    "default (arrow)",
  "pointer（指）":
    "pointer (hand)",
  "text（文字）":
    "text",
  "move（移動）":
    "move",
  "grab（つかむ）":
    "grab",
  "grabbing（つかんでいる）":
    "grabbing",
  "crosshair（十字）":
    "crosshair",
  "zoom-in（拡大）":
    "zoom-in",
  "zoom-out（縮小）":
    "zoom-out",
  "help（ヘルプ）":
    "help",
  "wait（待機）":
    "wait",
  "copy（コピー）":
    "copy",
  "not-allowed（禁止）":
    "not-allowed",
  "none（非表示）":
    "none (hidden)",
  "選択したときの背景色":
    "Selection background",
  "テキストをドラッグして選択したときのハイライト色です。":
    "The highlight color when text is selected by dragging.",
  "選択したときの文字色":
    "Selection text color",
  "文字を選択できないようにする":
    "Prevent text selection",
  "Google Fontsに見つかりませんでした。fonts.google.com の表記どおりに入力してください":
    "Not found on Google Fonts. Enter the name exactly as shown on fonts.google.com",
  "確認できませんでした。ネットワークを確認してください":
    "Couldn't check. Check your network connection",
  "継承（{inheritedValue}）":
    "Inherited ({inheritedValue})",
  "Google Fontsから追加":
    "Add from Google Fonts",
  "fonts.google.com の名前（例: Shippori Mincho）":
    "Name on fonts.google.com (e.g. Playfair Display)",
  "確認中…":
    "Checking…",
  "テキスト":
    "Text",
  "見出しレベル":
    "Heading level",
  "見出し 1":
    "Heading 1",
  "見出し 2":
    "Heading 2",
  "見出し 3":
    "Heading 3",
  "見出し 4":
    "Heading 4",
  "見出し 5":
    "Heading 5",
  "見出し 6":
    "Heading 6",
  "フォント":
    "Font",
  "太さ":
    "Weight",
  "継承（{inheritedFontWeight}）":
    "Inherited ({inheritedFontWeight})",
  "細い 300":
    "Light 300",
  "標準 400":
    "Regular 400",
  "中 500":
    "Medium 500",
  "やや太い 600":
    "Semibold 600",
  "太い 700":
    "Bold 700",
  "極太 900":
    "Black 900",
  "行間":
    "Line height",
  "字間":
    "Letter spacing",
  "色":
    "Color",
  "訪問済みの色":
    "Visited color",
  "一度開いたことのあるリンクの文字色です。リンクの中の要素にも設定できます。":
    "The text color of links that have already been opened. You can also set it on elements inside a link.",
  "プレースホルダーの色":
    "Placeholder color",
  "入力欄が空のときに出る案内文の色です。ボックスやフォームに設定すると、中にある入力欄すべてに効きます。":
    "The color of the hint text shown in empty fields. Set it on a box or form to apply it to every field inside.",
  "揃え":
    "Align",
  "左揃え":
    "Align left",
  "中央揃え":
    "Align center",
  "右揃え":
    "Align right",
  "装飾":
    "Decoration",
  "斜体":
    "Italic",
  "下線":
    "Underline",
  "打ち消し線":
    "Strikethrough",
  "変換":
    "Transform",
  "大文字":
    "Uppercase",
  "小文字":
    "Lowercase",
  "頭文字を大文字":
    "Capitalize",
  "折り返し":
    "Wrapping",
  "する":
    "Wrap",
  "省略":
    "Truncate",
  "省略までの行数":
    "Lines before truncating",
  "背景":
    "Background",
  "グラデーション":
    "Gradient",
  "角度":
    "Angle",
  "開始色":
    "Start color",
  "終了色":
    "End color",
  "カバー":
    "Cover",
  "幅に合わせる":
    "Fit width",
  "くり返す":
    "Repeat",
  "実線":
    "Solid",
  "破線":
    "Dashed",
  "点線":
    "Dotted",
  "二重線":
    "Double",
  "溝（立体）":
    "Groove",
  "畝（立体）":
    "Ridge",
  "くぼみ（立体）":
    "Inset",
  "浮き出し（立体）":
    "Outset",
  "線":
    "Border",
  "テキストシャドウ":
    "Text shadow",
  "内側シャドウ":
    "Inner shadow",
  "ドロップシャドウ":
    "Drop shadow",
  "外側にする":
    "Make outer",
  "内側にする":
    "Make inner",
  "ぼかし":
    "Blur",
  "広がり":
    "Spread",
  "明るさ":
    "Brightness",
  "コントラスト":
    "Contrast",
  "彩度":
    "Saturation",
  "グレースケール":
    "Grayscale",
  "セピア":
    "Sepia",
  "色相回転":
    "Hue rotate",
  "乗算":
    "Multiply",
  "スクリーン":
    "Screen",
  "オーバーレイ":
    "Overlay",
  "比較（暗）":
    "Darken",
  "比較（明）":
    "Lighten",
  "差の絶対値":
    "Difference",
  "除外":
    "Exclusion",
  "輝度":
    "Luminosity",
  "エフェクト":
    "Effects",
  "エフェクトを追加":
    "Add effect",
  "要素の形に沿って影を付けます":
    "Adds a shadow around the element's shape",
  "文字の形に沿って影を付けます":
    "Adds a shadow along the letter shapes",
  "背景ぼかし":
    "Background blur",
  "ブレンドモード":
    "Blend mode",
  "後ろにある要素（背景色・画像など）と色を混ぜ合わせます。":
    "Blends colors with what's behind the element (background colors, images and so on).",
  "モーション":
    "Motion",
  "モーションを追加":
    "Add motion",
  "スタイルの変化をなめらかにします。パネル上部の「状態」を切り替えて、変化したあとのスタイルを設定してください。":
    "Smooths out style changes. Switch the State at the top of the panel to set the style to change to.",
  "スクロールして要素が画面に入ったときに1回再生されます（キャンバスではすぐに再生されます）。":
    "Plays once when the element scrolls into view (plays immediately on the canvas).",
  "どのスタイルが変わったとき？":
    "Which style changes?",
  "動き":
    "Animation",
  "カスタム…":
    "Custom…",
  "カスタムキーフレーム":
    "Custom keyframes",
  "@keyframes の中身（from / to / 0%〜100%）をそのまま書きます。":
    "Write the contents of @keyframes (from / to / 0%–100%) directly.",
  "時間":
    "Duration",
  "遅延":
    "Delay",
  "動きの緩急":
    "Easing",
  "くり返す回数":
    "Repeat count",
  "向き":
    "Direction",
  "再生前後のスタイル":
    "Fill mode",
  "右上の + からモーションを追加できます。":
    "Add motion with + at the top right.",
  "カスタムCSS":
    "Custom CSS",
  "この要素に常に適用されるCSSを書けます。":
    "Write CSS that always applies to this element.",
  "表示するデバイス":
    "Show on devices",
  "{label}: 表示（クリックで非表示）":
    "{label}: shown (click to hide)",
  "{label}: 非表示（クリックで表示）":
    "{label}: hidden (click to show)",
  "{label}では非表示のため、キャンバスには表示されません":
    "Hidden on {label}, so it isn't shown on the canvas",
  "全デバイス共通":
    "All devices",
  "{label}用":
    "For {label}",
  "body（{name}）":
    "body ({name})",
  "選んだ部分だけのスタイルを変えるには、その部分を別のテキストとして分割します。分割しますか？\n（分割しない場合は、テキスト全体に適用します）":
    "To style only the selected part, it needs to be split into a separate text element. Split it?\n(If not, the style applies to the whole text.)",
  "選んだ部分だけに適用":
    "Apply to selection only",
  "分割して適用":
    "Split and apply",
  "全体に適用":
    "Apply to all",
  "状態":
    "State",
  // components/VarExplorer.tsx
  "見本なし":
    "No sample",
  "数値":
    "Number",
  "はい／いいえ":
    "Yes/No",
  "中を開く":
    "Expand",
  "スクリプトで作る変数（サイトを動かしたときに値が決まる）":
    "Variables set by scripts (their values are set at runtime)",
  "動かしたときに値が入ります":
    "Set when the script runs",
  "変数を探す":
    "Browse variables",
  "変数名・値で検索":
    "Search by name or value",
  "この要素の位置で使える変数がありません。スクリプトの「ページを開いたとき」でデータを取得すると、ここに表示されます。":
    "No variables are available here. Fetch data in the page's \"When the page opens\" script and it will appear here.",
  "「{q}」に一致する変数はありません":
    "No variables match \"{q}\"",
  "クリックで挿入します。まとまりは左の矢印で中の項目を開けます。":
    "Click to insert. Use the arrow on the left to expand groups.",
  // components/controls.tsx
  "{p1}の使い方":
    "How to use {p1}",
  "使い方を見る":
    "How to use",
  "{stateLabel}用に変更済み（右クリックで解除すると、通常時の設定に戻ります）":
    "Changed for {stateLabel} (right-click to clear and use the default setting)",
  "{bpLabel}用に変更済み（右クリックで解除すると、大きい画面の設定に戻ります）":
    "Changed for {bpLabel} (right-click to clear and use the larger screen's setting)",
  "クリックで単位を切り替え（見た目の大きさはそのまま）":
    "Click to switch units (keeps the same visual size)",
  "クリックで単位を切り替え":
    "Click to switch units",
  "未設定":
    "Not set",
  "変数の候補":
    "Variable suggestions",
  "「{partial}」に一致する変数はありません":
    "No variables match \"{partial}\"",
  "この位置で使える変数はありません":
    "No variables are available here",
  "変数を探す…":
    "Browse variables…",
  "値を見ながら選ぶ":
    "Pick while viewing values",
  "挿入":
    "Insert",
  "一覧":
    "List",
  "カラーパレット":
    "Color palette",
  "現在の色を登録":
    "Save current color",
  "登録色を削除":
    "Remove saved color",
  "{c}を削除":
    "Remove {c}",
  "＋で現在の色を登録できます":
    "Press + to save the current color",
  "最近使った色":
    "Recent colors",
  "上中央":
    "Top center",
  "左中央":
    "Middle left",
  "右中央":
    "Middle right",
  "左下":
    "Bottom left",
  "下中央":
    "Bottom center",
  "右下":
    "Bottom right",
  "{pos}に揃える（もう一度押すと解除）":
    "Align {pos} (press again to clear)",
  "{pos}に揃える":
    "Align {pos}",
  // lib/assets.ts
  "画像を読み込めませんでした":
    "Couldn't load the image",
  "ファイルを読み込めませんでした":
    "Couldn't read the file",
  "追加できるのは画像・動画・音声のファイルだけです":
    "Only image, video and audio files can be added",
  "アップロードできませんでした（{status}）":
    "Couldn't upload ({status})",
  "サーバーに保存できないため追加できません。このブラウザに保存できるのは1ファイル2MBまでです。":
    "Can't add it because server storage isn't available. Files saved in this browser are limited to 2MB each.",
  // lib/breakpoints.ts
  "画面幅{n}":
    "Width {n}",
  // lib/clipboard.ts
  "SVGデータを読み取れませんでした":
    "Couldn't read the SVG data",
  "SVGデータが壊れています":
    "The SVG data is corrupted",
  "SVGではありません":
    "Not an SVG",
  // lib/data.ts
  "リストの項目（1件ずつ変わる）":
    "List item (changes for each item)",
  "取得したデータ・変数":
    "Fetched data and variables",
  "ページURLの [slug] の部分":
    "The [slug] part of the page URL",
  "ページのURL":
    "Page URL",
  "入力欄に入力された値":
    "The value entered in the field",
  "ID付きの要素":
    "Elements with an ID",
  "{length}件のリスト":
    "A list of {length} items",
  "項目のまとまり":
    "A group of fields",
  "入力欄の値":
    "Field value",
  // lib/elements.ts
  "基本":
    "Basic",
  "見出し":
    "Heading",
  "区切り線":
    "Divider",
  "フォーム":
    "Form",
  "インプット":
    "Input",
  "テキストエリア":
    "Text area",
  "選択肢":
    "Select",
  "チェック":
    "Checkbox",
  "ラジオ":
    "Radio",
  "ファイル":
    "File",
  "送信ボタン":
    "Submit button",
  "メディア・埋め込み":
    "Media & embeds",
  "マップ":
    "Map",
  "コード":
    "Code",
  // lib/exportZip.ts
  "アセットを読み込めませんでした（{status}）: {path}":
    "Couldn't load asset ({status}): {path}",
  // lib/generator.ts
  "URL「/{route}{p2}」が「{name}」と「{name2}」で重複しています（クエリを変えてください）":
    "The URL \"/{route}{p2}\" is used by both \"{name}\" and \"{name2}\" (change the query)",
  "URL「/{route}」が「{name}」と「{name2}」で重複しています":
    "The URL \"/{route}\" is used by both \"{name}\" and \"{name2}\"",
  "「{name}」のURL: {slugErr}":
    "URL of \"{name}\": {slugErr}",
  "公開できるページがありません（すべて非公開になっています）":
    "No pages to publish (all pages are unpublished)",
  "トップページ（URLが空のページ）が非公開になっています":
    "The home page (the page with an empty URL) is unpublished",
  "シェア用画像を正しく出すため、サイト設定でサイトURLを設定してください":
    "Set the site URL in Site settings so share images work correctly",
  "ファビコン":
    "The favicon",
  "デフォルトのOGP画像":
    "The default share image",
  "「{name}」のOGP画像":
    "The share image of \"{name}\"",
  "{label}が存在しないアセットを参照しています":
    "{label} refers to an asset that doesn't exist",
  "リダイレクトページ「{name}」に転送先または表示する外部サイトが設定されていません":
    "Redirect page \"{name}\" has no redirect target or external site set",
  "リダイレクトページ「{name}」の301転送先は / から始まるサイト内URLか http(s) URLにしてください":
    "The 301 target of redirect page \"{name}\" must be a site URL starting with / or an http(s) URL",
  "リダイレクトページ「{name}」の表示する外部サイトは http(s):// から始まるURLにしてください":
    "The external site of redirect page \"{name}\" must be a URL starting with http(s)://",
  "「{name}」のスクリプトで、配列の要素を探す項目が選ばれていません":
    "A script on \"{name}\" doesn't choose the field to search the array by",
  "「{name}」のスクリプトで、配列の要素に格納する項目名が空です":
    "A script on \"{name}\" stores into array items with an empty field name",
  "「{name}」のスクリプトで、データを取得するURLが空です":
    "A script on \"{name}\" fetches data from an empty URL",
  "「{name}」の「{name2}」のスクリプトで開くページが選択されていないか、削除されています":
    "A script on \"{name2}\" in \"{name}\" opens a page that isn't selected or was deleted",
  "「{name}」の「{name2}」のリンク先ページが削除されています（トップページへのリンクになります）":
    "The link target of \"{name2}\" in \"{name}\" was deleted (it will link to the home page)",
  "「{name}」の「{name2}」のリンク先「{name3}」が非公開です（404になります）":
    "\"{name2}\" in \"{name}\" links to \"{name3}\", which is unpublished (it will be a 404)",
  "「{name}」のリスト「{name2}」に並べる配列が選ばれていません（出力されません）":
    "List \"{name2}\" in \"{name}\" has no array selected (it won't be output)",
  "「{name}」の画像「{name2}」に代替テキスト（alt）が設定されていません":
    "Image \"{name2}\" in \"{name}\" has no alt text",
  "「{name}」のフォーム部品「{name2}」にID属性がありません（値が送信されず {変数} としても使えません）":
    "Form field \"{name2}\" in \"{name}\" has no ID attribute (its value won't be submitted or usable as a {variable})",
  "「{name}」の「{name2}」のスクリプトに対象が選択されていないブロックがあります":
    "A script on \"{name2}\" in \"{name}\" has a block with no target selected",
  "「{name}」の「{name2}」のスクリプトの対象ID「{targetId}」がこのページに見つかりません":
    "The target ID \"{targetId}\" in the script on \"{name2}\" in \"{name}\" isn't on this page",
  "「{name}」でID「{aid}」が{n}個の要素に重複しています（{変数}やアンカーが正しく動きません）":
    "The ID \"{aid}\" is used by {n} elements in \"{name}\" (variables and anchors won't work correctly)",
  "[slug]ページ「{name}」のID「slug」はページ変数 {slug} と重複しています（別のIDにしてください）":
    "The ID \"slug\" in [slug] page \"{name}\" conflicts with the page variable {slug} (use a different ID)",
  "[slug]ページ「{name}」でデータを取得していません（ページを開いたときのスクリプトで、{slug} を使って1件のデータを取得してください）":
    "[slug] page \"{name}\" doesn't fetch any data (in its \"When the page opens\" script, fetch one item using {slug})",
  "「{name}」に見出し1（h1）がありません":
    "\"{name}\" has no Heading 1 (h1)",
  "{first}ほか{n}件":
    "{first} and {n} more",
  "「{name}」のスマホ表示で、12px未満の読みにくい文字があります（{p2}）":
    "\"{name}\" has text smaller than 12px on phones, which is hard to read ({p2})",
  "「{name}」の{p2}は幅が{width}pxで固定されていて、スマホ（幅{PHONE_WIDTH}px前後）の画面からはみ出します（幅を%にするか、最大幅を付けてください）":
    "{p2} in \"{name}\" has a fixed width of {width}px and overflows phone screens (about {PHONE_WIDTH}px wide). Use a % width or add a max width",
  "「{name}」に見出し1が{h1}つあります（ページの題名だけを見出し1にします）":
    "\"{name}\" has {h1} Heading 1s (use Heading 1 only for the page title)",
  "「{name}」で見出し{p2}の次が見出し{p3}になっています（見出しの段は1つずつ下げます）":
    "In \"{name}\", Heading {p2} is followed by Heading {p3} (go down one level at a time)",
  "「{name}」のリンクの文字が「{text}」です（ほか{n}件）。行き先が分かる言葉にしてください":
    "A link in \"{name}\" says \"{text}\" (and {n} more). Use words that describe where it goes",
  "「{name}」のリンクの文字が「{text}」です。行き先が分かる言葉にしてください":
    "A link in \"{name}\" says \"{text}\". Use words that describe where it goes",
  "コンポーネント「{name}」が自分自身を含んでいます（無限に入れ子になります）。マスターから自分自身のインスタンスを取り除いてください":
    "Component \"{name}\" contains itself (it would nest forever). Remove its own instance from the main component",
  // lib/motion.ts
  "ホバーしたときに再生":
    "Play on hover",
  "押したときに再生":
    "Play on press",
  "すべて（all）":
    "All (all)",
  "変形":
    "Transform",
  "線の色":
    "Border color",
  "フェードイン":
    "Fade in",
  "フェードアウト":
    "Fade out",
  "下からフェード":
    "Fade up",
  "上からフェード":
    "Fade down",
  "左からスライド":
    "Slide from left",
  "右からスライド":
    "Slide from right",
  "下からスライド":
    "Slide up",
  "上からスライド":
    "Slide down",
  "パルス":
    "Pulse",
  "バウンス":
    "Bounce",
  "シェイク":
    "Shake",
  "フリップ":
    "Flip",
  "スイング":
    "Swing",
  "ウォブル":
    "Wobble",
  "ズームイン":
    "Zoom in",
  "ズームアウト":
    "Zoom out",
  "逆再生":
    "Reverse",
  "交互":
    "Alternate",
  "両方を保持":
    "Both",
  "最後を保持":
    "Keep end state",
  "最初を保持":
    "Keep start state",
  "保持しない":
    "None",
  // lib/presets.ts
  "検索フォーム":
    "Search form",
  "チェックボックス":
    "Checkbox",
  "ご自由にお書きください":
    "Write anything you like",
  "選択肢A":
    "Option A",
  "選択肢B":
    "Option B",
  "同意する":
    "I agree",
  "ラジオボタン":
    "Radio button",
  "ファイル選択":
    "File picker",
  "<p>ここにHTMLを書きます</p>":
    "<p>Write your HTML here</p>",
  "ブログ":
    "Blog",
  "ナビリンク":
    "Nav links",
  "メニュー開閉":
    "Menu toggle",
  "ナビバー":
    "Navbar",
  "見出しをここに、\n2行で入れられます。":
    "Your headline here,\nacross two lines.",
  "サイトの紹介文を入れます。何ができるのか、誰のためのものかを短く伝えましょう。":
    "A short introduction to your site. Say what it does and who it's for.",
  "はじめる":
    "Get started",
  "カード {i}":
    "Card {i}",
  "説明文をここに入力します。":
    "Add a description here.",
  "カードグリッド":
    "Card grid",
  "商品画像":
    "Product image",
  "{商品.thumbnail}":
    "{product.thumbnail}",
  "商品名":
    "Product name",
  "{商品.brand}":
    "{product.brand}",
  "ブランド":
    "Brand",
  "{商品.description}":
    "{product.description}",
  "¥{商品.price}":
    "${product.price}",
  "価格":
    "Price",
  "商品情報":
    "Product info",
  "詳細レイアウト":
    "Detail layout",
  "商品詳細（デモ）":
    "Product detail (demo)",
  "商品詳細":
    "Product detail",
  "{データ}":
    "{data}",
  "商品カタログ":
    "Product catalog",
  "dummyjson.com のデータで動く一覧・検索・詳細ページのサンプルです。":
    "A sample list, search and detail page powered by data from dummyjson.com.",
  "商品を検索…":
    "Search products…",
  "商品サムネイル":
    "Product thumbnail",
  "商品カード":
    "Product card",
  "商品リスト":
    "Product list",
  "商品一覧":
    "Products",
  "商品一覧セクション":
    "Product list section",
  "商品一覧（デモ）":
    "Products (demo)",
  "dummyjson.comのデータで動くサンプルページ":
    "A sample page powered by dummyjson.com data",
  "{データ.products}":
    "{data.products}",
  "404見出し":
    "404 heading",
  "お探しのページは見つかりませんでした。":
    "We couldn't find the page you're looking for.",
  "ホームへ戻る":
    "Back to home",
  "404セクション":
    "404 section",
  "404（見つからないとき）":
    "404 (not found)",
  "ページが見つかりません":
    "Page not found",
  // lib/script.ts
  "ホバーし始めたとき":
    "When hover starts",
  "ホバーが外れたとき":
    "When hover ends",
  "この要素":
    "this element",
  "（未選択）":
    "(not selected)",
  "「{value}」":
    "\"{value}\"",
  "{subject}が {v} と違う":
    "{subject} does not equal {v}",
  "{subject}が {v} を含む":
    "{subject} contains {v}",
  "{subject}が {v} を含まない":
    "{subject} does not contain {v}",
  "{subject}が {v} で始まる":
    "{subject} starts with {v}",
  "{subject}が {v} で終わる":
    "{subject} ends with {v}",
  "{subject}が {v} より大きい":
    "{subject} is greater than {v}",
  "{subject}が {v} より小さい":
    "{subject} is less than {v}",
  "{subject}が空":
    "{subject} is empty",
  "{subject}が空でない":
    "{subject} is not empty",
  "{subject}が {v} と同じ":
    "{subject} equals {v}",
  "{t} の値":
    "value of {t}",
  "{t} がチェックされていない":
    "{t} is not checked",
  "{t} がチェックされている":
    "{t} is checked",
  "{t} が隠れている":
    "{t} is hidden",
  "{t} が表示されている":
    "{t} is visible",
  "{t} にホバーしていない":
    "{t} is not hovered",
  "{t} にホバーしている":
    "{t} is hovered",
  "{p1} を表示する":
    "Show {p1}",
  "{p1} を隠す":
    "Hide {p1}",
  "{p1} の表示を切り替える":
    "Toggle visibility of {p1}",
  "ページ「{p1}」を開く":
    "Open page \"{p1}\"",
  "未選択":
    "not selected",
  "{p1} を開く":
    "Open {p1}",
  "URL未入力":
    "no URL",
  "{p1} までスクロールする":
    "Scroll to {p1}",
  "{p1} に「{value}」を入れる":
    "Set {p1} to \"{value}\"",
  " かつ ":
    " and ",
  " または ":
    " or ",
  "（項目未選択）":
    "(no field)",
  "絞り込み{no}: ":
    "Filter {no}: ",
  "（ほかの絞り込みと「または」）":
    "(OR with other filters) ",
  "{head}配列{p2}を {conds} ものに絞り込む":
    "{head}Filter array {p2} to items where {conds}",
  "配列{p1}の絞り込み{no}を解除する":
    "Clear filter {no} on array {p1}",
  "配列{p1}のすべての絞り込みを解除する":
    "Clear all filters on array {p1}",
  "配列{array}を {field} の大きい順に並べ替える":
    "Sort array {array} by {field}, descending",
  "配列{array}を {field} の小さい順に並べ替える":
    "Sort array {array} by {field}, ascending",
  "共有ストレージの「{key}」に「{value}」を保存する":
    "Save \"{value}\" to shared storage key \"{key}\"",
  "キー未入力":
    "no key",
  "ストレージの「{key}」に「{value}」を保存する":
    "Save \"{value}\" to storage key \"{key}\"",
  "共有ストレージの「{key}」を読み込んで変数 {{into}} とする":
    "Load shared storage key \"{key}\" into variable {{into}}",
  "ストレージの「{key}」を読み込んで変数 {{into}} とする":
    "Load storage key \"{key}\" into variable {{into}}",
  "「{source}」を「{p2}」で分解して配列{p3}とする":
    "Split \"{source}\" by \"{p2}\" into array {p3}",
  "配列{p1}の要素のうち、{p2} が「{value}」のものを変数 {{p4}} とする":
    "Find the item in array {p1} whose {p2} is \"{value}\" and store it in {{p4}}",
  "配列{p1}の「{value}」を項目 {p3} として格納する":
    "Store \"{value}\" as field {p3} in each item of array {p1}",
  "（項目名未入力）":
    "(no field name)",
  "配列{p1}の件数を変数 {{p2}} とする":
    "Store the count of array {p1} in variable {{p2}}",
  "「{value}」をコピーする":
    "Copy \"{value}\"",
  "「{value}」を変数 {{p2}} とする":
    "Set variable {{p2}} to \"{value}\"",
  "変数 {{into}}（「{sep}」区切り）から「{value}」を取り除く":
    "Remove \"{value}\" from variable {{into}} (separated by \"{sep}\")",
  "変数 {{into}}（「{sep}」区切り）に「{value}」を足す":
    "Add \"{value}\" to variable {{into}} (separated by \"{sep}\")",
  "変数 {{into}}（「{sep}」区切り）で「{value}」を切り替える":
    "Toggle \"{value}\" in variable {{into}} (separated by \"{sep}\")",
  "{times}回くり返す…":
    "Repeat {times} times…",
  "ずっとくり返す…":
    "Repeat forever…",
  "配列{p1}の要素ごとにくり返す…":
    "For each item in array {p1}…",
  "配列{array}の {field} を「{sep}」でつないで変数 {{into}} とする":
    "Join {field} of array {array} with \"{sep}\" into variable {{into}}",
  "配列{array}を「{sep}」でつないで変数 {{into}} とする":
    "Join array {array} with \"{sep}\" into variable {{into}}",
  "{p1} のデータを取得して「{p2}」とする":
    "Fetch data from {p1} as \"{p2}\"",
  "「{expr}」を計算して変数 {{p2}} とする":
    "Calculate \"{expr}\" into variable {{p2}}",
  "「{source}」の正規表現「{find}」を「{to}」に置き換えて変数 {{into}} とする":
    "Replace regex \"{find}\" with \"{to}\" in \"{source}\" into variable {{into}}",
  "「{source}」の「{find}」を「{to}」に置き換えて変数 {{into}} とする":
    "Replace \"{find}\" with \"{to}\" in \"{source}\" into variable {{into}}",
  "もし {p1} なら…":
    "If {p1}…",
  "［{name}］":
    "［{name}］",
  // lib/store.ts
  "{name}リスト":
    "{name} list",
  "コンポーネント「{p1}」の中に、そのコンポーネント自身は入れられません（無限に入れ子になるため）。":
    "You can't put component \"{p1}\" inside itself (it would nest forever).",
  "ここには貼り付けられません":
    "Can't paste here",
  "ページ {n}":
    "Page {n}",
  "フォルダ {n}":
    "Folder {n}",
  "{name} のコピー {n}":
    "{name} copy {n}",
  "{name} のコピー":
    "{name} copy",
  // lib/style.ts
  "すべての画面に反映されます":
    "Changes apply to all screen sizes",
  "画面幅{maxWidth}px以下（{p2}を含む）に反映されます":
    "Changes apply to screens up to {maxWidth}px wide (including {p2})",
  "画面幅{maxWidth}px以下だけに反映されます":
    "Changes apply only to screens up to {maxWidth}px wide",
  "フォーカス":
    "Focus",
  "表示する":
    "Show",
  "非表示にする":
    "Hide",
  "{name}で表示する":
    "show on {name}",
  "{name}で非表示にする":
    "hide on {name}",
  "システム":
    "System",
  // lib/tags.ts
  "中身から自動で判定します":
    "Chosen automatically from the content",
  "中のフォーム部品の値をURLに付けて送信します":
    "Sends the values of its form fields in the URL",
  "ページの中のひとまとまりの区画です":
    "A distinct section of the page",
  "ページ上部の、ロゴやナビゲーションを置く部分です":
    "The top of the page, with the logo and navigation",
  "主要なリンクのまとまりです":
    "A group of main links",
  "ページの主な内容です（1ページに1つ）":
    "The page's main content (one per page)",
  "それだけで完結する記事や投稿です":
    "A self-contained article or post",
  "ページ下部の補足情報です":
    "Supplementary info at the bottom of the page",
  "汎用ボックス":
    "Generic box",
  "意味を持たない、レイアウト用の箱です":
    "A plain box for layout, with no meaning",
  "インラインテキスト":
    "Inline text",
  "テキストの一部です（行内の span として出力）":
    "Part of a text (output as an inline span)",
  // lib/vars.ts
  "「{p1}」は使えません。変数部分は [slug] とだけ書いてください":
    "\"{p1}\" can't be used. Write the variable part as just [slug]",
  "[slug] は1つだけ使えます":
    "Only one [slug] is allowed",
  // (other)
  "保存できませんでした":
    "Couldn't save",
  "字":
    "A",
  "はみ出し\u0004表示":
    "Visible",
  "はみ出し\u0004隠す":
    "Hidden",
  "行間\u0004行":
    "LH",
  "字間\u0004字":
    "LS",
  "スマホ横向き":
    "Phone (landscape)",
  "変数名\u0004データ":
    "data",
  "変数名\u0004商品":
    "product",
  "変数名\u0004商品一覧":
    "products",
  "ブロックの分類\u0004表示":
    "Looks",
  // 公開履歴・AI・ページの複数選択など
  "ページが大きすぎるため、AIに送れません":
    "This page is too large to send to AI",
  "この依頼には対応できませんでした。":
    "I couldn't help with this request.",
  "AIの利用が混み合っています。少し待ってからお試しください":
    "AI is busy right now. Please try again in a moment",
  "変更しました。":
    "Done.",
  "変更はありませんでした。":
    "Nothing was changed.",
  "AIに問い合わせできませんでした（{status}）":
    "Couldn't reach AI ({status})",
  "AIに問い合わせできませんでした":
    "Couldn't reach AI",
  "選んでいる要素を中央にそろえて":
    "Center the selected element",
  "このページの上に、見出しと説明とボタンのあるヒーローセクションを作って":
    "Add a hero section with a heading, a description and a button at the top of this page",
  "スマホでは文字を少し小さく、余白を詰めて":
    "On phones, make the text a bit smaller and tighten the spacing",
  "ボタンにホバーしたとき少し暗くなるようにして":
    "Make the buttons slightly darker on hover",
  "会話を消す":
    "Clear conversation",
  "会話を消す（編集内容はそのまま）":
    "Clear conversation (your edits stay)",
  "やりたいことを文章で頼むと、AIがページを編集します。結果は「元に戻す」（⌘Z）でいつでも取り消せます。":
    "Describe what you want and AI edits the page. You can always undo the result with Undo (⌘Z).",
  "取り消しました":
    "Undone",
  "{n}件の変更を適用":
    "Applied {n} changes",
  "編集しています…":
    "Editing…",
  "「これ」「選んでいる要素」はこの要素を指します":
    "\"This\" and \"the selected element\" refer to this element",
  "選択中: {name}":
    "Selected: {name}",
  "例: 見出しをもっと大きく、太くして":
    "e.g. Make the heading bigger and bolder",
  "送信（Enter）":
    "Send (Enter)",
  "AIに頼む":
    "Ask AI",
  "AIに頼んで編集する":
    "Ask AI to edit",
  "バックアップが見つかりません":
    "Backup not found",
  "この版には編集データが含まれていません":
    "This version doesn't include editor data",
  "編集データの取得":
    "Fetching editor data",
  "履歴の取得":
    "Fetching history",
  "指定した版の取得":
    "Fetching the selected version",
  "ほかの公開と重なりました。履歴を読み込み直してから、もう一度お試しください":
    "Another publish happened at the same time. Reload the history and try again",
  "メニュー（書き出し・履歴・設定）":
    "Menu (export, history, settings)",
  "履歴・ロールバック":
    "History & rollback",
  "中へ":
    "Inside",
  "選んだボックスの中の最後に追加します（中に入れられない要素なら後ろ）":
    "Adds to the end of the selected box (or after it, if it can't contain elements)",
  "後ろへ":
    "After",
  "選んだ要素のすぐ後ろに、同じ階層の要素として追加します":
    "Adds right after the selected element, at the same level",
  "ページを0にはできないため、先頭の1ページは残します。ほかのページの要素もすべて削除されます（「元に戻す」で戻せます）。":
    "A site needs at least one page, so the first page is kept. All elements on the other pages are deleted too (Undo brings them back).",
  "{n}ページを削除しますか？":
    "Delete {n} pages?",
  "「{name}」を選ぶ":
    "Select \"{name}\"",
  "選択をやめる":
    "Stop selecting",
  "選択をやめる（Esc）":
    "Stop selecting (Esc)",
  "{n}件を選択":
    "{n} selected",
  "フォルダへ移動":
    "Move to folder",
  "フォルダの外":
    "Outside folders",
  "新しいフォルダ":
    "New folder",
  "公開・非公開":
    "Publish / unpublish",
  "選んだページを削除":
    "Delete selected pages",
  "ページを選ぶ":
    "Select pages",
  "複数のページを選んで、まとめてフォルダへ移動・削除します（⌘クリック・Shiftクリックでも選べます）":
    "Select several pages to move to a folder or delete together (⌘-click and Shift-click work too)",
  "確認用。検索エンジンに載らないように公開します":
    "For checking. Published so that search engines skip it",
  "テストに公開":
    "Publish to test",
  "公開ドメインに反映します":
    "Goes live on your domain",
  "本番に公開":
    "Publish to live",
  "サイトを生成してGitHubリポジトリにコミットします。ホスティング側でビルドが終わると反映されます。":
    "Generates the site and commits it to the GitHub repository. It goes live once your hosting service finishes building.",
  "公開先を確認しています…":
    "Checking publish targets…",
  "公開先が設定されていません":
    "No publishing destination is set up",
  "設定するまでは、メニューの「zipでエクスポート」でサイトを書き出せます。編集内容はこのまま保存されます。":
    "Until then, you can download the site with \"Export as zip\" in the menu. Your edits are still saved.",
  "公開先の設定を読み込めませんでした":
    "Couldn't load the publish settings",
  "公開履歴・ロールバック":
    "Publish history & rollback",
  "サイトを開く":
    "Open site",
  "編集データを読み込めませんでした":
    "Couldn't load editor data",
  "いまの編集内容が「{label}」の内容に置き換わります。サーバーにも保存されますが、「元に戻す」（⌘Z）で今の内容に戻せます。":
    "Your current edits will be replaced with the content from \"{label}\". It's saved to the server too, but Undo (⌘Z) brings back what you have now.",
  "この版の編集内容に戻しますか？":
    "Restore the edits from this version?",
  "この版に戻す":
    "Restore this version",
  "履歴を読み込めませんでした":
    "Couldn't load the history",
  "{site}を {date} に公開した内容に戻します。新しいコミットとして積むので、あとからこの操作も取り消せます。":
    "The {site} returns to what was published on {date}. It's added as a new commit, so you can undo this later too.",
  "公開サイトをこの版に戻しますか？":
    "Return the published site to this version?",
  "ロールバックできませんでした":
    "Couldn't roll back",
  "ホスティング側でビルドが終わると反映されます。":
    "It goes live once your hosting service finishes building.",
  "ロールバックしました":
    "Rolled back",
  "まだ公開されていません。":
    "Not published yet.",
  "公開中":
    "Live",
  "この版で公開した時点の編集内容をエディタに読み込みます":
    "Loads the editor content as it was when this version was published",
  "編集内容を復元":
    "Restore edits",
  "サイトを戻す":
    "Restore site",
  "サーバーは1日に1回、その日最初に保存した時点の内容を自動で残します（曜日ごとに7日分）。":
    "Once a day, the server automatically keeps the content as of that day's first save (seven days, one per weekday).",
  "まだバックアップがありません。":
    "No backups yet.",
  "この内容に戻す":
    "Restore this",
  "履歴":
    "History",
  "公開したサイトを前の版に戻したり、編集内容を以前の状態に戻したりできます。":
    "Return the published site to an earlier version, or bring your edits back to an earlier state.",
  "公開サイト":
    "Published site",
  "編集データの自動バックアップ":
    "Automatic backups of edits",
  "いまの編集内容は、このファイルの内容に置き換わります。「元に戻す」（⌘Z）で今の内容に戻せます。":
    "Your current edits will be replaced with this file's content. Undo (⌘Z) brings back what you have now.",
  "公開先のホスティング":
    "Hosting",
  "書き出すサイトを動かすサービスです。外部のJSONを使うページの作り方が変わります。\n標準: Vercel・Netlify・Node.js など。ページを作り置き、更新間隔ごとに作り直します（ISR）。\nCloudflare Workers: ページはアクセスのたびに描画し、取得したJSONを更新間隔のあいだCloudflareのキャッシュに置きます。":
    "The service that runs the exported site. It changes how pages that use external JSON are built.\nStandard: Vercel, Netlify, Node.js, etc. Pages are prebuilt and rebuilt at the refresh interval (ISR).\nCloudflare Workers: pages are rendered on every request, and fetched JSON is cached at Cloudflare for the refresh interval.",
  "標準（Vercel など）":
    "Standard (Vercel etc.)",
  "外部のJSONを使うページを取得し直す間隔です。その間は作っておいたページ（Cloudflareでは取得済みのJSON）を使うので、サーバーの負荷を抑えられます。0にするとアクセスのたびに取得します（常に最新ですが、負荷は大きくなります）。":
    "How often pages that use external JSON fetch it again. In between, the prebuilt page (on Cloudflare, the fetched JSON) is reused to keep server load down. Set 0 to fetch on every request (always fresh, but heavier).",
  "サーバーの自動バックアップや、公開した版の編集内容に戻します":
    "Restore from the server's automatic backups or from a published version",
  "履歴から戻す":
    "Restore from history",
  "リポジトリの指定が正しくありません（owner/name の形で指定してください）: {repo}":
    "Invalid repository (use the owner/name format): {repo}",
  "テストサイトと本番サイトの公開先（リポジトリ・ブランチ）が同じです。別のブランチを指定してください":
    "The test site and live site point to the same repository and branch. Use a different branch",
  "GitHubに接続できませんでした。管理者に確認してください":
    "Couldn't connect to GitHub. Contact your administrator",
  "{step}に失敗しました（{status}）。公開先リポジトリへの書き込みが許可されていない可能性があります。管理者に確認してください":
    "{step} failed ({status}). Writing to the site repository may not be allowed. Contact your administrator",
  "読み込み中":
    "Loading",
  "AI機能は有効になっていません":
    "AI isn't enabled",
  "AIサービスに接続できませんでした。管理者に確認してください":
    "Couldn't connect to the AI service. Contact your administrator",
  "ホスティングとデータの更新":
    "Hosting & data refresh",
  "書き出したサイトを動かすサービスと、外部のJSONを使うページを取得し直す間隔です。":
    "The service that runs the exported site, and how often pages that use external JSON fetch it again.",
  "ロックを解除して、キャンバス・レイヤーで動かしたり削除したりできるようにします":
    "Unlock so the element can be moved and deleted on the canvas and in Layers again",
  "キャンバス・レイヤーでの移動・リサイズ・削除をできなくします（スタイルは変えられます）":
    "Prevent moving, resizing and deleting on the canvas and in Layers (styles can still be changed)",
  "ロック中":
    "Locked",
  // 複数サイト・ホーム画面
  "サイトの指定が正しくありません":
    "Invalid site",
  "サイトが見つかりません":
    "Site not found",
  "作成できませんでした":
    "Couldn't create it",
  "サイト名を入力してください":
    "Enter a site name",
  "サイト名は100文字までです":
    "Site names can be up to 100 characters",
  "リポジトリは owner/name の形で入力してください":
    "Enter the repository as owner/name",
  "ブランチ名に使えない文字が含まれています":
    "The branch name contains characters that aren't allowed",
  "テスト公開のブランチは、本番と別の名前にしてください":
    "Use a different branch for test publishing than for production",
  "URLは http:// か https:// から入力してください":
    "URLs must start with http:// or https://",
  "テスト公開は無効になっています（サイトの設定でテスト公開のブランチを指定すると使えます）":
    "Test publishing is off (set a test branch in the site settings to use it)",
  "GitHubへの公開が設定されていません。管理者に確認してください":
    "Publishing to GitHub isn't configured. Contact your administrator",
  "このサイトの公開先リポジトリが設定されていません。ホーム画面のサイトの設定で指定してください":
    "This site has no repository to publish to. Set one in the site settings on the home screen",
  "削除されたか、URLが間違っている可能性があります。":
    "It may have been deleted, or the URL may be wrong.",
  "サイト一覧へ":
    "Go to sites",
  "サイト一覧":
    "Sites",
  "サイト一覧へ戻る":
    "Back to sites",
  "GitHubへの公開が設定されていません":
    "Publishing to GitHub isn't configured",
  "公開するには、サーバー側の設定が必要です。管理者に確認してください。":
    "Publishing needs to be set up on the server. Contact your administrator.",
  "ホーム画面のサイトの設定で、公開先のGitHubリポジトリ（例: owner/site-repo）を指定してください。":
    "Set the GitHub repository to publish to (e.g. owner/site-repo) in the site settings on the home screen.",
  "サイトの設定を開く":
    "Open site settings",
  "通信に失敗しました（{status}）":
    "Request failed ({status})",
  "たった今":
    "just now",
  "{name} を開く":
    "Open {name}",
  "公開先が未設定":
    "No publish target",
  "{time}に編集":
    "Edited {time}",
  "サイトの操作":
    "Site actions",
  "公開サイトを開く":
    "Open live site",
  "サイトの設定":
    "Site settings",
  "新しいサイト":
    "New site",
  "サイト名と、公開先のGitHubリポジトリを変更できます。":
    "Change the site name and the GitHub repository it publishes to.",
  "空のサイトを作って、エディタで開きます。":
    "Creates an empty site and opens it in the editor.",
  "公開先":
    "Publish target",
  "あとからでも設定できます":
    "You can set this later",
  "owner/name の形で入力します。空のままでも編集はできます（公開はできません）。":
    "Enter as owner/name. You can edit without it, but you can't publish.",
  "本番のブランチ":
    "Production branch",
  "テスト公開のブランチ":
    "Test branch",
  "空にするとテスト公開を使いません":
    "Leave empty to turn off test publishing",
  "本番サイトのURL":
    "Live site URL",
  "テストサイトのURL":
    "Test site URL",
  "作成して開く":
    "Create and open",
  "「{name}」の編集データと自動バックアップを削除します。元に戻せません。\n公開済みのサイト（GitHubリポジトリ）はそのまま残ります。\n\n確認のため、サイト名を入力してください。":
    "This deletes the editing data and automatic backups of \"{name}\". This can't be undone.\nThe published site (GitHub repository) stays as it is.\n\nType the site name to confirm.",
  "サイトを削除":
    "Delete site",
  "{n}件のサイト":
    "{n} sites",
  "サイトを探す":
    "Search sites",
  "サーバーの保存先が設定されていないため、サイトと編集内容はこのブラウザに保存されます。別のブラウザや端末からは見えません。":
    "No server storage is set up, so sites and edits are saved in this browser. They won't appear in other browsers or devices.",
  "まだサイトがありません":
    "No sites yet",
  "最初のサイトを作って、編集を始めましょう。":
    "Create your first site to start editing.",
  "「{q}」に当てはまるサイトはありません。":
    "No sites match \"{q}\".",
  "ほかのサイトの要素を貼り付けました":
    "Pasted elements from another site",
  "貼り付ける":
    "Paste",
  "貼り付ける要素に、HTMLとして動く内容（{names}）が含まれています。このエディタ以外でコピーされたデータです。信頼できるところでコピーしたものだけを貼り付けてください。":
    "The elements you're pasting contain content that runs as HTML ({names}), and they weren't copied in this editor. Only paste data you copied from a source you trust.",
  "この内容を貼り付けますか？":
    "Paste this content?",
  "全サイトの合計: サーバーに保存したアセット {length}件（このサイト {own}件）{p2}":
    "All sites: {length} assets stored on the server ({own} in this site){p2}",
  "サイトのリセット":
    "Reset site",
  "すべてのページ・要素・設定を消して、新規作成した直後の状態に戻します。公開済みのサイトは、再度公開するまで変わりません。":
    "Removes all pages, elements and settings and returns the site to how it was when created. The published site isn't affected.",
  "適用":
    "Apply",
  "終わりで切り替え":
    "Change at the end",
  "始まりで切り替え":
    "Change at the start",
  "最初と最後の段を含める":
    "Include the first and last step",
  "両端で切り替え":
    "Change at both ends",
  "なめらか":
    "Smooth",
  "行き過ぎて戻る":
    "Overshoot",
  "イージングを編集":
    "Edit easing",
  "動きの速さの変化（緩急）を決めます。横が時間、縦が進み具合です。":
    "Set how the speed changes over the motion. Horizontal is time, vertical is progress.",
  "始まりの緩急":
    "Start handle",
  "終わりの緩急":
    "End handle",
  "曲線":
    "Curve",
  "段階":
    "Steps",
  "段の数":
    "Number of steps",
  "切り替わる時点":
    "When each step changes",
  "時計の針やコマ送りのように、なめらかにつながず段階的に切り替えます。":
    "Jumps from step to step instead of moving smoothly, like a clock hand or frame-by-frame animation.",
  "CSSの値":
    "CSS value",
  "グラフで表せない値です。この値のまま使えます。":
    "This value can't be shown as a graph, but it can be used as is.",
  "比較（一定の速さ）":
    "Constant speed",
  "このイージング":
    "This easing",
  "一時停止":
    "Pause",
  "再生":
    "Play",
  "横の移動":
    "Move X",
  "縦の移動":
    "Move Y",
  "キーフレームを編集":
    "Edit keyframes",
  "タイムラインの各時点での見た目を決めると、そのあいだが自動でつながります。":
    "Set how the element looks at points on the timeline, and the motion in between is filled in automatically.",
  "プリセットから始める":
    "Start from a preset",
  "各キーフレームの位置を薄く表示":
    "Show each keyframe as an outline",
  "CSSで編集":
    "Edit as CSS",
  "上の目盛りをドラッグで再生位置を動かし、下の帯の空いた所をクリックでキーフレームを追加、◆ をドラッグで時点を動かせます。":
    "Drag the scale to move the playhead, click an empty spot on the bar below to add a keyframe, and drag ◆ to move it.",
  "{offset}% の時点":
    "At {offset}%",
  "いまの再生位置にキーフレームを追加":
    "Add a keyframe at the playhead",
  "このキーフレームを削除":
    "Delete this keyframe",
  "そのほかのCSS":
    "Other CSS",
  "空欄の項目は、前後のキーフレームから自然につながります。":
    "Empty fields blend smoothly from the keyframes before and after.",
  "タイムラインをクリックしてキーフレームを追加します。":
    "Click the timeline to add a keyframe.",
  "この書き方は項目に分けられません。from / to / 0%〜100% と { } の組み合わせで書いてください。":
    "This can't be split into fields. Write it as from / to / 0%–100% followed by { }.",
  "@keyframes の中身（from / to / 0%〜100%）を書きます。もう一度ボタンを押すと項目の編集に戻ります。":
    "Write the body of @keyframes (from / to / 0%–100%). Press the button again to go back to the fields.",
  "{n}個":
    "{n}",
  "{label}（{width}px）を編集中":
    "Editing {label} ({width}px)",
  "{max}px以下に反映":
    "Applies at {max}px and below",
  "{label}（{width}px）で表示 ― 変更は{scope}":
    "View as {label} ({width}px) — {scope}",
  "よくある端末の幅で確かめる":
    "Check common device widths",
  "スマホ（標準）":
    "Phone (standard)",
  "タブレット縦（小）":
    "Tablet portrait (small)",
  "スマホ（小）":
    "Phone (small)",
  "スマホ（大）":
    "Phone (large)",
  "タブレット縦":
    "Tablet portrait",
  "タブレット横":
    "Tablet landscape",
  "小型タブレット":
    "Small tablet",
  "ノートパソコン":
    "Laptop",
  "デスクトップ":
    "Desktop",
  "大きいデスクトップ":
    "Large desktop",
  "サイト名が初期値の「{siteName}」のままです（すべてのページのタイトルの後ろに付きます）":
    "The site name is still the default \"{siteName}\" (it's added after every page title)",
  "「{name}」のURL「/{slug}」が自動で付けたままです（内容を表す短い英単語にすると、検索やシェアで伝わりやすくなります）":
    "The URL \"/{slug}\" of \"{name}\" is still the automatic one (a short word that describes the page reads better in search results and shares)",
  "「{name}」の検索・シェア用タイトルが自動で付けた「{title}」のままです":
    "The search and share title of \"{name}\" is still the automatic \"{title}\"",
  "{names} の検索・シェア用タイトルが同じ「{title}」です（検索結果やタブで見分けられません）":
    "{names} have the same search and share title \"{title}\" (they can't be told apart in search results or tabs)",
  "使用量（全サイト）":
    "Usage (all sites)",
  "無料枠 {size}":
    "{size} free",
  "1GB は Workers KV の無料枠です。有料プランでは超えた分が従量課金になります。":
    "1 GB is the Workers KV free allowance. On a paid plan, storage beyond it is billed by usage.",
  "追加するメールアドレス":
    "Email address to add",
  "すべてのサイトに共通の設定です。":
    "These settings apply to all sites.",
  "ほかの人のコメントは変更できません":
    "You can't change other people's comments",
  "送る本文が大きすぎます（1MBまで）":
    "The request body is too large (up to 1 MB)",
  "複製するサイトが見つかりません":
    "The site to duplicate was not found",
  "送信（⌘Enter）":
    "Send (⌘Enter)",
  "ゲスト":
    "Guest",
  "（編集済み）":
    " (edited)",
  "コメントの操作":
    "Comment actions",
  "このスレッドを削除します。":
    "This thread will be deleted.",
  "このコメントを削除します。":
    "This comment will be deleted.",
  "コメントを削除しますか？":
    "Delete this comment?",
  "コメント":
    "Comments",
  "解決済み":
    "Resolved",
  "未解決に戻す":
    "Reopen",
  "解決済みにする":
    "Resolve",
  "スレッドを削除":
    "Delete thread",
  "返信も含めて、このスレッドを削除します。":
    "This thread and all its replies will be deleted.",
  "スレッドを削除しますか？":
    "Delete this thread?",
  "{name}が解決済みにしました（{time}）":
    "Resolved by {name} ({time})",
  "返信":
    "Reply",
  "コメント {n}":
    "Comment {n}",
  "新しいコメント":
    "New comment",
  "コメントを書く":
    "Write a comment",
  "投稿":
    "Post",
  "コメントモードを終える":
    "Exit comment mode",
  "コメントモードを終える（Esc）":
    "Exit comment mode (Esc)",
  "キャンバスをクリックすると、その場所の要素にコメントを付けられます。":
    "Click the canvas to attach a comment to the element there.",
  "すべてのページ":
    "All pages",
  "解決済みも表示":
    "Show resolved",
  "サーバーの保存先が無いため、コメントはこのブラウザにだけ保存されます。":
    "There is no server storage, so comments are saved only in this browser.",
  "コメントはありません":
    "No comments",
  "削除された要素":
    "Deleted element",
  "返信{n}件":
    "{n} replies",
  "コピーできませんでした":
    "Couldn't copy",
  "ほかのサイトへコピー":
    "Copy to another site",
  "「{name}」を、選んだサイトの末尾に追加します。使っている画像・コンポーネント・フォントも一緒にコピーします。":
    "“{name}” will be added to the end of the site you choose, along with the images, components and fonts it uses.",
  "{n}ページを、選んだサイトの末尾に追加します。使っている画像・コンポーネント・フォントも一緒にコピーします。":
    "{n} pages will be added to the end of the site you choose, along with the images, components and fonts they use.",
  "「{name}」へコピーしました。":
    "Copied to “{name}”.",
  "新しいタブで開く":
    "Open in a new tab",
  "当てはまるサイトはありません":
    "No matching sites",
  "コピー先にできるサイトがありません。ホームでサイトを作ってください。":
    "There is no other site to copy to. Create one on the home screen.",
  "{n}件中 {m}件を表示":
    "Showing {m} of {n}",
  "さらに100件":
    "100 more",
  "すべて表示":
    "Show all",
  "ログインなしの編集者":
    "Editor without sign-in",
  "最後の公開":
    "Last publish",
  "最後のテスト公開":
    "Last test publish",
  "公開した後に変更があります。公開すると反映されます。":
    "There are changes since the last publish. Publish to apply them.",
  "サーバー保存が設定されていないため、このブラウザにだけ保存しています。クリックで再接続します。":
    "Server storage isn't set up, so changes are saved only in this browser. Click to reconnect.",
  "編集した人の記録は、サーバーの保存先（D1）があるときに表示されます。":
    "Who edited the site is shown when server storage (D1) is set up.",
  "最新の変更":
    "Latest change",
  "まだ記録がありません":
    "Nothing recorded yet",
  "直近10分に変更した人（{n}人）":
    "Edited in the last 10 minutes ({n})",
  "いません":
    "No one",
  "サイトを複製":
    "Duplicate site",
  "「{name}」のページ・要素・設定をそのまま写した、新しいサイトを作ります。公開先は複製しないので、必要なら設定してください。":
    "Creates a new site with the same pages, elements and settings as “{name}”. The publishing destination isn't copied, so set it if you need one.",
  "{n}ページを複製":
    "Duplicate {n} pages",
  "{n}ページをほかのサイトへコピー…":
    "Copy {n} pages to another site…",
  "ほかのサイトへコピー…":
    "Copy to another site…",
  "{n}ページを削除":
    "Delete {n} pages",
  "選んだページをほかのサイトへコピー":
    "Copy the selected pages to another site",
  "オン（チェックあり）":
    "On (checked)",
  "オフ（チェックなし）":
    "Off (unchecked)",
  "選択…":
    "Choose…",
  "その他（変数・文字）…":
    "Other (variable or text)…",
  "メソッド":
    "Method",
  "名前（例: Authorization）":
    "Name (e.g. Authorization)",
  "このヘッダーを削除":
    "Remove this header",
  "ヘッダーを追加":
    "Add header",
  "送るJSON":
    "JSON body",
  "JSONとして読み取れません":
    "Not valid JSON",
  "ヘッダーと本文は、公開したサイトのサーバーで送ります。値は公開するプロジェクトのコードに含まれるため、秘密のキーを入れるときはリポジトリを非公開にしてください。":
    "Headers and the body are sent from the published site's server. The values are included in the published project's code, so keep the repository private if you put secret keys here.",
  "リクエストの設定（{method}）":
    "Request settings ({method})",
  "リクエストの設定":
    "Request settings",
  "（全件を取得できなかったため、{p1} に取得した見本を表示しています。一覧は先頭20件まで）":
    " (Couldn't fetch everything, so this is the sample fetched {p1}. Lists show the first 20 items.)",
  "（全件を読み込み中… いまは見本の先頭20件を表示しています）":
    " (Loading everything… showing the first 20 items of the sample for now)",
  "\n初期値・案内文・表示テキストには {変数} を使えます。":
    "\nThe initial value, placeholder and label can use {variables}.",
  "選んだときの値にもなります":
    "Also the value when chosen",
  "最初からチェックしておく":
    "Checked by default",
  "最小":
    "Min",
  "最大":
    "Max",
  "刻み":
    "Step",
  "最大文字数":
    "Max length",
  "制限なし":
    "No limit",
  "行数":
    "Rows",
  "例: image/*, .pdf（空 = すべて）":
    "e.g. image/*, .pdf (empty = any)",
  "複数のファイルを選べる":
    "Allow multiple files",
  "必須（チェックしないと送信できない）":
    "Required (must be checked to submit)",
  "必須（入力しないと送信できない）":
    "Required (must be filled in to submit)",
  "見た目だけを動かす・回す・拡大する・傾けます（まわりの要素の配置は変わりません）。ホバー時などの状態で変えて、モーションの「状態の変化」と組み合わせるとアニメーションになります。":
    "Moves, rotates, scales or skews only how the element looks (the layout around it doesn't change). Change it in a state such as Hover and combine it with a “state change” motion to animate it.",
  "移動 X":
    "Move X",
  "移動 Y":
    "Move Y",
  "拡大 横":
    "Scale X",
  "拡大 縦":
    "Scale Y",
  "基準点":
    "Origin",
  "回転・拡大・傾きの中心になる位置です。":
    "The point that rotation, scaling and skewing happen around.",
  "傾き 横":
    "Skew X",
  "傾き 縦":
    "Skew Y",
  "ほかの変形（{rest}）もそのまま残ります。":
    "Other transforms ({rest}) are kept as they are.",
  "移動・拡大・回転・傾き（transform）":
    "Move, scale, rotate, skew (transform)",
  "入力欄":
    "Input",
  "チェックの色":
    "Check color",
  "選択の色":
    "Selection color",
  "つまみ・バーの色":
    "Thumb and track color",
  "ブラウザ標準の部品の色（accent-color）です。":
    "The color of the browser's built-in control (accent-color).",
  "チェックの大きさは、文字の大きさに合わせて変わります（テキストの「サイズ」）。":
    "The checkbox grows with the text size (Text → Size).",
  "入力カーソルの色":
    "Caret color",
  "文字を入力するときに点滅する縦線の色（caret-color）です。":
    "The color of the blinking line while typing (caret-color).",
  "ピッカーの配色":
    "Picker theme",
  "カレンダー・色選び・選択肢の一覧など、ブラウザが出す部品を明るい配色・暗い配色のどちらで出すか（color-scheme）です。":
    "Whether the browser's pop-ups such as the calendar, color picker and option list use a light or dark theme (color-scheme).",
  "明るい":
    "Light",
  "暗い":
    "Dark",
  "大きさの変更":
    "Resize",
  "右下の角をドラッグして、入力欄の大きさを変えられるか（resize）です。":
    "Whether visitors can resize the field by dragging its bottom-right corner (resize).",
  "不可":
    "None",
  "縦":
    "Vertical",
  "横":
    "Horizontal",
  "両方":
    "Both",
  "ボタンの背景色":
    "Button background",
  "ボタンの文字色":
    "Button text color",
  "ボタンの角丸":
    "Button radius",
  "コメントを読み込めませんでした":
    "Couldn't load comments",
  "コメントを保存できませんでした":
    "Couldn't save the comment",
  "スクリプトで作る変数":
    "Variable made by a script",
  "ブラウザの保存領域が足りないため、コピーできませんでした":
    "Couldn't copy because the browser storage is full",
  "ほかの人の保存と重なったため、コピーできませんでした。もう一度お試しください。":
    "Couldn't copy because someone else saved at the same time. Please try again.",
  "返信1件":
    "1 reply",
  "公開した人":
    "Published by",
  "このブラウザから公開しました。公開した人は、サーバーの保存先（D1）があるときに記録されます。":
    "Published from this browser. Who published is recorded when server storage (D1) is set up.",
  "［入力欄］を［有効にする / 無効にする］":
    "Set ［field］ to ［enabled / disabled］",
  "{target}を{op}":
    "{op} {target}",
  "選んでいる（true）":
    "Selected (true)",
  "選んでいない（false）":
    "Not selected (false)",
  "オン（チェックあり・true）":
    "On (checked, true)",
  "オフ（チェックなし・false）":
    "Off (unchecked, false)",
  "有効にする":
    "Enable",
  "無効にする":
    "Disable",
  "有効・無効を切り替える":
    "Toggle enabled",
  "ほかのブロックで作る変数":
    "Variables made by other blocks",
  "例: size（空 = ID属性）":
    "e.g. size (empty = ID attribute)",
  "同じグループのラジオボタンから1つだけ選べます。{{group}} が選んだボタンの値（表示テキスト）になります。":
    "Only one radio button in the same group can be chosen. {{group}} is the value (label) of the chosen button.",
  "同じグループ名のラジオボタンから1つだけ選べます。グループ名は、選んだボタンの値の変数名になります。":
    "Only one radio button with the same group name can be chosen. The group name becomes the variable holding the chosen button's value.",
  "無効にする（操作できない）":
    "Disabled (can't be used)",
  "グループ・ID属性が未設定のため、この部品の値は送信されません。":
    "This field has no group or ID attribute, so its value isn't submitted.",
  "グループが未設定のため、この部品の値は送信されません。":
    "This field has no group, so its value isn't submitted.",
  "押したときに開くURLやページです。スクリプト画面の「クリックしたとき → 開く」と同じもので、どちらで変えても同じになります。URLには {変数} や #ID（ページ内の位置）も使えます。":
    "The URL or page opened when this is pressed. It is the same as “When clicked → Open” in the script editor, so changing either changes both. URLs can use {variables} and #ID (a position on the page).",
  "https://…・#ID・{変数}":
    "https://… · #ID · {variable}",
  "オフ":
    "Off",
  "オン":
    "On",
  "つまみ":
    "Thumb",
  "入力欄のチェック・無効・文字数などの状態も出します":
    "Also show field states such as disabled, length and index",
  "詳細を隠す":
    "Hide advanced",
  "詳細を表示":
    "Show advanced",
  "チェックしているとき true、していないとき false":
    "true when checked, false when not",
  "グループで選んだラジオボタンの値":
    "Value of the chosen radio button in the group",
  "このラジオボタンを選んでいるとき true":
    "true when this radio button is chosen",
  "入力欄の状態":
    "Field states",
  "スイッチ":
    "Switch",
  "選んだボタンの番号（1から。選んでいなければ空）":
    "Number of the chosen button (from 1; empty if none)",
  "選んだ選択肢の番号（1から）":
    "Number of the chosen option (from 1)",
  "入力した文字数":
    "Number of characters entered",
  "操作できない（無効）とき true":
    "true when disabled",
  "通知を受け取る":
    "Get notifications",
  "{p1} を無効にする":
    "Disable {p1}",
  "{p1} の有効・無効を切り替える":
    "Toggle whether {p1} is enabled",
  "{p1} を有効にする":
    "Enable {p1}",
  "押せるボタンです。検索フォームの中では送信ボタンになります":
    "A pressable button. Inside a search form it submits the form",
  "コメントを編集":
    "Edit",
  "コメントを削除":
    "Delete comment",
  "公開ファイル一覧が壊れているため、公開を中止しました":
    "Publishing stopped because the generated file manifest is invalid.",
};

export default en;
