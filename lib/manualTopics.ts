/**
 * Webマニュアルの記事（Q&A）。
 * guide の target は画面の data-tutorial の値。新しい場所を案内するときは、
 * 画面側に data-tutorial を足してからここで使う
 */

import type { EditorState, Topic } from "./manual";
import { resolveStyles } from "./style";
import { canContainElements } from "./tags";
import { tr } from "./i18n";

/* ---------- 手順が済んだかの判定 ---------- */

const node = (s: EditorState) => (s.selection ? s.doc.nodes[s.selection] : undefined);

/** 選んでいる要素の、いまの画面幅・状態で効いているスタイル */
const style = (s: EditorState, prop: string): string | undefined => {
  const n = node(s);
  return n ? resolveStyles(n, s.breakpoint, s.styleState)[prop] : undefined;
};

const isContainer = (s: EditorState) => {
  const n = node(s);
  return !!n && canContainElements(n);
};

const hasScript = (s: EditorState, kinds: string[]) => {
  const n = node(s);
  if (!n) return false;
  if (n.link && kinds.some((k) => k === "open-page" || k === "open-url")) return true;
  return !!n.scripts?.some((sc) => sc.steps.some((st) => kinds.includes(st.kind)));
};

const pageCount = (s: EditorState) => s.doc.pageOrder.length;

/* ---------- 記事 ---------- */

