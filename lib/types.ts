export type NodeType =
  | "box"
  | "image"
  | "divider"
  | "code"
  | "instance"
  | "icon"
  | "field"
  | "media"
  | "embed"
  | "list";

export type FieldKind =
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "submit";

export type InputType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "search"
  | "date"
  | "time"
  | "datetime-local"
  | "month"
  | "week"
  | "color"
  | "range";

export interface FieldContent {
  kind: FieldKind;
  /** kind="input" のときのHTML input type */
  inputType?: InputType;
  /** checkbox / radio の隣に表示するテキスト（{変数} を使える） */
  label?: string;
  /** input / textarea / select の初期値（{変数} を使える） */
  defaultValue?: string;
  /** 未入力のときに薄く出す案内文（{変数} を使える） */
  placeholder?: string;
  /** select の選択肢（{変数} を使える） */
  options?: string[];
  /** checkbox / radio: 最初からチェックしておく */
  checked?: boolean;
  /**
   * radio: グループ名（同じグループのラジオボタンから1つだけ選べる。送信するときの名前で、
   * {グループ名} が選んだボタンの値になる）
   */
  group?: string;
  /** 操作できない状態にする（disabled） */
  disabled?: boolean;
  /** 送信する前に入力が必要 */
  required?: boolean;
  /** number / range / 日付・時刻: 最小値・最大値・刻み */
  min?: string;
  max?: string;
  step?: string;
  /** 文字の入力欄・textarea: 入力できる文字数の上限 */
  maxLength?: number;
  /** textarea: 表示する行数 */
  rows?: number;
  /** file: 選べるファイルの種類（例: image/*, .pdf） */
  accept?: string;
  /** file: 複数のファイルを選べる */
  multiple?: boolean;
}

export interface MediaContent {
  kind: "video" | "audio";
  src: string;
  assetId?: string;
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
}

export interface EmbedContent {
  kind: "youtube" | "map" | "url";
  /** ユーザー入力（YouTubeのURL / 住所 / 埋め込みたいURL） */
  src: string;
}

export interface IconContent {
  /** lucide のアイコン名（kebab-case） */
  name: string;
  /** インライン展開用のSVGマークアップ */
  svg: string;
}

export interface Motion {
  id: string;
  /** state = transition、それ以外 = animation */
  trigger: "state" | "hover" | "active" | "load" | "in-view";
  /** state: 変化を監視するプロパティ */
  property?: string;
  /** animation: KEYFRAMES のキー（"custom" = customKeyframes を使用） */
  keyframes?: string;
  /** keyframes="custom" のときの @keyframes 本体（from {...} to {...}） */
  customKeyframes?: string;
  /** 秒 */
  duration: number;
  /** 秒 */
  delay: number;
  easing: string;
  /** -1 = 無限 */
  repeat?: number;
  direction?: "normal" | "reverse" | "alternate";
  fillMode?: "both" | "forwards" | "backwards" | "none";
}

export type Semantic =
  | "auto"
  | "form"
  | "button"
  | "div"
  | "section"
  | "header"
  | "footer"
  | "nav"
  | "main"
  | "article"
  | "span"
  | "custom";

/**
 * "base"（すべての画面）か、ブレークポイントのID。
 * 既定は lg（タブレット）/ md（スマホ横向き）/ sm（スマホ）で、サイト設定で追加・削除できる
 */
export type Breakpoint = string;

/** サイトのブレークポイント（この幅以下の画面に効くスタイルの区切り） */
export interface BreakpointDef {
  id: string;
  label: string;
  /** この幅以下に効く（max-width） */
  maxWidth: number;
}
export type StyleState = "default" | "hover" | "active" | "focus";

/** camelCase CSS プロパティ → 値 */
export type StyleMap = Record<string, string>;

/** ブレークポイント → 状態 → スタイル（無いブレークポイントは undefined） */
export type NodeStyles = Record<Breakpoint, Partial<Record<StyleState, StyleMap>>>;

/** UI上でbodyを通常要素と同じ選択状態にするための予約ID */
export const BODY_NODE_ID = "__body__";

export interface LinkSetting {
  kind: "url" | "page";
  url?: string;
  pageId?: string;
  newTab?: boolean;
  /** スクリプトエディタ上の位置（「クリックしたとき → 開く」として表示する） */
  pos?: ScriptPos;
}

/* ---------- スクリプト（きっかけ → 動作） ---------- */

/** 動作の対象に「この要素自身」を指定するときの予約値 */
export const SELF_TARGET = "@self";

/** スクリプト画面で、きっかけに「このページ」を指定するときの予約値 */
export const PAGE_TARGET = "@page";

export type ScriptTrigger =
  | "click"
  | "hover-start"
  | "hover-end"
  | "change"
  | "load"
  | "in-view";

export interface ScriptPos {
  x: number;
  y: number;
}

export type ScriptOp =
  | "eq"
  | "neq"
  | "contains"
  | "not-contains"
  | "starts-with"
  | "ends-with"
  | "gt"
  | "lt"
  | "empty"
  | "not-empty"
  /** 「,」区切りの値・配列のどれかと同じ */
  | "in";

export interface ScriptCond {
  /** value = 値 / checked = チェック / visible = 表示中 / hovered = ホバー中 / var = 変数 */
  subject: "value" | "checked" | "visible" | "hovered" | "var";
  /** 対象のID属性（SELF_TARGET = この要素。subject="var" では使わない） */
  target: string;
  /** subject="var" で比べる値（{変数} と文字を混ぜて書ける） */
  left?: string;
  /** subject="value" / "var" の比較方法 */
  op?: ScriptOp;
  value?: string;
  /** checked / visible / hovered を否定する */
  not?: boolean;
}

/** 配列の絞り込みの条件 */
export interface FilterCond {
  field: string;
  op: ScriptOp;
  /** {変数} は実行時の値に置き換える */
  value: string;
  /** 直前の条件と「かつ」でつなぐ（無ければ「または」） */
  and?: boolean;
}