export const TOPICS: Topic[] = [
  /* ================= はじめに ================= */
  {
    id: "start-screen",
    cat: "start",
    level: 1,
    q: tr("画面のどこで何をするの？"),
    a: tr("**左で「置く・選ぶ」、真ん中で「見る」、右で「変える」**。上のバーで画面幅の切り替えと公開をします。"),
    keys: [tr("使い方"), tr("画面"), tr("見方"), tr("はじめて"), tr("パネル")],
    ctx: ["none"],
    body: [
      { fig: "editor-map" },
      { rule: tr("迷ったら「キャンバスで選んで、右のパネルで変える」。ほとんどの操作はこの流れです。"), title: tr("基本の流れ") },
      { note: tr("左右のパネルは ⌘[ と ⌘] で開け閉めできます。") },
    ],
    guide: [
      { target: "canvas", text: tr("真ん中がキャンバスです。作っているページがそのまま表示されます。要素をクリックすると選べます。") },
      { target: "left-tabs", text: tr("左のパネルの上にあるタブで、ページ・レイヤー・追加・アセット・サイトを切り替えます。"), prepare: { design: true } },
      { target: "inspector", text: tr("右のパネルには、選んだ要素の設定が出ます。何も選んでいないときは、いま開いているページの設定です。") },
      { target: "responsive", text: tr("ここでパソコン・タブレット・スマホの表示を切り替えます。スマホだけ見た目を変えることもできます。") },
      { target: "preview", text: tr("「プレビュー」で、公開したときと同じようにボタンやリンクを試せます。") },
      { target: "publish", text: tr("できあがったら「公開」でサイトに反映します。編集内容は自動で保存されるので、保存ボタンはありません。") },
    ],
    see: ["start-tutorial", "start-save", "el-select"],
  },
  {
    id: "start-tutorial",
    cat: "start",
    level: 1,
    q: tr("まず何から始めればいい？"),
    a: tr("約10分のチュートリアルで、練習ページを作りながら基本操作をひととおり体験できます。"),
    keys: [tr("チュートリアル"), tr("練習"), tr("はじめ"), tr("初心者")],
    ctx: ["none"],
    body: [
      { p: tr("練習用の非公開ページを作り、見出し・文章・ボタンを置いて、並べ方・余白・色・リンク・スマホ対応までを順に試します。各手順に「なぜそうするのか」も書いてあります。") },
      { action: "tutorial" },
      { p: tr("チュートリアルで作ったページは非公開なので、公開サイトには出ません。終わったら [[page-order|ページの一覧]] から削除してもかまいません。") },
      { rule: tr("最初から完璧なページを作ろうとせず、まず「見出し・文章・画像・ボタン」を置いてから整えるほうが早く仕上がります。"), title: tr("作り方のコツ") },
    ],
    see: ["start-screen", "el-add", "d-hierarchy"],
  },
  {
    id: "start-save",
    cat: "start",
    level: 1,
    q: tr("保存はどうするの？"),
    a: tr("**自動で保存されます**。右下に「サーバー保存済み」と出ていれば、ほかの端末からも同じ内容を開けます。"),
    keys: [tr("保存"), tr("セーブ"), tr("消えた"), tr("自動保存"), tr("同期")],
    body: [
      {
        table: {
          head: [tr("右下の表示"), tr("意味")],
          rows: [
            [tr("サーバー保存済み"), tr("保存が完了しています")],
            [tr("サーバーへ保存中…"), tr("保存しているところ")],
            [tr("サーバーに保存できません"), tr("通信が切れているなど。このブラウザには残っています")],
            [tr("このブラウザにのみ保存"), tr("サーバーの保存先が設定されていないため、このブラウザだけに保存しています")],
          ],
        },
      },
      { p: tr("保存が終わる前に閉じたときは、次に開いたときに「このブラウザ」と「サーバー」のどちらの内容を使うか選べます。") },
      { note: tr("サーバーには7日分のバックアップも自動で残ります。自分でファイルに残すときは [[pub-backup|バックアップ]] を使います。") },
    ],
    guide: [{ target: "save-status", text: tr("右下で保存の状態を確かめられます。「サーバー保存済み」なら大丈夫です。") }],
    see: ["start-undo", "start-collab", "pub-backup"],
  },
  {
    id: "start-undo",
    cat: "start",
    level: 1,
    q: tr("間違えた操作を元に戻したい"),
    a: tr("⌘Z で元に戻し、⇧⌘Z でやり直せます。上のバーの矢印ボタンでも同じです。"),
    keys: [tr("元に戻す"), tr("アンドゥ"), "undo", tr("やり直し"), "redo", tr("取り消し"), "Ctrl+Z", "Ctrl+Y"],
    body: [
      { p: tr("直前の100回分まで戻せます。ほかの人の変更を取り込んでも、戻るのは自分の操作だけです。") },
      { warn: tr("アセット（画像）の削除と、バックアップの読み込みは元に戻せません。") },
      { note: tr("文字の入力中の ⌘Z は、その入力だけを戻します。Windows では Ctrl+Y でもやり直せます。") },
    ],
    guide: [{ target: "undo", text: tr("左上の矢印で元に戻す・やり直すができます。") }],
    see: ["start-shortcuts", "pub-backup"],
  },
  {
    id: "start-shortcuts",
    cat: "start",
    level: 2,
    q: tr("ショートカットキーを知りたい"),
    a: tr("よく使う操作はキーボードでもできます。キーの表記は、お使いのパソコン（Mac / Windows）に合わせて表示しています。"),
    keys: [tr("ショートカット"), tr("キーボード"), tr("キー"), tr("操作一覧"), "Ctrl", "Command", tr("コマンド"), tr("コントロール")],
    body: [
      {
        table: {
          head: [tr("キー"), tr("操作")],
          rows: [
            ["⌘Z / ⇧⌘Z", tr("元に戻す / やり直す")],
            ["⌘C / ⌘X / ⌘V", tr("要素のコピー / 切り取り / 貼り付け")],
            ["⌘D", tr("複製（選んでいる要素すべて）")],
            ["Delete", tr("削除（ロック中の要素は消えません）")],
            ["⌘A", tr("同じ階層の要素をすべて選ぶ")],
            [tr("⇧+クリック"), tr("選択に追加・解除")],
            ["Enter", tr("選んだテキストを書き換える")],
            ["⇧Enter", tr("親の要素を選ぶ")],
            ["Esc", tr("選択を外す（文字の編集中は編集を終える）")],
            ["⌘[ / ⌘]", tr("左 / 右のパネルを開け閉めする")],
            [tr("⌘ + スクロール"), tr("キャンバスの拡大・縮小")],
            [tr("{ （文字の入力中）"), tr("変数の候補を出す")],
            ["?", tr("このヘルプを開く")],
          ],
        },
      },
    ],
    see: ["start-undo", "el-select"],
  },
  {
    id: "ai-chat",
    cat: "start",
    level: 1,
    q: tr("AIに頼んで編集したい"),
    a: tr("右上の**きらめきのボタン**（AIに頼む）を押し、やりたいことを文章で送ると、AIがページを編集します。結果は **⌘Z でまとめて取り消せます**。"),
    keys: [tr("AI"), tr("チャット"), tr("自動"), tr("おまかせ"), "Claude"],
    body: [
      { fig: "ai-flow" },
      {
        list: [
          tr("**見た目の調整** … 「見出しをもっと大きく」「ボタンを角丸にして」"),
          tr("**レイアウト** … 「カードを3列に並べて」「スマホでは縦に積んで」"),
          tr("**作る** … 「料金表のセクションを作って」「フッターに会社情報を入れて」"),
          tr("**文章** … 「この説明文をもっと短く、親しみやすく」"),
        ],
      },
      { rule: tr("要素を選んでから頼むと、「これ」「この要素」がその要素を指すので伝わりやすくなります。1回に頼むことは1つか2つにすると、思いどおりになりやすいです。"), title: tr("頼み方のコツ") },
      { note: tr("AIが編集するのは、いま開いているページ（コンポーネントの編集中はそのコンポーネント）だけです。スクリプトやデータの設定、画像のアップロードはできません。") },
      { warn: tr("このボタンは、エディタの管理者がサーバーでAI機能を有効にしているときだけ表示されます。使うAI（Claude・Gemini など）も管理者が選びます。") },
    ],
    guide: [
      { target: "ai", text: tr("このボタンでAIのパネルを開き、やりたいことを入力して Enter で送ります。") },
    ],
    see: ["start-undo", "el-select"],
  },
  {
    id: "start-collab",
    cat: "start",
    level: 2,
    q: tr("ほかの人と同時に編集してもいい？"),
    a: tr("できます。ただし**同じ要素を同時に直すと、後から保存した人の内容が残ります**。担当するページや部分を分けて作業しましょう。"),
    keys: [tr("同時編集"), tr("共同編集"), tr("複数人"), tr("競合")],
    body: [
      { p: tr("ほかの人の保存は数秒で自分の画面にも反映されます。別々の要素を同時に編集した場合は、両方の変更が残ります。") },
      { warn: tr("同じ要素（同じ見出しなど）を同時に変えた場合は、後から保存した側の内容になります。文字単位では合わさりません。") },
      { note: tr("文字を書き換えている間は、ほかの人の変更を取り込むのを待ちます。書き終えると取り込まれます。") },
      { p: tr("右下の「保存」にポインターを乗せると、最後に変更した人と、直近10分に変更した人が出ます。「公開」に乗せると、最後に公開した時刻と人が出ます。") },
    ],
    see: ["start-save", "start-comments", "pub-accounts"],
  },
  {
    id: "start-comments",
    cat: "start",
    level: 2,
    q: tr("ページにコメントを付けて、ほかの人とやりとりしたい"),
    a: tr("上のバーの吹き出しのボタン（または C キー）でコメントモードにし、キャンバスの要素をクリックするとコメントを付けられます。"),
    keys: [tr("コメント"), tr("メモ"), tr("レビュー"), tr("フィードバック"), tr("返信"), tr("指摘")],
    body: [
      { p: tr("コメントはクリックした要素に付くので、画面幅を変えたり要素を動かしたりしても、その要素についていきます。ピンを押すと返信・解決済みにする・削除ができます。") },
      { p: tr("右パネルに、このページ（またはすべてのページ）のコメントの一覧が出ます。押すとそのコメントの場所へ移ります。") },
      { note: tr("コメントは公開するサイトには含まれず、「元に戻す」の対象にもなりません。編集や削除ができるのは、自分が書いたコメントだけです。") },
    ],
    guide: [
      { target: "comments", text: tr("このボタンでコメントモードを始めます。") },
    ],
    see: ["start-collab"],
  },
  {
    id: "start-zoom",
    cat: "start",
    level: 1,
    q: tr("キャンバスを拡大・縮小したい"),
    a: tr("上のバーの「フィット」から倍率を選ぶか、⌘を押しながらスクロールします。"),
    keys: [tr("拡大"), tr("縮小"), tr("ズーム"), tr("倍率")],
    body: [
      { p: tr("「フィット」はキャンバスが画面に収まる倍率です。細かい部分を見たいときは100%や150%にします。") },
      { note: tr("倍率を変えても、作っているページの大きさは変わりません（見え方だけが変わります）。") },
    ],
    guide: [{ target: "zoom", text: tr("ここで倍率を選びます。⌘を押しながらキャンバスをスクロールしても拡大・縮小できます。") }],
  },

  /* ================= ページ ================= */
  {
    id: "page-add",
    cat: "page",
    level: 1,
    q: tr("新しいページを作りたい"),
    a: tr("左のパネルの「ページ」タブで「ページを追加」を押します。作ったら名前とURLを決めましょう。"),
    keys: [tr("ページ追加"), tr("新規ページ"), tr("ページを作る")],
    ctx: ["none"],
    body: [
      { p: tr("追加したページはすぐに開かれます。右のパネル（何も選んでいないとき）で、名前とURLを決めます。") },
      { rule: tr("作りかけのページは「このページを公開する」をオフにしておくと、公開ボタンを押しても外に出ません。"), title: tr("下書きにしておく") },
    ],
    guide: [
      { target: "left-tab-pages", text: tr("左のパネルの「ページ」タブを開きます。"), done: (s) => s.leftTab === "pages" },
      { target: "add-page-button", text: tr("「ページを追加」を押します。"), prepare: { left: "pages" }, done: (s) => pageCount(s) > 0 && !!s.doc.pages[s.activePageId] },
      { target: "tutorial-page-name", text: tr("右のパネルで、エディタ上の名前を付けます（訪問者には見えません）。"), prepare: { deselect: true, section: "tutorial-page-section" } },
      { target: "tutorial-page-slug", text: tr("URL（ページのアドレス）を半角英数字で決めます。"), prepare: { deselect: true, section: "tutorial-page-section" } },
    ],
    see: ["page-url", "page-draft", "page-folder"],
  },
  {
    id: "page-url",
    cat: "page",
    level: 1,
    q: tr("ページのURL（アドレス）を決めたい"),
    a: tr("ページ設定の「URL」に、内容を表す短い半角英数字を入れます。**空にするとトップページ**になります。"),
    keys: ["URL", tr("アドレス"), tr("スラッグ"), "slug", tr("パス")],
    ctx: ["none"],
    body: [
      { p: tr("「access」なら「サイトのURL/access」になります。「news/2026」のように「/」で階層にもできます。") },
      { rule: tr("小文字の英単語をハイフンでつなぎます（例: `about-us`）。一度公開したら変えないこと。変えると、SNSなどに貼られたリンクが切れます。"), title: tr("URLの付け方") },
      { note: tr("エディタの中でそのページを指しているリンクは、URLを変えると自動で書き換わります。") },
    ],
    guide: [
      { target: "tutorial-page-slug", text: tr("ここにURLを入力し、Enterで確定します。空欄ならトップページです。"), prepare: { deselect: true, section: "tutorial-page-section" } },
    ],
    see: ["page-redirect", "page-404", "d-seo"],
  },
  {
    id: "page-draft",
    cat: "page",
    level: 1,
    q: tr("作りかけのページを公開したくない"),
    a: tr("ページ設定の「このページを公開する」をオフにすると**下書き**になり、公開しても外には出ません。"),
    keys: [tr("非公開"), tr("下書き"), tr("隠す"), tr("公開しない")],
    ctx: ["none"],
    body: [
      { p: tr("下書きのページはページ一覧で薄く表示されます。一覧の目のボタンでも切り替えられます。") },
      { note: tr("トップページ（URLが空のページ）を非公開にすると公開できません。") },
      { p: tr("公開はするけれど検索結果に出したくないときは、[[page-seo|検索・シェア]] の「Googleなどの検索結果に表示させない」を使います。") },
    ],
    guide: [
      { target: "tutorial-page-publish-checkbox", text: tr("このチェックを外すと下書きになります。"), prepare: { deselect: true, section: "tutorial-page-section" } },
    ],
    see: ["page-seo", "pub-publish"],
  },
  {
    id: "page-order",
    cat: "page",
    level: 1,
    q: tr("ページを並べ替え・複製・削除したい"),
    a: tr("「ページ」タブの一覧で、行をドラッグすると並べ替え、行にマウスを乗せると出るボタンで複製・削除できます。**何ページもまとめて**移動・削除するときは [[page-multi|複数選択]] を使います。"),
    keys: [tr("ページ削除"), tr("ページ複製"), tr("並べ替え"), tr("ページの順番")],
    body: [
      { p: tr("複製すると、中の要素ごとコピーされ、名前とURLには重ならないよう「のコピー」「-copy」が付きます。") },
      { p: tr("削除したページは ⌘Z で戻せます。そのページへのリンクは外れます。") },
      { note: tr("一覧の並び順は公開サイトのURLには影響しません。エディタで探しやすい順にしておきましょう。") },
    ],
    guide: [{ target: "pages-panel", text: tr("行をドラッグして並べ替えます。行にマウスを乗せると、右端に複製・削除・公開の切り替えボタンが出ます。"), prepare: { left: "pages" } }],
    see: ["page-folder", "page-add"],
  },
  {
    id: "page-folder",
    cat: "page",
    level: 1,
    q: tr("ページが増えて探しにくい（フォルダで整理したい）"),
    a: tr("「ページ」タブの上のフォルダのボタンでフォルダを作り、ページをドラッグして入れます。フォルダはエディタの中だけの整理で、**URLには影響しません**。"),
    keys: [tr("フォルダ"), tr("整理"), tr("グループ"), tr("分類")],
    body: [
      { fig: "folders-vs-url" },
      {
        list: [
          tr("フォルダの行へドロップ → 中に入る"),
          tr("フォルダの外のページの間へドラッグ → 外に出る"),
          tr("フォルダの「＋」 → 中に新しいページを作る"),
          tr("名前はダブルクリックで変更。フォルダを削除しても中のページは残ります"),
        ],
      },
    ],
    guide: [
      { target: "left-tab-pages", text: tr("「ページ」タブを開きます。"), done: (s) => s.leftTab === "pages" },
      { target: "add-folder-button", text: tr("このフォルダのボタンを押すと、新しいフォルダができます。続けて名前を入力してEnterで確定します。"), prepare: { left: "pages" }, done: (s) => !!s.doc.pageFolders?.length },
      { target: "pages-panel", text: tr("ページの行をフォルダの行へドラッグして入れます。フォルダ名はダブルクリックで変えられます。"), prepare: { left: "pages" } },
    ],
    see: ["page-order"],
  },
  {
    id: "page-multi",
    cat: "page",
    level: 2,
    q: tr("たくさんのページをまとめて整理・削除したい"),
    a: tr("「ページ」タブの**選択のボタン**を押すか、**⌘クリック・Shiftクリック**で複数のページを選ぶと、上にまとめて操作するバーが出ます。"),
    keys: [tr("複数選択"), tr("一括"), tr("まとめて"), tr("一括削除"), tr("フォルダへ移動")],
    body: [
      { fig: "page-multi" },
      {
        table: {
          head: [tr("操作"), tr("やり方")],
          rows: [
            [tr("1件ずつ選ぶ"), tr("⌘クリック（Windows は Ctrl+クリック）")],
            [tr("範囲で選ぶ"), tr("Shiftクリック")],
            [tr("フォルダへ移動"), tr("バーのフォルダのボタン、または選んだページをフォルダへドラッグ")],
            [tr("公開・非公開"), tr("バーの目のボタン")],
            [tr("削除"), tr("バーのゴミ箱のボタン（⌘Z で戻せます）")],
            [tr("選択をやめる"), tr("Esc か、バーの × ボタン")],
          ],
        },
      },
      { note: tr("ふつうのクリックはページを開きます。選択中のページはキャンバスに表示しているページとは別なので、開いたまま整理できます。") },
    ],
    guide: [
      { target: "pages-panel", text: tr("一覧の上の選択のボタンを押すか、⌘クリックでページを選びます。"), prepare: { left: "pages" } },
    ],
    see: ["page-folder", "page-order"],
  },
  {
    id: "page-seo",
    cat: "page",
    level: 2,
    q: tr("検索結果やSNSでの見え方を設定したい"),
    a: tr("何も選んでいない状態の右パネルで「検索・シェア（SEO）」を開き、タイトル・説明文・シェア用画像を設定します。"),
    keys: ["SEO", tr("タイトル"), tr("説明文"), "OGP", tr("シェア"), tr("検索結果"), tr("ディスクリプション"), "noindex"],
    ctx: ["none"],
    body: [
      {
        table: {
          head: [tr("項目"), tr("目安")],
          rows: [
            [tr("タイトル"), tr("30文字前後。ページの内容がひと目で分かる言葉を先頭に")],
            [tr("説明文"), tr("70〜120文字。検索結果の下に出る紹介文")],
            [tr("シェア用画像（OGP）"), tr("1200×630px。SNSに貼られたときの大きな画像")],
          ],
        },
      },
      { rule: tr("タイトルはページごとに変えます。全ページ同じだと、検索結果でどれがどのページか分かりません。"), title: tr("ページごとに違うタイトルを") },
      { note: tr("タブや検索結果には「タイトル | サイト名」の形で出ます。「検索結果に表示させない」をオンにすると、URLを知っている人だけが開けます。") },
    ],
    guide: [
      { target: "page-seo", text: tr("「検索・シェア（SEO）」を開き、タイトル・説明文・シェア用画像を入れます。"), prepare: { deselect: true, section: "page-seo" } },
    ],
    see: ["d-seo", "pub-site"],
  },
  {
    id: "page-404",
    cat: "page",
    level: 3,
    q: tr("存在しないURLを開いたときのページ（404）を作りたい"),
    a: tr("URLを「404」にしたページを作ると、存在しないアドレスを開いたときにそのページが表示されます。"),
    keys: ["404", tr("見つからない"), tr("エラーページ"), "Not Found"],
    body: [
      { p: tr("「お探しのページは見つかりませんでした」という文章と、トップページへ戻るボタンを置くのが一般的です。") },
      { rule: tr("404ページには必ず「トップへ戻る」などの行き先を用意します。行き止まりにすると、訪問者はそのままサイトを離れてしまいます。") },
    ],
    see: ["page-url", "page-redirect"],
  },
  {
    id: "page-redirect",
    cat: "page",
    level: 3,
    q: tr("古いURLから新しいページへ自動で移動させたい（リダイレクト）"),
    a: tr("ページを作り、ページ設定の「カスタムコード」で「ページの種類」を「リダイレクト」にして転送先を入れます。"),
    keys: [tr("リダイレクト"), tr("転送"), "301", tr("URL変更"), tr("リバースプロキシ")],
    body: [
      { p: tr("転送先には「/new-page」のようなサイト内のURLか、「https://」から始まる外部のURLを入れます。検索エンジンにも「移転した」と正しく伝わる転送（301）になります。") },
      { p: tr("「外部サイトを表示」を使うと、アドレスはそのままで別のサイトの内容を表示できます（リバースプロキシ）。") },
      { rule: tr("公開済みのページのURLを変えるときは、古いURLにリダイレクトを置いておくと、SNSなどに貼られたリンクが切れません。") },
    ],
    guide: [
      { target: "page-code", text: tr("「カスタムコード」の「ページの種類」で「リダイレクト」を選びます。"), prepare: { deselect: true, section: "page-code" } },
    ],
    see: ["page-url"],
  },
  {
    id: "page-html",
    cat: "page",
    level: 4,
    q: tr("HTMLを直接書いたページを置きたい"),
    a: tr("ページ設定の「カスタムコード」で「ページの種類」を「HTML」にすると、書いたHTMLをそのまま配信します。"),
    keys: ["HTML", tr("コード"), tr("直書き"), tr("ゲーム"), "ZIP"],
    body: [
      { p: tr("HTMLファイルや、画像・CSS・JavaScriptをまとめたZIPを読み込めます。ZIPの中の画像などは自動でアセットに入り、HTMLの中の参照先も置き換わります。") },
      { warn: tr("HTMLページには、サイト共通のヘッダー・メタ情報・カスタムコードは入りません。キャンバスでの編集もできません。") },
      { p: tr("ページの一部にだけHTMLを入れたいときは、「追加」の「コード」要素を使います。") },
    ],
    guide: [
      { target: "page-code", text: tr("「ページの種類」で「HTML」を選び、コードを貼るか、ファイル・ZIPを読み込みます。"), prepare: { deselect: true, section: "page-code" } },
    ],
    see: ["page-code-snippet"],
  },
  {
    id: "page-code-snippet",
    cat: "page",
    level: 4,
    q: tr("アクセス解析（Google Analyticsなど）のコードを入れたい"),
    a: tr("全ページに入れるなら「サイト」タブの「カスタムコード（全ページ共通）」の「head内コード」、特定のページだけならページ設定の「カスタムコード」に貼ります。"),
    keys: ["Google Analytics", tr("アナリティクス"), tr("タグ"), tr("計測"), "head", tr("スクリプト"), "JSON-LD"],
    ctx: ["site"],
    body: [
      { p: tr("解析サービスが用意する `<script>` のコードをそのまま貼ります。構造化データ（JSON-LD）も同じ場所に入れられます。") },
      { warn: tr("コードは確認なしにそのまま公開サイトへ入ります。信頼できる提供元のコードだけを貼り、公開前に [[pub-publish|テストサイト]] で動作を確かめましょう。") },
    ],
    guide: [
      { target: "site-code", text: tr("「カスタムコード（全ページ共通）」を開き、「head内コード」に貼ります。"), prepare: { left: "site", section: "site-code" } },
    ],
    see: ["page-html"],
  },

  /* ================= 要素の追加と選択 ================= */
  {
    id: "el-add",
    cat: "element",
    level: 1,
    q: tr("文字や画像などの部品を置きたい"),
    a: tr("左のパネルの「追加」タブで部品を押すと、いま選んでいる要素の**中（ボックスなら）か後ろ**に入ります。どちらに入れるかは「挿入先」の「中へ / 後ろへ」で切り替えられます。キャンバスへドラッグして置くこともできます。"),
    keys: [tr("追加"), tr("挿入"), tr("要素"), tr("部品"), tr("配置")],
    ctx: ["none", "box"],
    body: [
      {
        table: {
          head: [tr("要素"), tr("使いどころ")],
          rows: [
            [tr("ボックス"), tr("ほかの要素をまとめる入れ物。並べ方や背景を付ける土台")],
            [tr("見出し"), tr("ページや区切りのタイトル")],
            [tr("テキスト"), tr("本文")],
            [tr("ボタン"), tr("押してほしい操作（申し込み・詳しく見る など）")],
            [tr("画像"), tr("写真・ロゴ・イラスト")],
          ],
        },
      },
      { rule: tr("先に入れたい場所を選んでから追加すると、あとで並べ替える手間が省けます。入る場所は「追加」タブの上の「挿入先」に出ます。"), title: tr("先に場所を選ぶ") },
      { fig: "insert-mode", caption: tr("「挿入先」の「中へ / 後ろへ」で、追加する位置の決め方を切り替えます") },
    ],
    guide: [
      { target: "left-tab-add", text: tr("左のパネルの「追加」タブを開きます。"), done: (s) => s.leftTab === "add" },
      { target: "insert-target", text: tr("ここに、追加した要素が入る場所が出ます。変えたいときは、先にキャンバスで場所を選びます。"), prepare: { left: "add" } },
      { target: "add-panel", text: tr("置きたい部品を押すか、キャンバスへドラッグします。"), prepare: { left: "add" } },
    ],
    see: ["el-insert", "el-select", "el-move", "img-add"],
  },
  {
    id: "el-insert",
    cat: "element",
    level: 1,
    q: tr("追加した要素がボックスの中に入ってしまう（後ろに置きたい）"),
    a: tr("「追加」タブの「挿入先」で「**後ろへ**」を選ぶと、選んだ要素のすぐ後ろ（同じ階層）に入ります。「**中へ**」に戻すと、ボックスを選んでいるときはその中に入ります。"),
    keys: [tr("挿入先"), tr("中へ"), tr("後ろへ"), tr("兄弟"), tr("同じ階層")],
    body: [
      { fig: "insert-mode" },
      { p: tr("この切り替えは、部品の追加だけでなく、**貼り付け（⌘V）**、画像やコンポーネントの追加にも効きます。毎回たずねず、このブラウザで最後に選んだほうを使います。") },
      { note: tr("文字や画像など、中に要素を入れられない要素を選んでいるときは、どちらでも後ろに入ります。") },
    ],
    guide: [
      { target: "insert-target", text: tr("ここで「中へ」と「後ろへ」を切り替えます。"), prepare: { left: "add" } },
    ],
    see: ["el-add", "el-move"],
  },
  {
    id: "el-select",
    cat: "element",
    level: 1,
    q: tr("うまく要素を選べない・親の要素を選びたい"),
    a: tr("クリックするたびに**1段ずつ内側**が選ばれます。**⌘クリック（Windows は Ctrl+クリック）でいちばん奥**を直接選べます。外側（親）を選ぶには ⇧Enter か選択枠の左上の矢印を使います。"),
    keys: [tr("選択"), tr("選べない"), tr("親"), tr("複数選択"), tr("レイヤー"), tr("奥"), tr("階層")],
    body: [
      { fig: "select-depth", caption: tr("同じ場所をクリックするたびに1段ずつ内側へ。⌘クリックならいちばん奥を一度で選べます") },
      {
        list: [
          tr("**クリック** … まず外側の大きな要素が選ばれ、続けて中をクリックすると1段ずつ内側へ（ぴったり重なっていて見分けのつかない階層は飛ばします）"),
          tr("**ダブルクリック** … いちばん内側の要素を選んで、文字なら書き換え"),
          tr("**⌘クリック（Ctrl+クリック）** … いちばん奥の要素をすぐに選ぶ"),
          tr("**⇧+クリック** … 複数の要素を選ぶ（スタイルの変更・削除・複製がまとめて効く）"),
          tr("**⇧Enter / 選択枠の左上の矢印** … 親の要素を選ぶ"),
          tr("**レイヤー** … 要素の入れ子がそのまま一覧になっていて、重なっていても確実に選べる"),
        ],
      },
      { note: tr("ロックした要素はキャンバスでドラッグできません。レイヤーの鍵のボタンで外せます。") },
      { p: tr("別のカードなど、いま選んでいる要素と**同じ階層の要素**をクリックすると、同じ階層のまま選び替わります。関係のない場所をクリックすると、またいちばん外側から選び直します。") },
    ],
    guide: [
      { target: "canvas", text: tr("キャンバスで要素をクリックして選びます。"), needs: "any" },
      { target: "sel-parent", text: tr("選択枠の左上の矢印で、ひとつ外側（親）の要素を選べます。") },
      { target: "layers-panel", text: tr("「レイヤー」では、入れ子の構造のまま要素を選べます。"), prepare: { left: "layers" } },
    ],
    see: ["el-move", "el-lock"],
  },
  {
    id: "el-move",
    cat: "element",
    level: 1,
    q: tr("要素の順番を入れ替えたい・別のボックスへ移したい"),
    a: tr("レイヤーかキャンバスで要素をドラッグします。青い線の位置に入り、**ボックスの真ん中に落とすとその中へ入ります**。"),
    keys: [tr("移動"), tr("並べ替え"), tr("順番"), tr("ドラッグ"), tr("入れ替え")],
    ctx: ["box", "text", "image"],
    body: [
      { p: tr("右クリックのメニューの「前へ移動」「後ろへ移動」でも1つずつ動かせます。複数選んでいれば、まとめて動きます。") },
      { rule: tr("要素を動かすときは、位置の数値を変えるのではなく「並び順」と「入れ物（ボックス）」を変えます。画面幅が変わっても崩れません。"), title: tr("位置は並び順で決める") },
    ],
    guide: [
      { target: "layers-panel", text: tr("レイヤーの行をドラッグすると、青い線の位置へ移ります。ボックスの行の真ん中に重ねると、その中へ入ります。"), prepare: { left: "layers" } },
    ],
    see: ["el-select", "d-flow-not-absolute"],
  },
  {
    id: "el-copy",
    cat: "element",
    level: 1,
    q: tr("要素を複製・コピー・削除したい"),
    a: tr("⌘D で複製、⌘C／⌘V でコピーと貼り付け、Delete で削除です。右クリックのメニューからもできます。"),
    keys: [tr("複製"), tr("コピー"), tr("貼り付け"), tr("貼り付け"), tr("削除"), tr("消す")],
    ctx: ["box", "text", "image"],
    body: [
      { p: tr("貼り付けは、選んでいるボックスの中か、選んでいる要素の後ろに入ります。別のページにも貼り付けられます。") },
      { note: tr("ロックした要素は削除できません（誤って消さないための機能です）。") },
    ],
    see: ["el-lock", "start-shortcuts"],
  },
  {
    id: "el-lock",
    cat: "element",
    level: 2,
    q: tr("動かしたくない要素を固定したい・一時的に隠したい"),
    a: tr("右パネルの「設定」の「**ロック**」か、レイヤーの行の鍵のボタンで固定します。隠すときはレイヤーの目のボタンを使います。"),
    keys: [tr("ロック"), tr("固定"), tr("非表示"), tr("隠す"), tr("目のアイコン")],
    body: [
      { p: tr("ロックすると、キャンバスやレイヤーでの**移動・リサイズ・削除・切り取りができなくなります**。色や文字などのスタイルは変えられるので、作り終えた部分をうっかり動かしたり消したりしないための機能です。目のボタンは、いま表示している画面幅以下で隠します（[[resp-hide|デバイスごとの表示]]）。") },
    ],
    guide: [
      { target: "layer-selected", text: tr("選んでいる要素の行の右端に、鍵（ロック）と目（表示）のボタンがあります。"), needs: "any", prepare: { left: "layers" } },
    ],
    see: ["resp-hide", "el-select"],
  },
  {
    id: "el-name",
    cat: "element",
    level: 1,
    q: tr("レイヤーの名前を分かりやすくしたい"),
    a: tr("レイヤーの名前をダブルクリックするか、右パネルの「設定」の「名前」で変えます。"),
    keys: [tr("名前"), tr("レイヤー名"), tr("リネーム")],
    body: [
      { p: tr("名前はエディタの中だけで使う目印で、公開サイトには出ません。「ヘッダー」「お知らせ一覧」のように役割で名付けると、ページが大きくなっても迷いません。") },
    ],
    guide: [
      { target: "settings-name", text: tr("ここで名前を変えられます。"), needs: "any", prepare: { right: "settings" } },
    ],
  },
  {
    id: "el-semantic",
    cat: "element",
    level: 3,
    q: tr("「意味付け（出力タグ）」って何？"),
    a: tr("ボックスが「ヘッダー」「ナビゲーション」「メイン」などのどの部分なのかを、検索エンジンや読み上げソフトに伝える設定です。**見た目は変わりません**。"),
    keys: [tr("意味付け"), tr("タグ"), tr("セマンティック"), "header", "nav", "main", "section", "footer"],
    ctx: ["box"],
    body: [
      {
        table: {
          head: [tr("意味付け"), tr("使う場所")],
          rows: [
            [tr("ヘッダー"), tr("ページ上部のロゴ・メニューのまとまり")],
            [tr("ナビゲーション"), tr("主要なリンクの並び")],
            [tr("メイン"), tr("ページの主な内容（1ページに1つ）")],
            [tr("セクション"), tr("見出しを持つひとまとまり")],
            [tr("記事"), tr("単体で完結する記事・お知らせ")],
            [tr("フッター"), tr("ページ下部の補足情報")],
          ],
        },
      },
      { p: tr("「自動」のままでも、中身から判断して出力します。迷ったら自動で大丈夫です。") },
    ],
    guide: [{ target: "settings-semantic", text: tr("ここで意味付けを選びます。"), needs: "container", prepare: { right: "settings" } }],
    see: ["text-heading", "d-accessibility"],
  },

  /* ================= 文字 ================= */
  {
    id: "text-edit",
    cat: "text",
    level: 1,
    q: tr("文字を書き換えたい・改行したい"),
    a: tr("**文字をダブルクリック**すると書き換えられます。Enterで改行、Escか外側のクリックで確定です。"),
    keys: [tr("文字"), tr("テキスト"), tr("編集"), tr("書き換え"), tr("改行")],
    ctx: ["text"],
    body: [
      { p: tr("選んだ状態で Enter を押しても書き換えを始められます。⌘Enter でも確定できます。") },
      { note: tr("文字の中で「{」を入力すると、データや入力欄の値を差し込む [[act-vars|変数]] の候補が出ます。文字として「{」を書きたいときは、そのまま候補を閉じて続けます。") },
    ],
    guide: [
      { target: "selected-node", text: tr("書き換えたい文字をダブルクリックし、入力したら外側をクリックして確定します。"), needs: "text", done: (s) => !!s.editingText },
    ],
    see: ["text-size", "text-partial"],
  },
  {
    id: "text-size",
    cat: "text",
    level: 1,
    q: tr("文字の大きさ・太さ・色を変えたい"),
    a: tr("文字を選び、右パネルの「スタイル」の「テキスト」でサイズ・太さ・色を変えます。"),
    keys: [tr("文字サイズ"), tr("大きさ"), tr("太字"), tr("太さ"), tr("文字色"), tr("フォントサイズ")],
    ctx: ["text"],
    body: [
      { p: tr("数値の欄は、左の「A」を左右にドラッグしても変えられます。↑↓キーで1ずつ、⇧を押しながらだと10ずつ変わります。") },
      { rule: tr("本文は16px、見出しは本文の1.5〜2.5倍が目安。大きさは4〜5段階にそろえます（[[d-type-scale|文字の大きさの目安]]）。"), title: tr("文字サイズの目安") },
      { note: tr("ボックスに付けた文字のスタイルは、中の文字すべてに受け継がれます。サイト全体の基本は「body」で決めると楽です。") },
    ],
    guide: [
      { target: "style-typography", text: tr("「テキスト」でサイズ・太さ・色を変えます。"), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-type-scale", "text-font", "text-partial"],
  },
  {
    id: "text-partial",
    cat: "text",
    level: 2,
    q: tr("文章の一部だけ色や太さを変えたい"),
    a: tr("文字を書き換え中に変えたい部分をドラッグで選び、そのまま右パネルで色や太さを変えます。「分割して適用」を選ぶと、その部分だけが別の要素になります。"),
    keys: [tr("一部"), tr("部分"), tr("強調"), tr("マーカー"), "span"],
    ctx: ["text"],
    body: [
      { p: tr("分割すると、前・選んだ部分・後ろの3つの要素に分かれます。") },
      { warn: tr("分割した後は、文章全体をまとめて書き換えられません。文章が固まってから分割しましょう。") },
      { rule: tr("強調は1つの段落に1〜2か所まで。あちこち強調すると、どこも目立たなくなります。") },
    ],
    see: ["text-size", "d-hierarchy"],
  },
  {
    id: "text-font",
    cat: "text",
    level: 2,
    q: tr("フォント（書体）を変えたい・Google Fontsを使いたい"),
    a: tr("「テキスト」の「フォント」で選びます。右の「＋」から Google Fonts のフォント名を入れると追加できます。"),
    keys: [tr("フォント"), tr("書体"), "Google Fonts", tr("明朝"), tr("ゴシック")],
    ctx: ["text", "body"],
    body: [
      { p: tr("fonts.google.com で探し、表示されている名前（例: Shippori Mincho）をそのまま入力します。") },
      { rule: tr("使うフォントは2種類まで（見出し用と本文用）。増えるほどまとまりがなくなり、読み込みも遅くなります。日本語のフォントは特に重いので、本文は標準のゴシックにするのも手です。"), title: tr("フォントは2種類まで") },
    ],
    guide: [
      { target: "style-typography", text: tr("「フォント」の欄で選ぶか、右の「＋」で Google Fonts から追加します。"), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-fonts", "d-performance"],
  },
  {
    id: "text-heading",
    cat: "text",
    level: 1,
    q: tr("見出しと本文はどう使い分ける？"),
    a: tr("見出しは「その区切りに何が書いてあるか」を表す短い文字です。**ページの題名を見出し1**にし、その下の区切りを見出し2、さらに細かい区切りを見出し3…と順に使います。"),
    keys: [tr("見出し"), "h1", "h2", tr("見出しレベル"), tr("本文")],
    ctx: ["text"],
    body: [
      { fig: "heading-outline" },
      { rule: tr("見出し1はページに1つ。段を飛ばさない。検索エンジンや読み上げソフトは、見出しの段でページの構造を読み取ります。"), title: tr("見出しの決まりごと") },
      { note: tr("見出しのレベルと文字の大きさは別です。見た目はサイズで自由に変えられます。") },
    ],
    guide: [
      { target: "style-typography", text: tr("「見出しレベル」で本文・見出し1〜6を切り替えます。"), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-hierarchy", "d-seo"],
  },
  {
    id: "text-align",
    cat: "text",
    level: 1,
    q: tr("文字を中央揃えにしたい・長い文字を「…」で省略したい"),
    a: tr("「テキスト」の「揃え」で左・中央・右を選びます。「折り返し」を「省略」にすると、決めた行数を超えた分が「…」になります。"),
    keys: [tr("中央揃え"), tr("右寄せ"), tr("省略"), tr("三点リーダー"), tr("折り返し"), tr("改行しない")],
    ctx: ["text"],
    body: [
      { rule: tr("長い文章は左揃え、中央揃えは見出しや短い一文だけに。3行を超える文章を中央にすると、行の頭がそろわず読みにくくなります。"), title: tr("揃え方の使い分け") },
      { note: tr("「折り返し」は、する＝次の行へ、なし＝1行のまま、省略＝「…」で切る、です。要素ごと真ん中に寄せたいときは [[layout-center|配置]] を使います。") },
    ],
    guide: [
      { target: "style-typography", text: tr("「揃え」と「折り返し」を変えます。"), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["layout-center", "d-line-length"],
  },
  {
    id: "text-spacing",
    cat: "text",
    level: 2,
    q: tr("行間・字間を読みやすくしたい"),
    a: tr("「テキスト」の「行間」「字間」で調整します。日本語の本文は**行間1.7〜1.9**くらいが読みやすい目安です。"),
    keys: [tr("行間"), tr("字間"), tr("行の高さ"), "line-height", "letter-spacing", tr("読みやすさ")],
    ctx: ["text", "body"],
    body: [
      {
        table: {
          head: ["", tr("行間"), tr("字間")],
          rows: [
            [tr("本文"), "1.7〜1.9", "0〜0.05em"],
            [tr("見出し"), "1.2〜1.5", "0〜0.08em"],
            [tr("小さな注釈"), "1.5〜1.7", "0.02〜0.05em"],
          ],
        },
      },
      { rule: tr("行間は単位なし（1.8 など）で指定します。文字の大きさに合わせて自動で比率が保たれるので、スマホで文字を小さくしても崩れません。"), title: tr("行間は単位なしで") },
    ],
    guide: [
      { target: "style-typography", text: tr("「行間」と「字間」を調整します。"), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-line-length", "d-units"],
  },

  /* ================= レイアウト ================= */
  {
    id: "layout-row",
    cat: "layout",
    level: 1,
    q: tr("要素を横に並べたい"),
    a: tr("並べたい要素を1つのボックスに入れ、**そのボックス（親）を選んで**「レイアウト」のフローを「水平フロー（右向きの矢印）」にします。"),
    keys: [tr("横並び"), tr("横に並べる"), tr("並べ方"), "flex", tr("フレックス"), tr("フロー")],
    ctx: ["box"],
    body: [
      { fig: "parent-row" },
      { rule: tr("「横に並べたい」「真ん中に寄せたい」と思ったら、まず親（入れ物）を選ぶ。子を1つずつ動かすより、画面幅が変わっても崩れません。"), title: tr("並べ方は親で決める") },
      { fig: "flow-modes", caption: tr("フローは4種類。「自動」は文字の流れと同じ並び方、グリッドはマス目に並べます。") },
    ],
    guide: [
      { target: "canvas", text: tr("横に並べたい要素が入っているボックス（親）を選びます。並べたい要素を選んでいたら、⇧Enter で親を選べます。"), needs: "container" },
      {
        target: "style-layout",
        text: tr("「フロー」で右向きの矢印（水平フロー）を押します。"),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => isContainer(s) && style(s, "display") === "flex" && (style(s, "flexDirection") ?? "row").startsWith("row"),
      },
      { target: "style-layout", text: tr("「配置」の3×3で寄せる位置を、「間隔」で要素どうしのすき間を決めます。"), prepare: { right: "style", section: "style-layout" } },
    ],
    see: ["layout-center", "layout-gap", "resp-stack"],
  },
  {
    id: "layout-center",
    cat: "layout",
    level: 1,
    q: tr("要素を真ん中に置きたい（横・縦の中央寄せ）"),
    a: tr("親のボックスを選び、フローを垂直か水平にしてから、**「配置」の3×3の真ん中**を押します。"),
    keys: [tr("中央"), tr("真ん中"), tr("センター"), tr("中央寄せ"), tr("上下中央")],
    ctx: ["box"],
    body: [
      { fig: "align-center" },
      { p: tr("縦の真ん中に寄せるには、親に高さ（または最小高さ）が必要です。中身ぴったりの高さでは、寄せる余白がありません。") },
      { note: tr("文字そのものを中央に揃えるときは [[text-align|テキストの揃え]] を使います。") },
    ],
    guide: [
      { target: "canvas", text: tr("真ん中に置きたい要素の親（入れ物のボックス）を選びます。"), needs: "container" },
      {
        target: "style-layout",
        text: tr("フローを垂直フロー（↓）か水平フロー（→）にします。"),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => style(s, "display") === "flex",
      },
      {
        target: "style-layout",
        text: tr("「配置」の3×3の真ん中を押します。"),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => style(s, "alignItems") === "center" && style(s, "justifyContent") === "center",
      },
    ],
    see: ["layout-row", "text-align", "layout-height"],
  },
  {
    id: "layout-gap",
    cat: "layout",
    level: 1,
    q: tr("要素と要素の間をあけたい"),
    a: tr("親のボックスを選び、「レイアウト」の「間隔」に数値を入れます。**中の要素すべての間が同じだけあきます**。"),
    keys: [tr("間隔"), tr("すき間"), tr("スペース"), "gap", tr("あける"), tr("均等")],
    ctx: ["box"],
    body: [
      { fig: "gap-vs-margin" },
      { rule: tr("子に1つずつ外側余白を付けるより、親の「間隔」でまとめて決めます。要素を増やしても減らしても、間がそろったままです。"), title: tr("間は親の間隔で") },
      { note: tr("「間隔」の横のボタン（自動）は、両端に寄せて残りを均等に配ります。数値は 8・16・24… の刻みでそろえると整います（[[d-spacing|余白のルール]]）。") },
    ],
    guide: [
      { target: "canvas", text: tr("間をあけたい要素の親（入れ物）を選びます。"), needs: "container" },
      { target: "style-layout", text: tr("フローが垂直・水平・グリッドのときに出る「間隔」に数値を入れます。フローが「自動」なら、先に垂直フローにします。"), prepare: { right: "style", section: "style-layout" }, done: (s) => !!style(s, "gap") },
    ],
    see: ["layout-spacing", "d-spacing"],
  },
  {
    id: "layout-spacing",
    cat: "layout",
    level: 1,
    q: tr("内側余白と外側余白の違いは？"),
    a: tr("内側余白は「枠の内側」（中身と縁の間）、外側余白は「枠の外側」（隣の要素との間）のすき間です。"),
    keys: [tr("余白"), tr("内側余白"), tr("外側余白"), "padding", "margin", tr("パディング"), tr("マージン")],
    ctx: ["box", "text"],
    body: [
      { fig: "box-model" },
      { p: tr("「余白」の左の欄が左右、右の欄が上下です。四角のボタンで上下左右を別々に決められます。") },
      { rule: tr("ボタンの文字の周りは、左右を上下の2倍くらいに（例: 上下12px・左右24px）。押す部分の高さは44px以上を目安にします。"), title: tr("ボタンの余白") },
    ],
    guide: [
      { target: "style-spacing", text: tr("「余白」で内側と外側の余白を入れます。左の欄が左右、右の欄が上下です。"), needs: "any", prepare: { right: "style", section: "style-spacing" } },
    ],
    see: ["layout-gap", "d-spacing", "d-mobile"],
  },
  {
    id: "layout-width",
    cat: "layout",
    level: 2,
    q: tr("幅を画面いっぱいにしたい・残りの幅を埋めたい"),
    a: tr("「レイアウト」のサイズで、W に 100% を入れると親の幅いっぱいになります。横並びの中で残りを埋めたいときは、W の横の矢印ボタン（残りを埋める）を押します。"),
    keys: [tr("幅"), tr("横幅"), "100%", tr("いっぱい"), tr("残りを埋める"), tr("伸ばす"), tr("サイズ")],
    ctx: ["box", "image"],
    body: [
      { fig: "width-percent" },
      { rule: tr("幅は % や「残りを埋める」で親に合わせ、上限だけを「最大幅」の px で決めます。px で固定するのは、アイコンなど大きさを変えたくないものだけです。"), title: tr("幅は親に合わせる") },
      { note: tr("幅が空欄（auto）なら、ボックスは親いっぱい、横並びの中では中身に合わせた幅です。単位の文字を押すと、見た目を保ったまま単位が切り替わります。") },
    ],
    guide: [
      { target: "style-layout", text: tr("「サイズ」の W に 100% を入れるか、横並びの中なら矢印ボタンで「残りを埋める」をオンにします。"), needs: "any", prepare: { right: "style", section: "style-layout" } },
    ],
    see: ["d-units", "layout-max-width", "d-no-fixed-height"],
  },
  {
    id: "layout-max-width",
    cat: "layout",
    level: 2,
    q: tr("パソコンで横に広がりすぎないようにしたい"),
    a: tr("中身を入れるボックスに**「最大幅」（例: 1080px）**を付け、親の「配置」で中央に寄せます。"),
    keys: [tr("最大幅"), "max-width", tr("コンテンツ幅"), tr("広がりすぎ"), tr("中央")],
    ctx: ["box"],
    body: [
      { fig: "max-width" },
      { rule: tr("文章は 640〜760px、カードの並びは 1080〜1200px くらいの最大幅が目安です。背景は画面いっぱい、中身は最大幅、の二重の箱が定番です。"), title: tr("中身の幅の目安") },
    ],
    guide: [
      { target: "style-layout", text: tr("「サイズ」の右のボタンを押し、「最大幅」を入れます。"), needs: "container", prepare: { right: "style", section: "style-layout" } },
    ],
    see: ["d-line-length", "layout-center"],
  },
  {
    id: "layout-grid",
    cat: "layout",
    level: 2,
    q: tr("カードを2列・3列に並べたい"),
    a: tr("カードを入れたボックスを選び、フローを「グリッド」にして「列」に数を入れます。"),
    keys: [tr("グリッド"), tr("列"), tr("カード"), tr("タイル"), tr("2列"), tr("3列"), tr("マス目")],
    ctx: ["box", "list"],
    body: [
      { fig: "grid-responsive" },
      { p: tr("入りきらない分は次の行へ回ります。「間隔」で列の間と行の間を別々に決められます。") },
      { rule: tr("パソコンで3列でも、スマホでは1列に。[[resp-basics|スマホの表示]]に切り替えて「列」だけ変えれば、パソコンの3列はそのままです。"), title: tr("画面幅に合わせて列を減らす") },
    ],
    guide: [
      { target: "canvas", text: tr("カードが入っているボックスを選びます。"), needs: "container" },
      { target: "style-layout", text: tr("フローの右端（グリッド）を押し、「列」に並べたい数を入れます。"), prepare: { right: "style", section: "style-layout" }, done: (s) => style(s, "display") === "grid" },
    ],
    see: ["resp-stack", "data-list"],
  },
  {
    id: "layout-wrap",
    cat: "layout",
    level: 2,
    q: tr("横並びが入りきらないときに次の行へ折り返したい"),
    a: tr("水平フローのボックスで「折り返す」にチェックを入れます。"),
    keys: [tr("折り返し"), "wrap", tr("はみ出す"), tr("横並び"), tr("タグ")],
    ctx: ["box"],
    body: [
      { fig: "wrap" },
      { note: tr("タグのように数が決まっていない並びに向いています。カード3枚など数が決まっているなら [[layout-grid|グリッド]] のほうが列がそろいます。") },
    ],
    guide: [
      { target: "style-layout", text: tr("水平フローのときに出る「折り返す」にチェックを入れます。"), needs: "container", prepare: { right: "style", section: "style-layout" } },
    ],
  },
  {
    id: "layout-height",
    cat: "layout",
    level: 2,
    q: tr("画面の高さいっぱいの大きな見出し部分を作りたい"),
    a: tr("ボックスの「最小高さ」を 100vh（画面の高さ）にし、中身を「配置」で中央に寄せます。"),
    keys: [tr("高さ"), tr("ファーストビュー"), tr("ヒーロー"), tr("画面いっぱい"), "vh", tr("全画面")],
    ctx: ["box"],
    body: [
      { fig: "min-height-vh" },
      { rule: tr("「高さ」に固定値を入れると、文字が増えたときやスマホで折り返したときにはみ出します。高さを決めたいときは「最小高さ」を使います。"), title: tr("高さは最小高さで") },
    ],
    see: ["d-no-fixed-height", "d-units", "layout-center"],
  },
  {
    id: "layout-position",
    cat: "layout",
    level: 3,
    q: tr("要素を自由な位置に置きたい・ほかの要素に重ねたい"),
    a: tr("「位置」を「カスタム」にすると、親を基準にX・Yで位置を決められます。重ねる文字やバッジなど、**ほかの要素の流れから外したいときだけ**使います。"),
    keys: [tr("自由配置"), tr("重ねる"), "absolute", tr("位置"), tr("座標"), tr("バッジ")],
    ctx: ["box", "image", "text"],
    body: [
      { fig: "position-custom" },
      { p: tr("基準を「画面全体」にすると、画面に対して固定されます。前後の重なりは「重なり順」で変えます。") },
      { rule: tr("位置はふだん「並べ方」（フロー・配置・余白）で決め、カスタムは本当に重ねたいものだけにします。画面幅が変わると、ほかの要素と重なりやすいためです。"), title: tr("自由配置は最後の手段") },
    ],
    guide: [
      { target: "style-position", text: tr("「位置」で「カスタム」を選び、X・Y と基準点を決めます。"), needs: "any", prepare: { right: "style", section: "style-position" } },
    ],
    see: ["d-flow-not-absolute", "layout-sticky"],
  },
  {
    id: "layout-sticky",
    cat: "layout",
    level: 3,
    q: tr("スクロールしてもヘッダーを画面の上に表示し続けたい"),
    a: tr("ヘッダーのボックスの「位置」を「追従」にすると、スクロールして上端に来たところで止まり、表示され続けます。"),
    keys: [tr("追従"), tr("固定"), tr("ヘッダー固定"), "sticky", "fixed", tr("スクロール")],
    ctx: ["box"],
    body: [
      { fig: "sticky" },
      { p: tr("追従は、ページの直下に置いたヘッダーで効きます。ほかの要素の下に隠れるときは「重なり順」を前面へ上げます。") },
      { rule: tr("追従するヘッダーは、スマホでは画面の多くを占めます。スマホでは高さを抑えることも考えましょう。") },
    ],
    guide: [
      { target: "style-position", text: tr("「位置」で「追従」を選び、「上端から」の距離を入れます。"), needs: "container", prepare: { right: "style", section: "style-position" } },
    ],
    see: ["layout-position"],
  },
  {
    id: "layout-overflow",
    cat: "layout",
    level: 3,
    q: tr("はみ出した部分を隠したい・その部分だけスクロールさせたい"),
    a: tr("「レイアウト」の「はみ出し」を「隠す」または「スクロール」にします。"),
    keys: [tr("はみ出し"), "overflow", tr("スクロール"), tr("隠す"), tr("切り取る")],
    ctx: ["box"],
    body: [
      { p: tr("角を丸くしたボックスの中の画像が角からはみ出すときも、「隠す」にすると角に沿って切り取られます。") },
      { warn: tr("横にはみ出す要素があると、スマホでページ全体が横に揺れる原因になります。はみ出しを隠す前に、はみ出している要素の幅を見直しましょう（公開前チェックでも知らせます）。") },
    ],
    see: ["d-units", "look-radius"],
  },

  /* ================= 色と見た目 ================= */
  {
    id: "look-color",
    cat: "look",
    level: 1,
    q: tr("背景色や文字の色を変えたい"),
    a: tr("背景は「スタイル」の「背景」で「色」を選び、文字の色は「テキスト」の「色」で変えます。"),
    keys: [tr("色"), tr("背景色"), tr("文字色"), tr("カラー"), tr("塗り")],
    ctx: ["box", "text", "body"],
    body: [
      { p: tr("色の欄は、色見本から選ぶほか、#2563eb のようなコードも入れられます。右の数字は不透明度です。") },
      { rule: tr("色はベース・メイン・アクセントの3つにしぼり、文字と背景にははっきり明るさの差を付けます（[[d-color|色の選び方]]）。"), title: tr("色は3つにしぼる") },
    ],
    guide: [
      { target: "style-background", text: tr("「背景」で「色」を選び、色を決めます。"), needs: "any", prepare: { right: "style", section: "style-background" } },
      { target: "style-typography", text: tr("文字の色は「テキスト」の「色」で変えます。"), prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-color", "look-bg-image"],
  },
  {
    id: "look-bg-image",
    cat: "look",
    level: 2,
    q: tr("背景に画像やグラデーションを敷きたい"),
    a: tr("「背景」で「画像」または「グラデーション」を選びます。画像はアセットから選ぶか、新しくアップロードできます。"),
    keys: [tr("背景画像"), tr("グラデーション"), tr("背景"), tr("写真"), tr("カバー")],
    ctx: ["box", "body"],
    body: [
      { p: tr("「サイズ」をカバーにすると隙間なく埋まり、はみ出した部分は切れます。「位置」で、切れるときにどこを見せるかを決めます。") },
      { rule: tr("写真の上に文字を載せるときは、文字を入れたボックスの背景を半透明の黒にします。どんな写真でも文字が読めるようになります。"), title: tr("写真の上の文字") },
      { note: tr("日付や会場など大事な内容は、背景画像に描かず文字で置きます。検索や読み上げで伝わり、スマホでも読めます。") },
    ],
    guide: [
      { target: "style-background", text: tr("「背景」で「画像」か「グラデーション」を選びます。"), needs: "any", prepare: { right: "style", section: "style-background" } },
    ],
    see: ["look-color", "d-images"],
  },
  {
    id: "look-radius",
    cat: "look",
    level: 2,
    q: tr("角を丸くしたい・影を付けたい"),
    a: tr("角は「外見」の「角の丸み」、影は「エフェクト」の「＋」から「ドロップシャドウ」を追加します。"),
    keys: [tr("角丸"), tr("丸く"), tr("影"), tr("影"), tr("ドロップシャドウ"), tr("立体")],
    ctx: ["box", "image"],
    body: [
      { fig: "shadow" },
      { rule: tr("影は「ぼかしを大きく・色を薄く」が上品に見えるコツです（例: Y 4px・ぼかし 16px・不透明度 10%前後）。角の丸みと影はサイト全体でそろえます。"), title: tr("影と角丸") },
      { note: tr("丸い画像にするには、幅と高さをそろえて角の丸みを大きな数（999px など）にします。") },
    ],
    guide: [
      { target: "style-appearance", text: tr("「外見」の「角の丸み」に数値を入れます。"), needs: "any", prepare: { right: "style", section: "style-appearance" } },
      { target: "style-effects", text: tr("影は「エフェクト」の右上の「＋」から追加します。"), prepare: { right: "style", section: "style-effects" } },
    ],
    see: ["d-consistency", "look-border"],
  },
  {
    id: "look-border",
    cat: "look",
    level: 1,
    q: tr("枠線を付けたい"),
    a: tr("「スタイル」の「線」で太さを入れると枠線が付きます。スタイル（実線・破線など）と色も選べます。"),
    keys: [tr("枠線"), tr("線"), tr("ボーダー"), "border", tr("囲む")],
    ctx: ["box", "image"],
    body: [
      { rule: tr("区切りは線を増やすより、余白や背景色の差で表すほうがすっきりします。線を使うときは、薄いグレーの1pxが基本です。") },
    ],
    guide: [
      { target: "style-border", text: tr("「線」の太さに数値を入れます。"), needs: "any", prepare: { right: "style", section: "style-border" } },
    ],
    see: ["look-radius", "d-hierarchy"],
  },
  {
    id: "look-hover",
    cat: "look",
    level: 2,
    q: tr("マウスを乗せたときに色を変えたい（ホバー）"),
    a: tr("右パネル上部の**「状態」を「ホバー」に切り替えてから**、色などを変えます。変えた設定はマウスを乗せている間だけ効きます。"),
    keys: [tr("ホバー"), tr("マウスオーバー"), tr("状態"), tr("押したとき"), "hover", "active"],
    ctx: ["box", "text"],
    body: [
      { fig: "states" },
      { p: tr("状態を切り替えてから変えた設定は、その状態のときだけ効きます。終わったら「既定」に戻しておきましょう。色の変化をなめらかにするには [[look-animation|モーション]] で「状態が変わったとき」を追加します。") },
      { rule: tr("スマホにはホバーがありません。ホバーしないと分からない情報は作らず、「押せることが分かる」程度の変化にとどめます。"), title: tr("ホバーに頼らない") },
    ],
    guide: [
      { target: "style-state", text: tr("「状態」で「ホバー」を選びます。"), needs: "any", prepare: { right: "style" }, done: (s) => s.styleState === "hover" },
      { target: "style-background", text: tr("背景色などを変えます。この変更はホバーのときだけ効きます。"), prepare: { right: "style", section: "style-background" } },
      { target: "preview", text: tr("プレビューでマウスを乗せて確かめます。終わったら「状態」を「既定」に戻しておきましょう。") },
    ],
    see: ["look-animation", "d-accessibility"],
  },
  {
    id: "look-animation",
    cat: "look",
    level: 3,
    q: tr("表示されたときにふわっと出したい（アニメーション）"),
    a: tr("「スタイル」の「モーション」の「＋」で動きを追加し、きっかけを「画面に入ったとき」や「ページを開いたときに再生」にします。"),
    keys: [tr("アニメーション"), tr("モーション"), tr("フェード"), tr("動き"), tr("スクロール"), tr("トランジション")],
    ctx: ["box", "text", "image"],
    body: [
      {
        table: {
          head: [tr("きっかけ"), tr("動くとき")],
          rows: [
            [tr("状態が変わったとき"), tr("ホバーなどで見た目が変わるとき（変化をなめらかにする）")],
            [tr("ホバーしたときに再生 / 押したときに再生"), tr("マウスを乗せた・押したとき")],
            [tr("ページを開いたときに再生"), tr("ページを開いたとき")],
            [tr("画面に入ったとき"), tr("スクロールして見えたとき（1回）")],
          ],
        },
      },
      { rule: tr("動きは0.2〜0.5秒くらいが心地よい長さです。見出しや画像など要所だけを動かします。"), title: tr("動きは短く、少なく") },
    ],
    guide: [
      { target: "style-motion", text: tr("「モーション」の右上の「＋」で追加し、きっかけと動きを選びます。"), needs: "any", prepare: { right: "style", section: "style-motion" } },
      { target: "preview", text: tr("動きはプレビューで確かめます。") },
    ],
    see: ["look-hover", "d-performance"],
  },
  {
    id: "look-effects",
    cat: "look",
    level: 3,
    q: tr("半透明・すりガラス・白黒などの効果を付けたい"),
    a: tr("「外見」の「不透明度」で半透明に、「エフェクト」の「背景ぼかし」ですりガラス風に、「グレースケール」で白黒にできます。"),
    keys: [tr("半透明"), tr("透明"), tr("すりガラス"), tr("ぼかし"), tr("白黒"), tr("フィルター"), tr("ブレンド")],
    ctx: ["box", "image"],
    body: [
      { p: tr("「背景ぼかし」は、要素の後ろにあるものをぼかします。背景色を半透明（60〜80%）にした要素に付けると、すりガラスのように見えます。") },
      { warn: tr("ぼかしや影を多くの要素に付けると、スマホで動きが重くなることがあります。") },
    ],
    guide: [
      { target: "style-effects", text: tr("「エフェクト」で効果を設定します。"), needs: "any", prepare: { right: "style", section: "style-effects" } },
    ],
  },
  {
    id: "look-transform",
    cat: "look",
    level: 3,
    q: tr("要素を少しずらす・拡大する・傾けたい（transform）"),
    a: tr("「エフェクト」の「＋」から「変形」を足すと、移動・拡大・回転・傾きと、その基準点を設定できます。まわりの要素の配置は変わりません。"),
    keys: ["transform", tr("変形"), tr("拡大"), tr("縮小"), tr("回転"), tr("傾き"), tr("移動"), tr("ずらす")],
    ctx: ["box", "image"],
    body: [
      { p: tr("状態を「ホバー」にして「拡大」を105%にし、モーションで「状態の変化」を付けると、ポインターを乗せたときにふわっと大きくなるボタンやカードを作れます。") },
      { note: tr("移動を%にすると、要素自身の大きさに対する割合になります（-50%で自分の幅の半分だけ左へ）。") },
    ],
    guide: [
      { target: "style-effects", text: tr("「エフェクト」の「＋」から「変形」を選びます。"), needs: "any", prepare: { right: "style", section: "style-effects" } },
    ],
    see: ["look-hover", "look-animation"],
  },
  {
    id: "form-fields",
    cat: "element",
    level: 2,
    q: tr("入力欄・チェックボックス・スイッチ・スライダーを設定したい"),
    a: tr("入力欄を選び、右パネルの「設定」の「フォーム部品」で種類・初期値・案内文・必須などを、「スタイル」の「入力欄」でチェックやスライダーの色などを変えます。"),
    keys: [tr("入力欄"), tr("フォーム"), tr("チェックボックス"), tr("ラジオボタン"), tr("スライダー"), "input", "accent-color", tr("初期値"), tr("プレースホルダー")],
    body: [
      { p: tr("初期値・プレースホルダー・表示テキスト・選択肢には {変数} を書けます。取得したデータや、ほかの入力欄の値（{ID}）を入れられます。") },
      { p: tr("数値・スライダー・日付では最小・最大・刻みを、文字の欄では最大文字数を決められます。「必須」にすると、空のままでは送信できません。") },
      { p: tr("チェックボックス・スイッチの {ID} は、チェックしているとき true、していないとき false です。スクリプトの「もし」で比べるときは「オン」「オフ」から選べます。") },
      { p: tr("ラジオボタンは「グループ」を同じにすると1つだけ選べます。{グループ名} が選んだボタンの値（表示テキスト）、{ID} がそのボタンを選んでいるかの true / false になります。") },
      { note: tr("「変数を探す」の「詳細を表示」で、無効かどうか（{ID.disabled}）・文字数（{ID.length}）・選んだ番号（{ID.index}）も選べます。スクリプトの「［入力欄］を［有効にする / 無効にする］」で切り替えられます。") },
    ],
    see: ["act-vars", "data-search"],
  },
  {
    id: "look-custom-css",
    cat: "look",
    level: 4,
    q: tr("パネルにないCSSを書きたい"),
    a: tr("「スタイル」の一番下の「カスタムCSS」に、`プロパティ: 値;` の形で書きます。"),
    keys: ["CSS", tr("カスタムCSS"), tr("コード"), "clip-path"],
    body: [
      { code: "clip-path: circle(50%);\nscroll-margin-top: 80px;" },
      { warn: tr("カスタムCSSは画面幅・状態の切り替えに関係なく、いつも効きます。画面幅ごとに変えたい設定は、できるだけパネルで行います。") },
    ],
    guide: [
      { target: "style-css", text: tr("ここにCSSを書きます。"), needs: "any", prepare: { right: "style", section: "style-css" } },
    ],
  },

  /* ================= 画像と動画 ================= */
  {
    id: "img-add",
    cat: "image",
    level: 1,
    q: tr("画像を入れたい"),
    a: tr("「アセット」タブで画像をアップロードし、押すかキャンバスへドラッグして置きます。パソコンの画像ファイルをキャンバスに直接ドロップしても入ります。"),
    keys: [tr("画像"), tr("写真"), tr("アップロード"), tr("アセット"), tr("ドロップ"), tr("貼り付け")],
    ctx: ["none", "image"],
    body: [
      { p: tr("画像を選んだ状態でアセットを押すと差し替わります。Figmaなどでコピーした画像やSVGは ⌘V で貼り付けられます。") },
      { rule: tr("写真は横幅2000px以内・1枚500KB以内にしてからアップロードします。大きすぎる画像は、表示を遅くするいちばんの原因です。"), title: tr("画像は軽くしてから") },
      { note: tr("1ファイル25MBまで保存できます。全体の容量は、Cloudflare の無料プランでは1GBまでです。使っていないものは「未使用を削除」でまとめて消せます。") },
    ],
    guide: [
      { target: "left-tab-assets", text: tr("「アセット」タブを開きます。"), done: (s) => s.leftTab === "assets" },
      { target: "asset-upload", text: tr("ここを押すか、画像ファイルをドロップしてアップロードします。"), prepare: { left: "assets" } },
      { target: "assets-panel", text: tr("アップロードした画像を押すと、選んでいる場所に入ります。キャンバスへドラッグしてもかまいません。"), prepare: { left: "assets" } },
    ],
    see: ["img-fit", "img-alt", "d-images"],
  },
  {
    id: "img-fit",
    cat: "image",
    level: 2,
    q: tr("画像の大きさや縦横比をそろえたい（切り抜き）"),
    a: tr("画像を選び、「スタイル」の「画像」で縦横比を選び、**「切り抜き方」を「枠を埋める」**にします。比率の違う写真も同じ形にそろいます。"),
    keys: [tr("切り抜き"), tr("トリミング"), tr("縦横比"), tr("比率"), "object-fit", tr("正方形"), tr("サムネイル")],
    ctx: ["image"],
    body: [
      { fig: "object-fit", caption: tr("同じ正方形の写真を、横長の枠に入れたときの見え方") },
      { p: tr("写真は「枠を埋める」、ロゴは「全体を表示」が基本です。「見せる位置」で、切れるときに残す場所を選べます（人物なら上寄り）。") },
      { rule: tr("並べる画像は縦横比をそろえるだけで整って見えます。写真は 4:3 や 16:9、商品やアイコンは 1:1 がよく使われます。"), title: tr("並べる画像は比率をそろえる") },
    ],
    guide: [
      { target: "style-image", text: tr("「画像」で縦横比を選び、「切り抜き方」を決めます。"), needs: "image", prepare: { right: "style", section: "style-image" } },
    ],
    see: ["img-add", "layout-grid"],
  },
  {
    id: "img-alt",
    cat: "image",
    level: 1,
    q: tr("代替テキスト（alt）には何を書けばいい？"),
    a: tr("画像が見えない人に、**その画像が伝えている内容を一文で説明**します。右パネルの「設定」の「代替テキスト」に入れます。"),
    keys: ["alt", tr("代替テキスト"), tr("アクセシビリティ"), tr("読み上げ")],
    ctx: ["image"],
    body: [
      { fig: "alt-text" },
      {
        table: {
          head: [tr("画像"), tr("代替テキストの例")],
          rows: [
            [tr("お店の写真"), tr("木のテーブルが並ぶ、明るい店内")],
            [tr("ロゴ"), tr("ひだまりカフェ（サイト名をそのまま）")],
            [tr("文字の入った画像"), tr("画像の中の文字をそのまま")],
            [tr("飾りの線・模様"), tr("空欄でもよい（伝える内容がないため）")],
          ],
        },
      },
      { rule: tr("「画像」「写真」とだけ書くのは避け、何が写っていて何を伝えたいかを書きます。"), title: tr("altの書き方") },
    ],
    guide: [
      { target: "settings-image", text: tr("「代替テキスト」に画像の説明を入れます。"), needs: "image", prepare: { right: "settings" } },
    ],
    see: ["d-accessibility", "img-add"],
  },
  {
    id: "img-media",
    cat: "image",
    level: 2,
    q: tr("動画・YouTube・地図を埋め込みたい"),
    a: tr("「追加」タブの「メディア・埋め込み」から、動画・音声・YouTube・マップを置き、右パネルの「設定」でURLや場所を入れます。"),
    keys: [tr("動画"), "YouTube", tr("地図"), tr("マップ"), tr("埋め込み"), tr("音声"), "iframe"],
    ctx: ["media"],
    body: [
      { p: tr("YouTubeは動画のURL、マップは住所や場所の名前を入れるだけです。動画・音声のファイルはアセットから選べます。") },
      { rule: tr("自動再生の動画は、音が出ない設定（ミュート）でしか再生されません。音を聞かせたいものは、訪問者が自分で再生するようにします。") },
    ],
    guide: [{ target: "add-panel", text: tr("「メディア・埋め込み」から置きたいものを選びます。"), prepare: { left: "add" } }],
  },
  {
    id: "img-icon",
    cat: "image",
    level: 1,
    q: tr("アイコンを使いたい"),
    a: tr("「追加」タブの「アイコン」を置き、右パネルの「設定」で英語で検索して選びます。色は文字の色、大きさはサイズで変えます。"),
    keys: [tr("アイコン"), tr("マーク"), tr("記号"), "icon"],
    body: [
      { p: tr("色は「テキスト」の「色」、大きさは「レイアウト」のサイズで決めます。自分で作ったアイコンは、SVGをアセットにアップロードして画像として置きます。") },
      { rule: tr("アイコンだけでは意味が伝わりにくいことがあります。大事な操作には、短い文字を添えます。") },
    ],
    see: ["img-add"],
  },

  /* ================= スマホ対応 ================= */
  {
    id: "resp-basics",
    cat: "responsive",
    level: 1,
    q: tr("スマホでの見え方を確認・調整したい"),
    a: tr("上のバーで「スマホ」に切り替えると、キャンバスがスマホの幅になります。この状態で変えた設定は**スマホにだけ効き**、パソコンの見た目は変わりません。"),
    keys: [tr("スマホ"), tr("レスポンシブ"), tr("モバイル"), tr("タブレット"), tr("画面幅"), tr("ブレークポイント")],
    ctx: ["mobile"],
    body: [
      { fig: "breakpoint-cascade" },
      { p: tr("切り替えたときのキャンバスは、その区切りの幅ちょうど（スマホなら 478px）になります。スマホ用の設定が効くいちばん広い幅なので、実際のスマホより広めです。") },
      { note: tr("幅の欄の右のボタンから、小さいスマホ（360px）や大きいスマホ（430px）の幅でも確かめられます。狭い端末で文字や余白が窮屈にならないかを見ておくと安心です。") },
      { p: tr("パソコン以外で変えた設定は、右パネルでオレンジ色になります（パソコンは青）。項目名を右クリックすると、その画面幅の変更だけを取り消せます。") },
      { rule: tr("スマホで見る人のほうが多いサイトがほとんどです。大事なページは、まずスマホで確かめる習慣を。"), title: tr("スマホで確かめる") },
    ],
    guide: [
      { target: "breakpoint-{mobile}", text: tr("上のバーで「スマホ」を押します。"), done: (s) => s.breakpoint !== "base" },
      { target: "bp-bar", text: tr("どの画面幅を編集しているかがここに出ます。この状態の変更は、この幅以下の画面にだけ効きます。") },
      { target: "canvas-width", text: tr("幅を直接入れたり、キャンバスの左右の端をドラッグしたりして、ほかの幅でも確かめられます。") },
    ],
    see: ["resp-stack", "resp-hide", "resp-reset"],
  },
  {
    id: "resp-stack",
    cat: "responsive",
    level: 2,
    q: tr("スマホでは横並びを縦並びにしたい"),
    a: tr("スマホの表示に切り替えてから、横並びの親を選び、**フローを垂直フロー（↓）**にします。パソコンでは横並びのままです。"),
    keys: [tr("縦並び"), tr("スマホで縦"), tr("折り返し"), tr("1列"), tr("スタック")],
    ctx: ["mobile", "box"],
    body: [
      { fig: "stack-mobile" },
      { p: tr("グリッドなら、スマホの表示で「列」を1にします。") },
      { rule: tr("スマホの横幅に横並びで入るのは、ボタン2つやアイコン数個くらいまで。カードや「画像＋文章」は縦に積みます。") },
    ],
    guide: [
      { target: "breakpoint-{mobile}", text: tr("上のバーで「スマホ」に切り替えます。"), done: (s) => s.breakpoint !== "base" },
      { target: "canvas", text: tr("横並びになっている親のボックスを選びます。"), needs: "container" },
      {
        target: "style-layout",
        text: tr("フローの下向きの矢印（垂直フロー）を押します。この変更はスマホにだけ効きます。"),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => s.breakpoint !== "base" && (style(s, "flexDirection") ?? "").startsWith("column"),
      },
    ],
    see: ["layout-row", "layout-grid", "resp-basics"],
  },
  {
    id: "resp-hide",
    cat: "responsive",
    level: 2,
    q: tr("スマホだけ・パソコンだけに表示したい"),
    a: tr("要素を選び、「スタイル」の一番上の「表示するデバイス」で、表示しない画面のボタンをオフにします。"),
    keys: [tr("非表示"), tr("スマホだけ"), tr("パソコンだけ"), tr("表示しない"), tr("デバイス")],
    ctx: ["mobile", "box", "image"],
    body: [
      { fig: "device-visibility" },
      { p: tr("ボタンは左からパソコン・タブレット・スマホ横向き・スマホです。隠した要素も、レイヤーには薄く残ります。") },
      { rule: tr("スマホで情報を減らしすぎないように。隠すのは「大きなメニューを小さなボタンに置き換える」など、別の形で同じ情報を見せるときが基本です。") },
    ],
    guide: [
      { target: "style-visibility", text: tr("表示しない画面のボタンを押してオフにします。"), needs: "any", prepare: { right: "style" } },
    ],
    see: ["act-menu", "el-lock"],
  },
  {
    id: "resp-font",
    cat: "responsive",
    level: 2,
    q: tr("スマホで文字が大きすぎる・小さすぎる"),
    a: tr("スマホの表示に切り替えて文字を選び、「テキスト」のサイズを変えます。パソコンの文字の大きさは変わりません。"),
    keys: [tr("スマホ 文字"), tr("文字が大きい"), tr("文字が小さい"), tr("改行位置")],
    ctx: ["mobile", "text"],
    body: [
      { rule: tr("スマホでも本文は16px前後を保ちます。12px未満の文字は読みにくく、公開前チェックで知らせます。見出しは画面幅に合わせて小さくします（例: パソコン48px → スマホ28px）。"), title: tr("スマホの文字の大きさ") },
      { p: tr("見出しの改行位置がおかしいときは、文字の途中で改行を入れるより、スマホで文字を少し小さくするほうがきれいに収まります。") },
    ],
    guide: [
      { target: "breakpoint-{mobile}", text: tr("「スマホ」に切り替えます。"), done: (s) => s.breakpoint !== "base" },
      { target: "style-typography", text: tr("文字を選び、「テキスト」のサイズを変えます。"), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-type-scale", "resp-basics"],
  },
  {
    id: "resp-reset",
    cat: "responsive",
    level: 3,
    q: tr("スマホ用に変えた設定を元に戻したい（青・オレンジの色の意味）"),
    a: tr("変えた項目は名前が色付きになります。**その項目名を右クリック**すると、いま表示している画面幅での変更が取り消され、大きい画面の設定に戻ります。"),
    keys: [tr("リセット"), tr("取り消し"), tr("右クリック"), tr("オレンジ"), tr("青"), tr("上書き")],
    ctx: ["mobile"],
    body: [
      {
        list: [
          tr("**青** … パソコン（すべての画面）で変えた設定"),
          tr("**オレンジ** … パソコン以外の画面幅で上書きした設定"),
          tr("**閉じたセクションの見出しの色** … 中に変更した設定がある"),
        ],
      },
      { p: tr("数値の欄を空にして確定すると、スマホなどでは「設定なし」の値で打ち消します。大きい画面の設定に戻したいときは、右クリックを使います。") },
    ],
    see: ["resp-basics"],
  },
  {
    id: "resp-breakpoints",
    cat: "responsive",
    level: 4,
    q: tr("ブレークポイント（画面幅の区切り）を変えたい・増やしたい"),
    a: tr("左パネルの「サイト」タブの「ブレークポイント」で、名前と幅を変えたり、追加・削除したりできます。"),
    keys: [tr("ブレークポイント"), tr("画面幅"), tr("区切り"), tr("タブレット"), tr("メディアクエリ")],
    body: [
      { fig: "breakpoint-cascade" },
      { warn: tr("ブレークポイントを削除すると、その画面幅用に変えたスタイルも消えます（⌘Z で戻せます）。") },
      { rule: tr("区切りは「機種」ではなく「見た目が崩れ始める幅」で決めます。多すぎると管理が大変になるので、パソコン・タブレット・スマホの3〜4段階が一般的です。") },
    ],
    guide: [
      { target: "site-breakpoints", text: tr("名前と幅を変えたり、追加・削除したりできます。"), prepare: { left: "site", section: "site-breakpoints" } },
    ],
    see: ["resp-basics"],
  },

  /* ================= リンクと動き ================= */
  {
    id: "act-link",
    cat: "action",
    level: 1,
    q: tr("ボタンを押したら別のページへ移動させたい（リンク）"),
    a: tr("ボタンを選んで「設定」の「ページのスクリプトを編集」を開き、「クリックしたとき」の下に「［ページ / URL］を開く」をつなげます。"),
    keys: [tr("リンク"), tr("ページ移動"), tr("遷移"), tr("飛ぶ"), tr("クリック"), "URL", tr("ボタン")],
    ctx: ["box", "text", "image"],
    body: [
      { fig: "script-blocks" },
      { p: tr("「クリックしたとき → 開く」だけの組み合わせは、公開サイトではふつうのリンクになります。外部サイトへは、［ページ］を「URL」に切り替えてアドレスを入れます。") },
      { rule: tr("リンクの文字は「こちら」ではなく「申し込みフォームへ」のように行き先が分かる言葉に。読み上げソフトはリンクだけを続けて読むことがあります。"), title: tr("リンクの文字") },
    ],
    guide: [
      { target: "canvas", text: tr("リンクを付けたいボタン（要素）を選びます。"), needs: "any" },
      { target: "right-tab-settings", text: tr("右のパネルの「設定」を開きます。"), done: (s) => s.rightTab === "settings" },
      { target: "settings-link", text: tr("「ページのスクリプトを編集」を押します。"), prepare: { right: "settings" }, done: (s) => !!s.scriptEditor },
      {
        target: "se-block-click",
        text: tr("左のブロック一覧の「クリックしたとき」を、右の広い場所へドラッグします。"),
        hint: tr("ブロック一覧が閉じているときは、左上のボタンで開きます。"),
        done: (s) => !!node(s)?.link || !!node(s)?.scripts?.some((sc) => sc.trigger === "click"),
      },
      {
        target: "se-block-open-page",
        text: tr("「［ページ / URL］を開く」を、置いた「クリックしたとき」のすぐ下へドラッグしてつなげます。"),
        done: (s) => hasScript(s, ["open-page", "open-url"]),
      },
      {
        target: "se-workspace",
        text: tr("つないだブロックで、開きたいページを選びます。外部サイトなら「URL」に切り替えてアドレスを入れます。"),
        done: (s) => {
          const l = node(s)?.link;
          return !!(l && (l.pageId || l.url));
        },
      },
      { target: "preview", text: tr("スクリプト画面を閉じ、プレビューで押して確かめます。"), prepare: { closeScripts: true } },
    ],
    see: ["act-anchor", "act-external", "act-script"],
  },
  {
    id: "act-anchor",
    cat: "action",
    level: 2,
    q: tr("ページ内の特定の場所へスクロールさせたい"),
    a: tr("移動先の要素に「ID属性」（例: access）を付け、ボタンのスクリプトで「［要素］までスクロールする」を使います。"),
    keys: [tr("ページ内リンク"), tr("アンカー"), tr("スクロール"), "ID", tr("目次"), "#"],
    ctx: ["box", "text"],
    body: [
      { p: tr("ID属性はページの中で重ならない半角英数字にします。別のページの特定の場所へは、URLを「/ページのURL#ID」にします。") },
      { rule: tr("上に追従するヘッダーがあると、移動先の見出しが隠れます。移動先のカスタムCSSに `scroll-margin-top: 80px;` のようにヘッダーの高さ分を入れます。") },
    ],
    guide: [
      { target: "settings-id", text: tr("移動先の要素を選び、「ID属性」に名前を付けます。"), needs: "any", prepare: { right: "settings" } },
      { target: "settings-link", text: tr("次に、押すボタンを選んでスクリプトを開き、「クリックしたとき」の下に「［要素］までスクロールする」をつなげます。"), prepare: { right: "settings" } },
    ],
    see: ["act-link", "act-script"],
  },
  {
    id: "act-external",
    cat: "action",
    level: 2,
    q: tr("外部のサイトを新しいタブで開きたい"),
    a: tr("「［ページ / URL］を開く」でURLを入れ、「新しいタブ」にチェックを入れます。"),
    keys: [tr("新しいタブ"), tr("別タブ"), tr("外部リンク"), "target", "blank"],
    body: [
      { rule: tr("新しいタブで開くのは、外部のサイトやPDFなど「元のページに戻ってきてほしいもの」だけにします。サイト内のページまで新しいタブで開くと、タブが増えて戻り方が分からなくなります。"), title: tr("新しいタブの使いどころ") },
    ],
    see: ["act-link"],
  },
  {
    id: "act-menu",
    cat: "action",
    level: 3,
    q: tr("メニューを開け閉めしたい（表示の切り替え）"),
    a: tr("メニューの要素にID属性を付けて最初は隠しておき、ボタンのスクリプトで「［要素］を［切り替える］」を使います。"),
    keys: [tr("ハンバーガー"), tr("メニュー"), tr("開閉"), tr("トグル"), tr("表示切替"), tr("ドロワー"), tr("アコーディオン")],
    ctx: ["box"],
    body: [
      { fig: "toggle-menu" },
      {
        list: [
          tr("メニューに ID属性 を付ける（例: menu）"),
          tr("「表示するデバイス」で、最初は隠す画面幅をオフにする"),
          tr("開くボタンのスクリプトで「クリックしたとき」の下に「［要素］を［切り替える］」をつなげ、メニューを選ぶ"),
        ],
        ordered: true,
      },
      { note: tr("よくある質問の開け閉め（アコーディオン）も同じ作り方です。動きは [[act-preview|プレビュー]] で確かめます。") },
    ],
    guide: [
      { target: "settings-id", text: tr("隠したり出したりする要素を選び、ID属性を付けます。"), needs: "any", prepare: { right: "settings" } },
      { target: "style-visibility", text: tr("「表示するデバイス」で、最初は隠しておく画面幅をオフにします。"), prepare: { right: "style" } },
      { target: "settings-link", text: tr("開くボタンを選び、スクリプトを開いて「［要素］を［切り替える］」をつなげます。"), prepare: { right: "settings" } },
    ],
    see: ["resp-hide", "act-script"],
  },
  {
    id: "act-preview",
    cat: "action",
    level: 1,
    q: tr("リンクや動きを試したい（プレビュー）"),
    a: tr("上のバーの「プレビュー」を押すと、選択枠が消え、公開したときと同じようにボタンやリンクを操作できます。"),
    keys: [tr("プレビュー"), tr("確認"), tr("試す"), tr("動作確認")],
    body: [
      { p: tr("デザイン画面ではスクリプトやアニメーションは動きません。プレビューで確かめ、戻るときは「デザイン」を押します。") },
    ],
    guide: [{ target: "preview", text: tr("「プレビュー」を押します。戻るときは「デザイン」です。"), done: (s) => s.mode === "preview" }],
    see: ["pub-publish"],
  },
  {
    id: "act-script",
    cat: "action",
    level: 3,
    q: tr("スクリプトのしくみを知りたい（きっかけと動作）"),
    a: tr("スクリプトは「いつ」（きっかけ）と「何をするか」（動作）のブロックを上から順につなげたものです。ページ内のすべてのスクリプトを、1つの画面でまとめて編集します。"),
    keys: [tr("スクリプト"), tr("ブロック"), tr("きっかけ"), tr("きっかけ"), tr("プログラミング"), tr("条件"), tr("もし")],
    body: [
      { fig: "script-blocks" },
      {
        table: {
          head: [tr("きっかけ"), tr("動くとき")],
          rows: [
            [tr("クリックしたとき"), tr("要素を押したとき")],
            [tr("ホバーし始めたとき / 外れたとき"), tr("マウスが乗った・離れたとき")],
            [tr("値が変わったとき"), tr("入力欄・選択肢の値が変わったとき")],
            [tr("ページを開いたとき"), tr("ページの表示時（「このページ」ではデータの取得も）")],
            [tr("画面に入ったとき"), tr("スクロールして見えたとき")],
          ],
        },
      },
      { p: tr("動作はきっかけの下へドラッグしてつなげ、一覧へ戻すと削除です。「もし［条件］なら」で分岐、「くり返す」でくり返しができます。") },
      { rule: tr("1つのスクリプトに動作を詰め込まず、目的ごとに分けると、あとから直しやすくなります。") },
    ],
    guide: [
      { target: "page-scripts", text: tr("何も選んでいないときのページ設定からも、ページのスクリプト画面を開けます。"), prepare: { deselect: true, section: "page-scripts" } },
    ],
    see: ["act-link", "act-vars", "data-fetch"],
  },
  {
    id: "act-vars",
    cat: "action",
    level: 4,
    q: tr("入力された文字やデータを、別の場所に表示したい（変数）"),
    a: tr("文字の中に {名前} と書くと、その名前の値に置き換わります。入力欄なら ID属性 が名前になり、データなら {データ名.項目} で使えます。"),
    keys: [tr("変数"), "{", tr("差し込み"), tr("置き換え"), "ID", tr("テンプレート")],
    ctx: ["text", "field"],
    body: [
      {
        table: {
          head: [tr("書き方"), tr("置き換わる値")],
          rows: [
            ["{name}", tr("ID属性が name の入力欄の値（または文字）")],
            ["{slug}", tr("[slug] ページで、URLのその部分")],
            [tr("{商品.title}"), tr("取得したデータ「商品」の title")],
            ["{tab}", tr("ページのURLの「?tab=…」の値")],
          ],
        },
      },
      { p: tr("文字の入力中に「{」を打つと候補が出ます（⌘/ で一覧）。デザイン画面では {名前} のまま表示し、プレビューで実際の値になります。文字として「{」を出すときは「\\{」と書きます。") },
    ],
    see: ["data-fetch", "act-script"],
  },

  /* ================= データとリスト ================= */
  {
    id: "data-fetch",
    cat: "data",
    level: 4,
    q: tr("外部のデータ（JSON）を取得してページに表示したい"),
    a: tr("ページのスクリプトに「［URL］のデータを取得して［名前］とする」を置き、文字や画像に {名前.項目} と書きます。"),
    keys: ["JSON", "API", tr("データ取得"), tr("外部データ"), "fetch", tr("データソース")],
    ctx: ["none"],
    body: [
      { fig: "fetch-data" },
      { p: tr("取得したデータに「お知らせ」と名前を付けたら、文字に `{お知らせ.title}`、画像のURLに `{お知らせ.image}` のように書きます。") },
      { p: tr("公開サイトでは、ページを配信する前にサーバーでデータを取得するので、表示が速く、検索エンジンにも内容が伝わります。取り直す間隔は「サイト」タブの「ホスティングとデータの更新」で決めます。") },
      { note: tr("ブロックの「データを見る」で中身を表で確かめられます。エディタの見本データを最新にしたいときは、URLを入れ直します。") },
    ],
    guide: [
      { target: "page-scripts", text: tr("何も選んでいない状態で、ページ設定の「スクリプト」から「スクリプトを編集」を開きます。"), prepare: { deselect: true, section: "page-scripts" }, done: (s) => !!s.scriptEditor },
      { target: "se-block-fetch", text: tr("「［URL］のデータを取得して［名前］とする」を右の広い場所へドラッグし、URLと名前を入れます。") },
    ],
    see: ["data-list", "act-vars", "data-detail"],
  },
  {
    id: "data-list",
    cat: "data",
    level: 4,
    q: tr("データを一覧で並べたい（リスト）"),
    a: tr("取得したデータの中の一覧を、スクリプトの「［値］を変数［］とする」で変数に入れ、「リスト」要素の「並べる配列」で選びます。リストの1つ目のカードがお手本になります。"),
    keys: [tr("リスト"), tr("一覧"), tr("繰り返し"), tr("配列"), tr("カード"), tr("お知らせ一覧")],
    ctx: ["list", "box"],
    body: [
      { fig: "list-repeat" },
      {
        list: [
          tr("ページのスクリプトでデータを取得する（[[data-fetch|データの取得]]）"),
          tr("「［値 / {データ.位置}］を変数［］とする」で、データの中の一覧に名前を付ける（例: {お知らせ.items} を「記事」とする）"),
          tr("お手本にするカード（ボックス）を作り、右クリックの「リスト化」でリストにする"),
          tr("リストの「設定」の「並べる配列」で「記事」を選ぶ"),
          tr("カードの中の文字に {title} のように項目名を書く"),
        ],
        ordered: true,
      },
      { note: tr("「表示件数」で数を制限できます。並べ替えや絞り込みは、スクリプトの並べ替え・絞り込みのブロックで行います。") },
    ],
    guide: [
      { target: "settings-make", text: tr("お手本にするボックスを選び、「リスト化」を押します。"), needs: "container", prepare: { right: "settings" } },
    ],
    see: ["data-fetch", "data-detail", "data-search", "img-fit"],
  },
  {
    id: "data-detail",
    cat: "data",
    level: 4,
    q: tr("一覧から1件ずつの詳細ページを作りたい（[slug]）"),
    a: tr("URLに [slug] を含むページ（例: news/[slug]）を1つ作ると、データの1件ごとにページができます。ページの中では {slug} でURLのその部分を使えます。"),
    keys: [tr("詳細ページ"), "slug", tr("動的ページ"), tr("個別ページ"), "[slug]"],
    body: [
      { fig: "slug-pages" },
      {
        list: [
          tr("URLを `news/[slug]` にしたページを作る"),
          tr("そのページのスクリプトで、{slug} を使ってデータを取得する（例: https://api.example.com/news/{slug}）か、一覧のデータから「配列［］の要素のうち、項目［id］が［{slug}］のものを変数［］とする」で1件を探す"),
          tr("一覧のカードのリンク先を `/news/{id}` のようにする"),
        ],
        ordered: true,
      },
      { note: tr("キャンバスの上の「表示中のデータ」で、エディタで見る1件を選べます。一致するデータがないURLは404になります。") },
    ],
    see: ["data-list", "page-404"],
  },
  {
    id: "data-search",
    cat: "data",
    level: 4,
    q: tr("検索・絞り込み・並べ替えを付けたい"),
    a: tr("ボックスの意味付けを「検索フォーム」にして入力欄と送信ボタンを入れると、入力した値がURLに付き、データ取得のURLで {ID} として使えます。画面上での絞り込み・並べ替えはスクリプトのブロックで作ります。"),
    keys: [tr("検索"), tr("絞り込み"), tr("並べ替え"), tr("フィルター"), tr("ソート"), tr("フォーム")],
    body: [
      { p: tr("入力欄のID属性が「q」なら、データ取得のURLに `?q={q}` と書けます。送信すると、ページを開き直さずに結果だけが更新されます。") },
      { p: tr("取得済みの一覧を画面上で絞り込むときは、「クリックしたとき」「値が変わったとき」に「配列［］を［項目］で絞り込む」をつなげます。") },
      { note: tr("新しく作ったサイトの「商品一覧（デモ）」ページに、検索・一覧・詳細ページの見本があります。") },
    ],
    see: ["data-list", "act-vars"],
  },
  {
    id: "data-storage",
    cat: "data",
    level: 4,
    q: tr("お気に入りなど、訪問者ごとの情報をブラウザに保存したい"),
    a: tr("スクリプトの「ストレージの［キー］に［値］を保存する」で保存し、「ストレージの［キー］を読み込んで変数［］とする」で読み出します。"),
    keys: [tr("ストレージ"), tr("保存"), "localStorage", tr("クッキー"), tr("お気に入り")],
    body: [
      { p: tr("保存した値は訪問者のブラウザにだけ残り、ほかの人には見えません。サーバーには送られないので、個人情報の保存には使わないでください。") },
      { p: tr("「変数［］の［.］区切りに［値］を［切り替える］」と組み合わせると、お気に入りの追加・解除を作れます。") },
    ],
    see: ["act-vars", "act-script"],
  },

  /* ================= 部品の使い回し ================= */
  {
    id: "reuse-component",
    cat: "reuse",
    level: 2,
    q: tr("ヘッダーやフッターを全ページで使い回したい（コンポーネント）"),
    a: tr("ヘッダーのボックスを右クリックして「コンポーネント化」します。「追加」タブのコンポーネント一覧から、ほかのページにも置けます。**1か所直すと、すべてのページに反映されます**。"),
    keys: [tr("コンポーネント"), tr("共通"), tr("使い回し"), tr("ヘッダー"), tr("フッター"), tr("部品"), tr("インスタンス")],
    ctx: ["box", "instance", "component"],
    body: [
      { fig: "component-sync" },
      { p: tr("置いたもの（インスタンス）をダブルクリックすると、元（マスター）の編集になります。終わったら上の「完了」を押します。") },
      { rule: tr("同じものを2回作ったら、コンポーネント化を考えます。コピーで増やすと、直すときに全部を探すことになります。"), title: tr("2回目でコンポーネントに") },
      { warn: tr("コンポーネントを削除すると、各ページに置いたものもすべて消えます。") },
    ],
    guide: [
      { target: "settings-make", text: tr("使い回したいボックスを選び、「コンポーネント化」を押します。"), needs: "container", prepare: { right: "settings" } },
      { target: "add-components", text: tr("作ったコンポーネントは「追加」タブの下にあります。押すと挿入先に置かれます。"), prepare: { left: "add" } },
    ],
    see: ["reuse-detach", "d-consistency"],
  },
  {
    id: "reuse-detach",
    cat: "reuse",
    level: 3,
    q: tr("コンポーネントの1か所だけ違う内容にしたい"),
    a: tr("そのインスタンスを選び、右パネルの「インスタンスを解除」を押すと、ふつうの要素に戻り、ほかと関係なく編集できます。"),
    keys: [tr("インスタンス解除"), tr("切り離し"), tr("デタッチ"), tr("一部だけ")],
    ctx: ["instance"],
    body: [
      { p: tr("解除した要素は、その後マスターを直しても変わりません。") },
      { note: tr("ちょっとした違い（今いるページの項目だけ色を変える など）なら、解除せずにスクリプトや表示の切り替えで作れることもあります。") },
    ],
    guide: [{ target: "settings-component", text: tr("「インスタンスを解除」を押します。") }],
    see: ["reuse-component"],
  },

  /* ================= 公開と管理 ================= */
  {
    id: "pub-publish",
    cat: "publish",
    level: 1,
    q: tr("サイトを公開したい"),
    a: tr("右上の「公開」を押し、公開前チェックを確かめてから「**テストに公開**」か「**本番に公開**」を押します。"),
    keys: [tr("公開"), tr("反映"), tr("本番"), tr("テスト"), tr("デプロイ"), tr("アップロード")],
    body: [
      { fig: "publish-flow" },
      { p: tr("テストに公開すると、本番と同じリポジトリの**別のブランチ**（既定は preview）にコミットされ、ホスティングサービスがプレビュー用のURLで公開します。しくみは [[pub-preview|テスト公開のしくみ]] を見てください。") },
      { p: tr("数分でサイトに反映されます。右下の「未公開の変更あり」で、本番に出ていない変更があるか分かります。下書きのページは公開されません。") },
      { rule: tr("大きな変更は、まず**テストサイトに公開してスマホでも確かめてから**本番へ。失敗しても [[pub-history|公開履歴]] からすぐに前の版へ戻せます。"), title: tr("テストで確かめてから本番へ") },
    ],
    guide: [
      { target: "publish", text: tr("「公開」を押します。") },
      { target: "publish-status", text: tr("公開した後に変更すると、ここが「未公開の変更あり」になります。") },
    ],
    see: ["pub-checks", "pub-history", "pub-preview", "page-draft"],
  },
  {
    id: "pub-history",
    cat: "publish",
    level: 2,
    q: tr("公開したサイトを前の状態に戻したい（ロールバック）"),
    a: tr("「公開」の画面の「**公開履歴・ロールバック**」か、「…」メニューの「履歴」で、戻したい版の「**サイトを戻す**」を押します。"),
    keys: [tr("ロールバック"), tr("戻す"), tr("公開履歴"), tr("前の版"), tr("元に戻す")],
    body: [
      { fig: "rollback" },
      {
        table: {
          head: [tr("ボタン"), tr("戻るもの")],
          rows: [
            [tr("サイトを戻す"), tr("公開しているサイト。選んだ版と同じ内容を、新しい公開として積みます")],
            [tr("編集内容を復元"), tr("エディタの編集内容。その版を公開した時点の内容をエディタに読み込みます（⌘Z で戻せます）")],
          ],
        },
      },
      { warn: tr("「サイトを戻す」だけでは、エディタの編集内容はそのままです。そのまま次に公開すると、いまの編集内容で上書きされます。**編集内容も戻すときは「編集内容を復元」も使います**。") },
      { note: tr("反映されるまでの時間は、ふつうの公開と同じです（ホスティング側のビルドが終わったら反映されます）。") },
    ],
    guide: [
      { target: "publish", text: tr("「公開」を押し、下の「公開履歴・ロールバック」を開きます。") },
    ],
    see: ["pub-publish", "pub-restore"],
  },
  {
    id: "pub-checks",
    cat: "publish",
    level: 2,
    q: tr("公開前チェックの警告はどう直す？"),
    a: tr("**赤いもの（エラー）は直さないと公開できません**。黄色いもの（警告）は公開できますが、見る人や検索エンジンのために直すのがおすすめです。項目の「解説」から理由と直し方を確かめられます。"),
    keys: [tr("公開前チェック"), tr("エラー"), tr("警告"), tr("チェック")],
    body: [
      {
        table: {
          head: [tr("よくある項目"), tr("直し方")],
          rows: [
            [tr("URLが重複しています"), tr("どちらかのページのURLを変える（[[page-url|URL]]）")],
            [tr("代替テキスト（alt）が未設定"), tr("画像の「設定」で説明を入れる（[[img-alt|alt]]）")],
            [tr("見出し1（h1）がありません"), tr("ページの題名を見出し1にする（[[text-heading|見出し]]）")],
            [tr("スマホの画面より広い固定幅"), tr("幅を%にするか最大幅を付ける（[[d-units|単位]]）")],
            [tr("文字が12px未満"), tr("スマホでも読める大きさにする（[[d-type-scale|文字サイズ]]）")],
          ],
        },
      },
    ],
    see: ["pub-publish"],
  },
  {
    id: "pub-site",
    cat: "publish",
    level: 2,
    q: tr("サイト名・ファビコン・共有画像を設定したい"),
    a: tr("左のパネルの「サイト」タブの「サイト設定」で、サイト名・サイトURL・ファビコン（タブのアイコン）・ホーム画面アイコン・デフォルトのシェア用画像を決めます。"),
    keys: [tr("サイト名"), tr("ファビコン"), "favicon", tr("アイコン"), "OGP", tr("サイトURL")],
    ctx: ["site"],
    body: [
      {
        table: {
          head: [tr("項目"), tr("目安")],
          rows: [
            [tr("ファビコン"), tr("正方形のPNG・SVG（512×512pxくらいで作ると安心）")],
            [tr("ホーム画面アイコン"), tr("180×180pxのPNG")],
            [tr("シェア用画像"), "1200×630px"],
          ],
        },
      },
      { p: tr("サイトURLは、シェア用画像のアドレスなどを正しく作るために使います。公開するドメイン（https://〜）を入れます。") },
    ],
    guide: [
      { target: "site-basics", text: tr("「サイト設定」で各項目を入れます。"), prepare: { left: "site", section: "site-basics" } },
    ],
    see: ["page-seo", "pub-pwa"],
  },
  {
    id: "pub-backup",
    cat: "publish",
    level: 2,
    q: tr("バックアップを取りたい・前の状態に戻したい"),
    a: tr("サーバーには**7日分の自動バックアップ**が残り、「…」メニューの「履歴」から戻せます。ファイルに残すときは「サイト」タブの「バックアップ」で「書き出す」を使います。"),
    keys: [tr("バックアップ"), tr("復元"), tr("書き出し"), tr("読み込み"), "JSON"],
    ctx: ["site"],
    body: [
      { p: tr("公開したときにリポジトリに保存される `_tsumu/doc.json` も読み込めます。") },
      { warn: tr("読み込むと、いまの編集内容はすべて置き換わります（直後なら ⌘Z で戻せます）。念のため先に「書き出す」でいまの状態を保存しておきましょう。") },
      { rule: tr("大きな作り直しの前や公開の前には、バックアップを書き出しておく習慣をつけると安心です。") },
    ],
    guide: [
      { target: "site-backup", text: tr("「書き出す」でファイルに保存、「読み込む」で戻します。"), prepare: { left: "site", section: "site-backup" } },
    ],
    see: ["pub-restore", "start-save"],
  },
  {
    id: "pub-restore",
    cat: "publish",
    level: 2,
    q: tr("間違えて消した・壊した編集内容を、前の日の状態に戻したい"),
    a: tr("「…」メニューの「**履歴**」の「編集データの自動バックアップ」で、戻したい日の「この内容に戻す」を押します。戻したあとも **⌘Z で今の内容に戻せます**。"),
    keys: [tr("復元"), tr("バックアップ"), tr("前の日"), tr("消えた"), tr("履歴")],
    body: [
      {
        table: {
          head: [tr("戻し方"), tr("内容")],
          rows: [
            [tr("編集データの自動バックアップ"), tr("サーバーが1日1回自動で残す内容（曜日ごとに7日分）")],
            [tr("公開履歴の「編集内容を復元」"), tr("その版を公開した時点の編集内容")],
            [tr("サイトタブの「バックアップ」"), tr("自分で書き出したファイル")],
          ],
        },
      },
      { p: tr("直前の操作なら、まず **⌘Z（元に戻す）** を試します。100回分まで戻せます。") },
      { note: tr("戻した内容はサーバーにも保存され、同時に編集しているほかの人の画面にも反映されます。") },
    ],
    guide: [
      { target: "menu", text: tr("右上の「…」メニューから「履歴」を開きます。") },
    ],
    see: ["start-undo", "pub-backup", "pub-history"],
  },
  {
    id: "pub-accounts",
    cat: "publish",
    level: 2,
    q: tr("ほかの人もエディタにログインできるようにしたい"),
    a: tr("右上の「…」メニューの「**設定**」で、ログインを許可するGoogleアカウントのメールアドレスを追加します。"),
    keys: [tr("アカウント"), tr("ログイン"), tr("ユーザー追加"), tr("権限"), tr("メンバー")],
    body: [
      { p: tr("追加した人は、次にログインしたときから使えます。許可を取り消しても、ログイン中の人はしばらく使えることがあります。") },
      { note: tr("「固定」と出ているアカウントはサーバーの設定で決まっていて、ここからは消せません。") },
    ],
    guide: [{ target: "menu", text: tr("右上の「…」メニューから「設定」を開き、メールアドレスを追加します。") }],
    see: ["start-collab"],
  },
  {
    id: "pub-zip",
    cat: "publish",
    level: 4,
    q: tr("サイトのデータを書き出して自分で動かしたい（zip）"),
    a: tr("右上の「…」メニューの「**zipでエクスポート**」で、Next.js のプロジェクトとして書き出せます。展開して `npm install && npm run dev` で動きます。"),
    keys: ["zip", tr("エクスポート"), tr("書き出し"), "Next.js", tr("ダウンロード")],
    body: [
      { p: tr("このエディタで作ったサイトは、ふつうの Next.js のプロジェクトです。エディタがなくても、書き出したファイルを編集・公開できます。") },
    ],
    guide: [{ target: "menu", text: tr("右上の「…」メニューの「zipでエクスポート」で書き出します。") }],
  },
  {
    id: "pub-preview",
    cat: "publish",
    level: 4,
    q: tr("テスト公開はどんなしくみ？"),
    a: tr("テスト公開は、本番と**同じリポジトリの別のブランチ**（既定は preview）にコミットします。Vercel や Cloudflare などは本番以外のブランチを**プレビュー用のURL**で自動的に公開します。"),
    keys: [tr("テスト"), tr("プレビュー"), tr("ブランチ"), tr("確認用"), "noindex"],
    body: [
      { fig: "branch-publish" },
      { p: tr("テストサイトは検索エンジンに載らないよう、robots.txt・noindex・クローラーの拒否を重ねて書き出します。本番とは別のブランチなので、テストの内容が本番に出ることはありません。") },
      {
        table: {
          head: [tr("ホスティング"), tr("プレビューの設定")],
          rows: [
            ["Vercel", tr("設定不要（ブランチごとに自動でプレビューURLが付く）")],
            ["Cloudflare Workers Builds", tr("「Non-production branch deploy command」を `npx opennextjs-cloudflare upload` にする")],
            ["Netlify", tr("「Branch deploys」を有効にする")],
          ],
        },
      },
      { note: tr("ブランチ名やプレビューのURLは、ホーム画面の「サイトの設定」でサイトごとに決めます。") },
    ],
    see: ["pub-publish", "pub-hosting"],
  },
  {
    id: "pub-hosting",
    cat: "publish",
    level: 4,
    q: tr("公開先はCloudflare以外でもいい？（データの更新間隔）"),
    a: tr("書き出すのは**ふつうの Next.js のプロジェクト**なので、Vercel・Netlify・Node.js・Cloudflare Workers のどれでも動きます。Cloudflare で公開するときは、「サイト」タブの「ホスティングとデータの更新」で、公開先のホスティングを **Cloudflare Workers** にします。"),
    keys: [tr("ホスティング"), "Vercel", "Cloudflare", "Netlify", "ISR", tr("更新間隔"), tr("サーバー")],
    body: [
      {
        table: {
          head: [tr("公開先のホスティング"), tr("外部のJSONを使うページ")],
          rows: [
            [tr("標準（Vercel など）"), tr("ページを作り置き、更新間隔ごとに裏で作り直す（ISR）。表示が速い")],
            ["Cloudflare Workers", tr("アクセスのたびにページを描画し、取得したJSONを更新間隔のあいだCloudflareのキャッシュに置く")],
          ],
        },
      },
      { warn: tr("Cloudflare Workers で「標準」のまま公開すると、作り置きのページが**いつまでも作り直されません**（ISR に必要なキャッシュの設定が無いため）。") },
      { note: tr("更新間隔を 0 にすると、どのホスティングでもアクセスのたびに最新のデータを取得します。") },
    ],
    guide: [
      { target: "site-hosting", text: tr("「ホスティングとデータの更新」の「公開先のホスティング」で選びます。"), prepare: { left: "site", section: "site-hosting" } },
    ],
    see: ["data-fetch", "pub-preview", "pub-zip"],
  },
  {
    id: "pub-pwa",
    cat: "publish",
    level: 3,
    q: tr("ローディング画面を出したい・スマホのホーム画面に追加できるようにしたい"),
    a: tr("「サイト」タブの「サイト設定」で「ローディング画面を表示する」「PWAとして公開する」をオンにします。"),
    keys: [tr("ローディング"), tr("読み込み画面"), "PWA", tr("ホーム画面"), tr("アプリ")],
    ctx: ["site"],
    body: [
      { p: tr("ローディング画面は、ページと同じようにキャンバスで作れます。「同じタブでは初回だけ表示する」をオンにすると、ページを移動するたびには出ません。PWAのアイコンは512×512pxの正方形PNGがおすすめです。") },
      { rule: tr("ローディング画面は短く（0.5〜1秒）します。待たされる時間が長いほど、訪問者は離れていきます。") },
    ],
    guide: [
      { target: "site-loading", text: tr("「ローディング画面を表示する」をオンにし、「ローディング画面を編集」で中身を作ります。"), prepare: { left: "site", section: "site-basics" } },
      { target: "site-pwa", text: tr("「PWAとして公開する」をオンにして、アプリ名やアイコンを決めます。"), prepare: { left: "site", section: "site-basics" } },
    ],
    see: ["pub-site"],
  },

  /* ================= Webデザインの基本 ================= */
  {
    id: "d-units",
    cat: "design",
    level: 2,
    q: tr("px・%・rem・vw はどう使い分ける？"),
    a: tr("親に合わせて伸び縮みさせたい幅は %、文字の大きさは px か rem、画面に合わせたい大きさは vw・vh、決まった大きさのもの（アイコン・線の太さ）は px を使います。"),
    keys: [tr("単位"), "px", "%", tr("パーセント"), "rem", "em", "vw", "vh", tr("固定"), tr("可変")],
    ctx: ["box", "image", "mobile"],
    body: [
      { fig: "units-compare", caption: tr("幅を px で固定すると、スマホ（幅375pxほど）からはみ出します。幅は % で親に合わせ、上限を最大幅で決めます。") },
      {
        table: {
          head: [tr("単位"), tr("基準"), tr("向いているもの")],
          rows: [
            ["px", tr("固定の大きさ"), tr("アイコン・線の太さ・角の丸み・余白・最大幅")],
            ["%", tr("親の大きさ"), tr("伸び縮みさせたい幅（100% で親いっぱい）")],
            ["rem", tr("サイトの基本の文字（16px）"), tr("文字の大きさ（1rem = 16px）")],
            ["em", tr("その要素の文字の大きさ"), tr("字間（0.05em）、文字に合わせた余白")],
            ["vw / vh", tr("画面の幅 / 高さ"), tr("画面いっぱいの見出し部分（100vh）")],
            [tr("単位なし"), tr("その要素の文字の大きさ"), tr("行間（1.8）")],
          ],
        },
      },
      { rule: tr("高さを % にしても、親の高さが決まっていないと効きません。高さはふだん空欄（中身に合わせる）にしておき、必要なら「最小高さ」を使います。"), title: tr("高さの % は効かないことが多い") },
      { note: tr("単位の文字を押すと、いまの見た目のまま数値が換算されて単位が切り替わります。") },
    ],
    see: ["layout-width", "layout-max-width", "layout-height", "d-no-fixed-height"],
  },
  {
    id: "d-spacing",
    cat: "design",
    level: 2,
    q: tr("余白の大きさはどう決める？"),
    a: tr("4・8・16・24・32・48・64px のように、**決まった刻み（8の倍数）**から選びます。近いものは狭く、別のまとまりは広く空けます。"),
    keys: [tr("余白"), "8px", tr("グリッド"), tr("スペーシング"), tr("間隔"), tr("揃える")],
    ctx: ["box"],
    body: [
      { fig: "spacing-scale" },
      { rule: tr("余白は決まった刻み（8の倍数）から選び、関係の深いもの（見出しと本文）は近く、別のまとまりは大きく離します。余白の大小だけで、どれがひとまとまりかが伝わります。"), title: tr("刻みを決めて、近いものは近くに") },
      {
        table: {
          head: [tr("場所"), tr("目安")],
          rows: [
            [tr("ボタンの中"), tr("上下12px・左右24px")],
            [tr("カードの中"), "16〜24px"],
            [tr("見出しと本文の間"), "8〜16px"],
            [tr("セクションどうし"), tr("パソコン80〜120px / スマホ48〜64px")],
            [tr("画面の端と中身"), tr("スマホでも16〜20pxは空ける")],
          ],
        },
      },
    ],
    see: ["layout-gap", "layout-spacing", "d-hierarchy"],
  },
  {
    id: "d-type-scale",
    cat: "design",
    level: 2,
    q: tr("文字の大きさの目安は？"),
    a: tr("**本文は16px**（スマホも同じ）を基準に、見出しは段ごとに1.25〜1.5倍ずつ大きくします。小さい文字でも12px以上にします。"),
    keys: [tr("文字サイズ"), tr("フォントサイズ"), "16px", tr("見出しの大きさ"), tr("ジャンプ率")],
    ctx: ["text", "mobile"],
    body: [
      { fig: "type-scale", caption: tr("パソコンでの大きさの例。スマホでは見出しだけ小さくします。") },
      {
        table: {
          head: [tr("種類"), tr("パソコン"), tr("スマホ")],
          rows: [
            [tr("見出し1（ページの題名）"), "40〜56px", "28〜36px"],
            [tr("見出し2（区切り）"), "28〜36px", "22〜26px"],
            [tr("見出し3"), "20〜24px", "18〜20px"],
            [tr("本文"), "16px", "16px"],
            [tr("注釈・補足"), "12〜14px", "12〜14px"],
          ],
        },
      },
      { rule: tr("見出しと本文の大きさの差（ジャンプ率）を大きくすると力強く、小さくすると落ち着いた印象になります。イベントや宣伝のページは大きめ、案内や規約は小さめが合います。"), title: tr("大きさの差で印象が変わる") },
      { note: tr("スマホの入力欄の文字が16px未満だと、iPhoneでは入力のたびに画面が拡大されてしまいます。") },
    ],
    see: ["text-size", "resp-font", "text-heading"],
  },
  {
    id: "d-line-length",
    cat: "design",
    level: 2,
    q: tr("長い文章を読みやすくするには？"),
    a: tr("1行は全角35〜45文字くらいに収まる幅（640〜760px）にし、行間を1.7〜1.9にします。段落の間は1行分ほど空けます。"),
    keys: [tr("読みやすさ"), tr("1行の長さ"), tr("文字数"), tr("行間"), tr("段落"), tr("文章")],
    ctx: ["text"],
    body: [
      { fig: "line-length" },
      { rule: tr("画面いっぱいに広がった文章は、行の終わりから次の行の頭へ目を戻すのが大変で、読み飛ばしが増えます。文章のボックスには最大幅を付けます。"), title: tr("1行を長くしない") },
      { rule: tr("長い文章は3〜4行ごとに段落を分け、見出しを挟みます。スマホでは画面の何倍もの長さになるので、要点を先に書きます。"), title: tr("要点を先に、段落を短く") },
    ],
    see: ["layout-max-width", "text-spacing"],
  },
  {
    id: "d-color",
    cat: "design",
    level: 2,
    q: tr("色の選び方と組み合わせは？"),
    a: tr("ベース7割・メイン2.5割・アクセント0.5割くらいの割合で、**3色を中心に**使います。文字と背景ははっきり明るさの差を付けます。"),
    keys: [tr("配色"), tr("色の組み合わせ"), tr("コントラスト"), tr("カラー"), "70:25:5"],
    ctx: ["box", "text"],
    body: [
      { fig: "color-ratio" },
      { rule: tr("文字と背景の明るさの差（コントラスト）が小さいと、日差しの下のスマホや、色の見え方が違う人には読めません。本文は濃いグレー〜黒の文字を白っぽい背景に置くのが最も確実です。"), title: tr("コントラストを確保する") },
      { rule: tr("色だけで意味を伝えないようにします（例: 赤い文字だけで「締切」を表さず、「締切」と書く）。"), title: tr("色だけに頼らない") },
      { note: tr("決めた色は使い続けます。色の欄の「最近使った色」から選ぶと、少しずつ違う色になるのを防げます。") },
    ],
    see: ["look-color", "d-accessibility"],
  },
  {
    id: "d-fonts",
    cat: "design",
    level: 2,
    q: tr("フォントの選び方は？"),
    a: tr("**使うのは2種類まで**。本文は読みやすいゴシック体、見出しでサイトの雰囲気を出すのが定番です。太さで強弱を付ければ、種類を増やさなくても変化を出せます。"),
    keys: [tr("フォント"), tr("書体"), tr("ゴシック"), tr("明朝"), tr("太さ")],
    ctx: ["text", "body"],
    body: [
      {
        table: {
          head: [tr("種類"), tr("印象"), tr("向いている場面")],
          rows: [
            [tr("ゴシック体"), tr("読みやすい・親しみ"), tr("本文・案内・ボタン")],
            [tr("明朝体"), tr("上品・落ち着き"), tr("見出し・格式のある案内")],
            [tr("手書き・ポップ体"), tr("にぎやか・個性"), tr("大きな見出しだけ（本文には使わない）")],
          ],
        },
      },
      { rule: tr("太さは「標準400」と「太い700」の2つを中心に使います。細い文字（300以下）は小さいサイズやスマホでかすれて読みにくくなります。") },
    ],
    see: ["text-font", "d-performance"],
  },
  {
    id: "d-hierarchy",
    cat: "design",
    level: 1,
    q: tr("大事なことを目立たせるには？（情報の優先順位）"),
    a: tr("**いちばん伝えたいことを1つに決め**、それを大きく・上に・余白を広く置きます。全部を目立たせると、何も目立たなくなります。"),
    keys: [tr("目立たせる"), tr("強調"), tr("優先順位"), tr("レイアウト"), tr("伝わる")],
    ctx: ["none", "box"],
    body: [
      { fig: "hierarchy" },
      { rule: tr("人の目は左上から右下へ、スマホでは上から下へ流れます。結論（日時・場所・申し込み方法など）を先に置き、詳しい説明は後ろにします。"), title: tr("結論が先") },
      { rule: tr("まとまりの区切りは、線を引くより余白を広げたり背景色を変えたりするほうが、すっきり伝わります。"), title: tr("余白で区切る") },
    ],
    see: ["d-spacing", "d-type-scale", "d-color"],
  },
  {
    id: "d-mobile",
    cat: "design",
    level: 2,
    q: tr("スマホで使いやすくするには？"),
    a: tr("押す部分は指で押しやすい大きさ（**高さ44px以上**）にし、横並びは縦に積み、画面の端と中身の間に16px以上の余白を取ります。"),
    keys: [tr("スマホ"), tr("タップ"), tr("押しやすい"), "44px", tr("モバイルファースト"), tr("親指")],
    ctx: ["mobile"],
    body: [
      { fig: "tap-target", caption: tr("点線の円が指先の大きさ（約44px）。小さいボタンは押し間違いが増えます。") },
      { rule: tr("パソコンで横に並べていたものは縦に積み、文字は16pxを保ちます。画面の端と中身の間は16px以上空けます。"), title: tr("縦に積む") },
      { rule: tr("ホバー（マウスを乗せる）はスマホにはありません。押せるものは、ふだんから押せると分かる見た目（ボタンの形・色・下線）にします。"), title: tr("ホバーに頼らない") },
    ],
    see: ["resp-basics", "resp-stack", "layout-spacing"],
  },
  {
    id: "d-no-fixed-height",
    cat: "design",
    level: 3,
    q: tr("文字がはみ出す・重なるのはなぜ？"),
    a: tr("多くは、文字の入った箱の**「高さ」や「幅」を固定している**のが原因です。高さは空欄（中身に合わせる）にし、必要なら「最小高さ」を使います。"),
    keys: [tr("はみ出す"), tr("重なる"), tr("崩れる"), tr("高さ固定"), tr("レイアウト崩れ")],
    ctx: ["box", "text", "mobile"],
    body: [
      { fig: "fixed-height", caption: tr("スマホでは文字が折り返して行数が増えます。高さを固定した箱からはあふれ、下の要素と重なります。") },
      {
        list: [
          tr("高さに数値が入っていれば空欄にする（「最小高さ」に移す）"),
          tr("幅が px で固定されていれば % や「残りを埋める」にする"),
          tr("位置が「カスタム」になっていれば「自動」に戻せないか考える"),
          tr("スマホの表示で、大きすぎる文字や余白を小さくする"),
        ],
        ordered: true,
      },
    ],
    see: ["d-units", "layout-height", "d-flow-not-absolute"],
  },
  {
    id: "d-flow-not-absolute",
    cat: "design",
    level: 3,
    q: tr("位置はどう決めるのが崩れにくい？"),
    a: tr("要素は「並び順」と「入れ物（ボックス）」で並べ、**親の「フロー・配置・間隔」で位置を決めます**。X・Yで位置を決める「カスタム」は、重ねたいものだけに使います。"),
    keys: [tr("配置"), tr("崩れない"), tr("レイアウト"), "absolute", tr("自由配置"), tr("ずれる")],
    ctx: ["box"],
    body: [
      { fig: "flow-vs-absolute", caption: tr("画面の幅や文字の量は、見る人によって変わります。座標で置くと、条件が変わったとたんに重なります。") },
      {
        list: [
          tr("まとまりごとにボックスに入れる（ヘッダー・本文・カード…）"),
          tr("親のフローで縦か横かを決める"),
          tr("親の配置で寄せる位置、間隔ですき間を決める"),
          tr("幅は % や「残りを埋める」、上限は最大幅"),
        ],
        ordered: true,
      },
    ],
    see: ["layout-row", "layout-position", "d-no-fixed-height"],
  },
  {
    id: "d-accessibility",
    cat: "design",
    level: 3,
    q: tr("誰にでも使いやすいページにするには？（アクセシビリティ）"),
    a: tr("画像にalt、見出しは順番どおり、文字と背景のコントラスト、行き先が分かるリンクの文字、押しやすい大きさ。この5つで大きく変わります。"),
    keys: [tr("アクセシビリティ"), tr("バリアフリー"), tr("読み上げ"), "alt", tr("コントラスト"), tr("色覚")],
    body: [
      {
        list: [
          tr("**画像** … 伝える内容のある画像には [[img-alt|代替テキスト]] を書く"),
          tr("**見出し** … 見出し1から順に、段を飛ばさない（[[text-heading|見出し]]）"),
          tr("**色** … 文字と背景の明るさの差を付け、色だけで意味を伝えない（[[d-color|色]]）"),
          tr("**リンク** … 「こちら」ではなく行き先が分かる言葉にする（[[act-link|リンク]]）"),
          tr("**操作** … ホバーしないと分からない情報を作らない、押す部分を大きくする（[[d-mobile|スマホ]]）"),
        ],
      },
      { rule: tr("見えにくさ・聞こえにくさは、障害のある人だけのものではありません。日差しの下のスマホ、片手での操作、騒がしい場所など、誰にでも起こります。") },
    ],
    see: ["img-alt", "d-color", "text-heading"],
  },
  {
    id: "d-images",
    cat: "design",
    level: 3,
    q: tr("画像の形式と大きさはどう選ぶ？"),
    a: tr("写真は JPEG か WebP、ロゴやイラストは SVG か PNG。表示する大きさの2倍くらいの横幅（最大2000px）にして、**1枚500KB以内**を目安にします。"),
    keys: [tr("画像形式"), "JPEG", "PNG", "SVG", "WebP", tr("容量"), tr("重い"), tr("圧縮"), tr("ぼやける")],
    ctx: ["image"],
    body: [
      {
        table: {
          head: [tr("形式"), tr("向いているもの"), tr("注意")],
          rows: [
            ["JPEG / WebP", tr("写真"), tr("透明にできない（WebPは可）")],
            ["PNG", tr("透明部分のある画像・スクリーンショット"), tr("写真だと重くなりやすい")],
            ["SVG", tr("ロゴ・アイコン・図"), tr("拡大してもぼやけない")],
          ],
        },
      },
      { rule: tr("表示する大きさの2倍くらいの画像を用意すると、高精細な画面でもぼやけません。それ以上大きくしても見た目は変わらず、重くなるだけです。"), title: tr("大きさは表示の2倍まで") },
      { p: tr("ページを開いてすぐ見える大きな画像（ファーストビュー）は、画像の「設定」で「優先読み込み」をオンにすると早く表示されます。") },
    ],
    see: ["img-add", "d-performance"],
  },
  {
    id: "d-performance",
    cat: "design",
    level: 4,
    q: tr("ページの表示を速くするには？"),
    a: tr("画像を軽くする、フォントの種類を減らす、動きやぼかしを控える、の3つで大きく変わります。"),
    keys: [tr("速度"), tr("軽く"), tr("重い"), tr("表示速度"), tr("パフォーマンス"), tr("読み込み")],
    body: [
      {
        list: [
          tr("**画像** … 適切な形式・大きさにしてからアップロード（[[d-images|画像の選び方]]）"),
          tr("**フォント** … Google Fonts は2種類まで。日本語のフォントは特に重い"),
          tr("**効果** … 影・ぼかし・アニメーションを多用しない"),
          tr("**埋め込み** … YouTube・地図などの埋め込みは1ページに少なめに"),
          tr("**データ** … データの更新間隔を短くしすぎない（0にするとアクセスのたびに取得）"),
        ],
      },
      { rule: tr("表示に3秒以上かかると、半分以上の人がページを離れると言われています。とくにスマホの回線で確かめましょう。") },
    ],
    see: ["d-images", "d-fonts"],
  },
  {
    id: "d-seo",
    cat: "design",
    level: 3,
    q: tr("検索で見つけてもらうための基本は？"),
    a: tr("ページごとに内容が分かるタイトルと説明文を付け、見出しを正しく使い、画像にaltを書き、表示を速くする。特別な技よりも、**この基本が大切**です。"),
    keys: ["SEO", tr("検索"), "Google", tr("上位表示"), tr("検索エンジン")],
    body: [
      {
        list: [
          tr("タイトル・説明文をページごとに書く（[[page-seo|検索・シェア]]）"),
          tr("見出し1はページに1つ、内容を表す言葉で（[[text-heading|見出し]]）"),
          tr("URLは短い英単語で、一度決めたら変えない（[[page-url|URL]]）"),
          tr("画像にaltを書き、文字は画像にせず文字で置く"),
          tr("スマホで見やすく、表示が速いページにする"),
        ],
      },
      { rule: tr("検索エンジンは「訪問者に役立つページか」を見ています。探している人が知りたいこと（日時・場所・内容）をはっきり書くことがいちばんの対策です。") },
    ],
    see: ["page-seo", "d-performance"],
  },
  {
    id: "d-consistency",
    cat: "design",
    level: 2,
    q: tr("サイト全体の統一感を出すには？"),
    a: tr("色・フォント・文字の大きさ・余白・角の丸み・影の付け方を、サイト全体で数種類に決めて使い回します。"),
    keys: [tr("統一感"), tr("そろえる"), tr("デザインルール"), tr("まとまり"), tr("一貫性")],
    body: [
      { rule: tr("「ボタンは角丸8px・高さ44px・アクセント色」のように、決めたルールを全ページで守ると、プロが作ったようなまとまりが出ます。"), title: tr("ルールを決めて守る") },
      { p: tr("何度も使う部品は [[reuse-component|コンポーネント]] に、基本の文字（フォント・色・大きさ）はページの「body」に設定すると、直すときも1か所で済みます。") },
    ],
    see: ["reuse-component", "d-spacing", "d-color"],
  },
];