export type ScriptStep = { id: string } & (
  | { kind: "show" | "hide" | "toggle"; target: string }
  | { kind: "open-page"; pageId: string; newTab?: boolean }
  | { kind: "open-url"; url: string; newTab?: boolean }
  | { kind: "scroll-to"; target: string }
  | { kind: "set-value"; target: string; value: string }
  /** 入力欄・ボタンを操作できる / できない状態にする（disabled） */
  | { kind: "set-enabled"; target: string; op: "enable" | "disable" | "toggle" }
  | {
      /** 配列を使うリストの項目を field の値で絞り込む（同じ項目への絞り込みは置き換え） */
      kind: "filter-array";
      /** 配列の名前 */
      array: string;
      field: string;
      op: ScriptOp;
      /** {変数} は実行時の値に置き換える */
      value: string;
      /** 「かつ」「または」で足す条件（「かつ」でつないだ組のどれか1つを満たせば残す） */
      or?: FilterCond[];
      /** 絞り込みの番号（同じ配列の中で自動で振る。同じ番号の絞り込みをもう一度動かすと置き換わる） */
      no?: number;
      /** 同じ配列にかかっているほかの絞り込みとのつなぎ方（既定 = かつ） */
      join?: "and" | "or";
    }
  | {
      kind: "unfilter-array";
      array: string;
      /** 解除する絞り込みの番号（未設定 = すべて解除） */
      no?: number;
    }
  | {
      /** 配列を使うリストの項目を field の値で並べ替える（同じ配列への並べ替えは置き換え） */
      kind: "sort-array";
      array: string;
      field: string;
      dir: "asc" | "desc";
    }
  | {
      /** ブラウザに文字列を保存する（localStorage → このホストのクッキー → メモリの順に試す） */
      kind: "store-save";
      key: string;
      /** {変数} を使える */
      value: string;
      /** 公開URLのドメインの全サブドメインで共有するクッキーにも保存する */
      shared?: boolean;
    }
  | {
      /** ブラウザに保存した文字列を変数に入れる（無ければ空） */
      kind: "store-load";
      key: string;
      into: string;
      /** 全サブドメインで共有するクッキーを先に読む */
      shared?: boolean;
    }
  | {
      /** 文字列を区切り文字で分解して配列にする */
      kind: "split";
      /** 分解する文字列（{変数} を使える） */
      source: string;
      /** 区切り文字（空 = 「,」） */
      sep: string;
      into: string;
    }
  | {
      /** 配列の要素のうち、項目 field が value の最初の1件を変数に入れる（無ければ空） */
      kind: "array-find";
      array: string;
      /** "slug" / "category.name" のような項目の位置 */
      field: string;
      /** {slug} などの {変数} を使える */
      value: string;
      into: string;
    }
  | {
      /** 配列の要素を区切り文字でつないだ文字列を変数に入れる */
      kind: "join";
      array: string;
      /** 要素がまとまり（オブジェクト）のとき、つなぐ項目の位置（空 = 要素そのもの） */
      field?: string;
      /** 区切り文字（空ならそのままつなぐ） */
      sep: string;
      into: string;
    }
  | {
      /**
       * 配列の各要素に、value の値を項目 field として入れる
       * （文字や数値の要素は {値} を持つまとまりにする）
       */
      kind: "array-field";
      array: string;
      /** 固定の値・{要素の項目}・{変数}（{項目} だけなら値をそのまま入れる） */
      value: string;
      /** 入れる項目名 */
      field: string;
    }
  | {
      /** 配列の要素の数を変数に入れる（配列でなければ 0） */
      kind: "count";
      array: string;
      into: string;
    }
  | {
      /**
       * 値を変数に入れる（{変数} と文字を混ぜて書ける）。
       * {名前} 1つだけなら値をそのまま入れる（配列・まとまりも。{データ.items.0} のような位置も使える）
       */
      kind: "set-var";
      value: string;
      into: string;
    }
  | {
      /** 文字列の中の find をすべて to に置き換えて変数に入れる（{変数} を使える） */
      kind: "replace";
      source: string;
      /** 置き換える文字（空なら置き換えない） */
      find: string;
      /** 置き換え後の文字（空 = 取り除く）。正規表現なら $1・$& も使える */
      to: string;
      into: string;
      /**
       * find を正規表現として扱う。{変数} の値は文字そのものとして埋め込み、
       * {2}・{2,}・{2,4} と \{ … } は正規表現の書き方として残す
       */
      regex?: boolean;
    }
  | {
      /** 式（+ - * / % とかっこ。{変数} を使える）を計算して変数に入れる */
      kind: "calc";
      expr: string;
      into: string;
    }
  | {
      /**
       * 区切りの文字の変数（例: "12.34.56"）に value を足す・取り除く・切り替える
       * （同じ値は2つ入れず、空の区切りは残さない）
       */
      kind: "list-edit";
      /** 書き換える変数の名前 */
      into: string;
      /** toggle = 入っていれば取り除き、無ければ足す */
      op: "add" | "remove" | "toggle";
      /** {変数} を使える */
      value: string;
      /** 区切り文字（空 = 「,」） */
      sep: string;
    }
  | {
      /** 文字をクリップボードにコピーする（{変数} を使える） */
      kind: "copy";
      value: string;
    }
  | { kind: "wait"; seconds: number }
  | {
      /** 中のブロックを times 回くり返す（0 = ずっと。止まらないよう1回ごとに少し間をあける） */
      kind: "repeat";
      times: number;
      then: ScriptStep[];
    }
  | {
      /**
       * 配列の要素ごとに中のブロックをくり返す。中では要素の項目を {項目} で使え、
       * 同じ配列への「項目として格納」はくり返し中の要素だけに入れる
       */
      kind: "for-each";
      array: string;
      then: ScriptStep[];
    }
  /*
   * データの取得。「このページ｜ページを開いたとき」の直下でだけ動き、
   * 公開サイトではページを配信する前（サーバー側）に上から順に実行する。
   * 中身は {名前.項目} で「値を変数とする」「配列の要素のうち〜」などから使う
   */
  | {
      /** URLからJSONを取得して、as の名前を付ける（{変数} を使える） */
      kind: "fetch";
      url: string;
      /** HTTPメソッド（未設定 = GET） */
      method?: FetchMethod;
      /** 送るヘッダー（値に {変数} を使える） */
      headers?: FetchHeader[];
      /** GET 以外で送る本文（JSON。{変数} を使え、文字列の中では値を JSON 用にエスケープする） */
      body?: string;
      /** 取得したデータの名前（要素では {名前.項目} としても使える） */
      as?: string;
      /** エディタで見せる取得結果の見本（配列は先頭だけ残す） */
      sample?: unknown;
      /** 見本で切り詰めた配列の、元の件数（位置 → 件数。エディタで件数を正しく出すため） */
      sampleTotals?: Record<string, number>;
      fetchedAt?: number;
    }
  | {
      kind: "if";
      cond: ScriptCond;
      then: ScriptStep[];
      /** 未定義 = 「もし〜なら」、配列 = 「もし〜なら / でなければ」 */
      else?: ScriptStep[];
    }
);

export type ScriptStepKind = ScriptStep["kind"];

export type FetchMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FetchHeader {
  name: string;
  value: string;
}

export interface Script {
  id: string;
  /** 未設定 = きっかけの無いブロックの集まり（実行されない） */
  trigger?: ScriptTrigger;
  /** hover-end: 「ホバーし始めたとき」に表示した要素の上にいる間は、外れたとしない */
  keepOnShown?: boolean;
  steps: ScriptStep[];
  pos: ScriptPos;
}

export interface TextContent {
  content: string;
  /** 0 = 本文(p) / 1〜6 = h1〜h6 */
  heading: number;
}

export interface ImageContent {
  src: string;
  alt: string;
  width: number;
  height: number;
  assetId?: string;
  priority?: boolean;
  /** false = シャドウ付きSVGのiOS Safari向けぼやけ対策を適用しない */
  crispShadow?: boolean;
}

export interface DocNode {
  id: string;
  type: NodeType;
  name: string;
  semantic: Semantic;
  /** semantic === "custom" のときに出力するタグ名（pre・aside など） */
  customTag?: string;
  text: TextContent | null;
  /** 「クリックしたとき → 開く」だけのスクリプト。a タグで出力する */
  link: LinkSetting | null;
  /** きっかけ → 動作 のスクリプト（link で表せるものは除く） */
  scripts?: Script[];
  image?: ImageContent;
  code?: { html: string };
  icon?: IconContent;
  field?: FieldContent;
  media?: MediaContent;
  embed?: EmbedContent;
  list?: ListContent;
  /** type === "instance" のとき参照するコンポーネントID */
  componentId?: string;
  children: string[];
  styles: NodeStyles;
  /** この要素に常に適用される生CSS宣言（プロパティ: 値; の並び） */
  customCss?: string;
  motions?: Motion[];
  /** 非表示にするデバイス。含まれないデバイスでは表示される */
  hiddenOn?: Breakpoint[];
  locked?: boolean;
  /**
   * ID属性。アンカーに使えるほか、フォーム部品では送信時の項目名になり、
   * テキストを持つ要素では内容が {ID} 変数として使える
   */
  attrId?: string;
}

/** URL直指定 or アセット参照のどちらかで画像を指す */
export interface ImageRef {
  url?: string;
  assetId?: string;
}

export interface Page {
  id: string;
  name: string;
  /** "" = トップページ。"blog/post-1" のような階層も可 */
  slug: string;
  /** リンク先に付けるクエリ（"?" を除いた "tab=news&page=1"）。ページでは {tab} 変数として使える */
  query?: string;
  title: string;
  /**
   * タイトルがまだ決まっていない（追加・複製した直後）しるし。
   * 初めてページ名を確定したら、タイトルもその名前にして外す（先にタイトルを書き換えても外す）。lib/pageTitle.ts
   */
  titlePending?: boolean;
  description: string;
  /** このページの言語（BCP 47 の言語コード。未設定 = サイトの言語）。lib/site-lang.ts */
  lang?: string;
  /** このページにだけ適用するbodyスタイル */
  bodyStyles?: NodeStyles;
  /** htmlの背景色（オーバースクロール時に見える色）。未設定ならbodyの背景が広がる */
  htmlBackground?: string;
  noindex?: boolean;
  /** true なら書き出し・公開に含めない（下書き） */
  unpublished?: boolean;
  /** 設定されていればHTMLページ（このHTMLをそのまま配信。要素編集は無効） */
  rawHtml?: string | null;
  /** エディタのページ一覧で入れているフォルダ（URL・公開には関係しない） */
  folderId?: string;
  /** このページ専用コード（ページHTMLの先頭に挿入。JSON-LD・計測タグなど） */
  customTopHtml?: string;
  /** このページ専用コード（ページHTMLの末尾に挿入） */
  customEndHtml?: string;
  /** このページURLからの301リダイレクト先 */
  redirectTo?: string;
  /** このページURLを表示したまま内容を中継する外部サイトのURL（リバースプロキシ） */
  rewriteTo?: string;
  /** OGP画像（SNSシェア時のプレビュー） */
  ogImage?: ImageRef | null;
  /** スクリプト画面に置いた、要素につながっていないブロック（実行されない） */
  scripts?: Script[];
  /** きっかけが「このページ」のスクリプト（ページを開いたとき。データの取得もここ） */
  pageScripts?: Script[];
  children: string[];
}

/** エディタのページ一覧を整理するフォルダ（URLの階層とは関係しない） */
export interface PageFolder {
  id: string;
  name: string;
}

/** 追加したGoogle Font。weights が "variable" なら可変フォント */
export interface CustomFont {
  family: string;
  weights: string[] | "variable";
}

/** 再利用コンポーネント。マスターのノードツリーは nodes 内に持つ */
export interface Component {
  id: string;
  name: string;
  rootId: string;
}

/** リスト要素の設定（配列の項目を繰り返し表示） */
export interface ListContent {
  /** 並べる配列の名前（"記事" や "商品.レビュー" のように「.」で中をたどれる） */
  from?: string;
  /** 表示件数（未設定 = 全件） */
  limit?: number;
}

export interface Asset {
  id: string;
  name: string;
  /** Workers KV上のパス（/api/assets/file 経由で配信） */
  path?: string;
  /** サーバーの保存先が無いときに、このブラウザ内へ保存した中身（dataURL） */
  dataUrl?: string;
  /** ファイルサイズ（bytes。使用量表示に使う） */
  bytes?: number;
  /** MIME type（未設定なら画像として扱う） */
  mimeType?: string;
  width: number;
  height: number;
  /** SVGが <filter>（シャドウ等）を含むか。未判定なら undefined */
  svgFilter?: boolean;
}

export interface LoadingScreenSetting {
  enabled: boolean;
  /** 通常ページと同じ要素ツリーを保持する編集用ページ */
  pageId?: string;
  /** 最低表示時間（ms） */
  minDuration?: number;
  /** フェードアウト時間（ms） */
  fadeDuration?: number;
  /** 同じタブのセッション中は初回だけ表示 */
  showOnce?: boolean;
}

/** JSONを取得するページを作り直す間隔の既定値（秒） */
export const DEFAULT_DATA_REVALIDATE = 60;

/** PWA（ホーム画面に追加してアプリのように使う）の設定 */
export interface PwaSetting {
  enabled: boolean;
  /** アプリ名（未設定はサイト名） */
  name?: string;
  /** ホーム画面のアイコン下に出る短い名前（未設定はアプリ名） */
  shortName?: string;
  /** アプリのアイコン（未設定はホーム画面アイコン → ファビコン。512×512 PNG推奨） */
  icon?: ImageRef | null;
  /** 表示モード */
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  /** ツールバー等の色 */
  themeColor?: string;
  /** 起動時の背景色 */
  backgroundColor?: string;
}

export interface SiteDoc {
  siteName: string;
  /**
   * 公開サイトの言語（BCP 47 の言語コード。例: ja, en, zh-Hant）。<html lang> などに使う。
   * 未設定 = ja。lib/site-lang.ts
   */
  lang?: string;
  /** サイト内で共通利用する登録色 */
  colorPalette?: string[];
  /** 公開URL（例: https://example.com）。OGPの絶対URL化に使用 */
  siteUrl?: string;
  /**
   * JSONを取得するページを作り直す間隔（秒）。その間は作り置きのページ（Cloudflare では取得済みのJSON）を使う。
   * 未設定 = 60、0 = アクセスのたびに取得する
   */
  dataRevalidate?: number;
  /**
   * 公開サイトを動かすホスティング（データを取得するページの作り方が変わる）。
   * 未設定 = 標準（Vercel・Netlify・Node.js など。ISRでページを作り置く）、
   * cloudflare = Cloudflare Workers（ページは毎回描画し、取得したJSONをCloudflareのキャッシュに置く）
   */
  hosting?: "cloudflare";
  favicon?: ImageRef | null;
  /** iPhone/iPadのホーム画面アイコン（apple-touch-icon。推奨 180×180 PNG） */
  appleTouchIcon?: ImageRef | null;
  /** デフォルトのOGP画像（ページ側で未設定のときに使う） */
  ogImage?: ImageRef | null;
  loadingScreen?: LoadingScreenSetting;
  pwa?: PwaSetting;
  pages: Record<string, Page>;
  pageOrder: string[];
  /** ページ一覧のフォルダ（並び順）。ページは Page.folderId で入る */
  pageFolders?: PageFolder[];
  nodes: Record<string, DocNode>;
  assets: Record<string, Asset>;
  components?: Record<string, Component>;
  /** 追加したGoogle Fonts */
  customFonts?: CustomFont[];
  /** カスタムコード: head内（meta / script等） */
  customHeadHtml?: string;
  /** カスタムコード: body末尾 */
  customBodyEndHtml?: string;
  /** ブレークポイント（大きい順。未設定は既定の lg / md / sm） */
  breakpoints?: BreakpointDef[];
  /** パソコン表示のキャンバス幅（未設定は 1280） */
  baseWidth?: number;
}
