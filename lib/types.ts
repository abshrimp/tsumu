import type { ValueTransform } from "./script-model/compose";

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

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldContent {
  kind: FieldKind;
  /** HTML から取り込んだ項目名と、チェックボックス・ラジオ・送信ボタンの送信値。 */
  name?: string;
  submitValue?: string;
  /** kind="input" のときの HTML の input type */
  inputType?: InputType;
  /** checkbox / radio の隣に表示するテキスト（{変数} を使える） */
  label?: string;
  /** input / textarea / select の初期値（{変数} を使える） */
  defaultValue?: string;
  /** 未入力のときに薄く表示する案内文（{変数} を使える） */
  placeholder?: string;
  /** select の選択肢（{変数} を使える） */
  options?: FieldOption[];
  /** checkbox / radio: 最初からチェックしておくか */
  checked?: boolean;
  /**
   * radio: グループ名（同じグループのラジオボタンからは1つだけ選べる。送信するときの名前になり、
   * {グループ名} が選んだボタンの値になる）
   */
  group?: string;
  /** 操作できない状態にするか（disabled） */
  disabled?: boolean;
  /** 送信する前に入力が必要か */
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
  /** file: 複数のファイルを選べるか */
  multiple?: boolean;
}

/** 動画・音声の代わりのソース。識別子と URL の末尾を分けて保存する。 */
export interface MediaSource {
  src: string;
  assetId?: string;
  assetSuffix?: string;
  type?: string;
  media?: string;
}

export interface MediaContent {
  sources?: MediaSource[];
  kind: "video" | "audio";
  src: string;
  assetId?: string;
  /** アセットに付けるクエリやフラグメント（先頭は ? か #）。 */
  assetSuffix?: string;
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
}

export interface EmbedContent {
  kind: "youtube" | "map" | "url";
  /** 利用者の入力（YouTube の URL / 住所 / 埋め込みたい URL） */
  src: string;
}

export interface IconContent {
  /** lucide のアイコン名（kebab-case） */
  name: string;
  /** インラインで展開するための SVG のマークアップ */
  svg: string;
}

export interface Motion {
  id: string;
  /** state なら transition、それ以外なら animation */
  trigger: "state" | "hover" | "active" | "load" | "in-view";
  /** state: 変化を見張るプロパティ */
  property?: string;
  /** animation: KEYFRAMES のキー（"custom" なら customKeyframes を使う） */
  keyframes?: string;
  /** keyframes="custom" のときの @keyframes の本体（from {...} to {...}） */
  customKeyframes?: string;
  /** 秒 */
  duration: number;
  /** 秒 */
  delay: number;
  easing: string;
  /** -1 = 無限にくり返す */
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
 * "base"（すべての画面）か、ブレークポイントの ID。
 * 既定は lg（タブレット）/ md（スマホの横向き）/ sm（スマホ）で、サイトの設定で追加・削除できる
 */
export type Breakpoint = string;

/** サイトのブレークポイント（この幅以下の画面に効くスタイルの区切り） */
export interface BreakpointDef {
  id: string;
  label: string;
  /** この幅以下で効く（max-width） */
  maxWidth: number;
}
export type StyleState = "default" | "hover" | "active" | "focus" | `custom:${string}`;

/** camelCase の CSS プロパティ → 値 */
export type StyleMap = Record<string, string>;

/** ブレークポイント → 状態 → スタイル（無いブレークポイントは undefined） */
export type NodeStyles = Record<Breakpoint, Partial<Record<StyleState, StyleMap>>>;

/** 画面上で body を通常の要素と同じように選択するための、予約の ID */
export const BODY_NODE_ID = "__body__";

export interface LinkSetting {
  kind: "url" | "page";
  url?: string;
  pageId?: string;
  newTab?: boolean;
  /** スクリプトの画面での位置（「クリックしたとき → 開く」として表示する） */
  pos?: ScriptPos;
}

/* ---------- スクリプト（きっかけ → 動作） ---------- */

/** 動作の対象に「この要素自身」を指定するときの予約の値 */
export const SELF_TARGET = "@self";

/** スクリプトの画面で、きっかけに「このページ」を指定するときの予約の値 */
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
  | "contains"
  | "contains-any"
  | "starts-with"
  | "ends-with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "has-key"
  /** 指定した複数の値か、リストの中の値のどれかと同じ */
  | "in";

export interface ScriptCond {
  /** value = 値 / checked = チェック / visible = 表示中 / hovered = ホバー中 / var = 変数 */
  subject: "value" | "checked" | "visible" | "hovered" | "var";
  /** 対象の ID 属性（SELF_TARGET = この要素。subject="var" では使わない） */
  target: string;
  /** subject="var" で比べる値（{変数} と文字を混ぜて書ける） */
  left?: string;
  /** subject="value" / "var" の比較方法 */
  op?: ScriptOp;
  value?: string;
  /** どの条件も、「でない」を選べば判定を反転する */
  not?: boolean;
}

/** 追加の「もし」の条件は、直前の条件とつながる。「かつ」は「または」より先に結び付く。 */
export interface JoinedScriptCond extends ScriptCond {
  /** true = かつ、false = または */
  and: boolean;
}

/** リストの表示の絞り込みの条件 */
export interface FilterCond {
  field: string;
  op: ScriptOp;
  /** {変数} は、実行時の値に置き換える */
  value: string;
  /** 「でない」を選んだときは、この条件だけを反転する */
  not?: boolean;
  /** 直前の条件と「かつ」でつなぐ（無ければ「または」でつなぐ） */
  and?: boolean;
}

export type ScriptStep = { id: string } & (
  | { kind: "show" | "hide" | "toggle"; target: string }
  | { kind: "set-state"; target: string; state: string }
  | { kind: "open-page"; pageId: string; newTab?: boolean }
  | { kind: "open-url"; url: string; newTab?: boolean }
  | { kind: "scroll-to"; target: string }
  | { kind: "set-value"; target: string; value: string }
  /** 入力欄やボタンを、操作できる / できない状態にする（disabled） */
  | { kind: "set-enabled"; target: string; op: "enable" | "disable" | "toggle" }
  | {
      /** 表示しているリストだけを変える（絞り込み・並べ替え・解除）。元のデータは変えない。 */
      kind: "list-display";
      mode: "filter" | "sort" | "clear";
      array: string;
      field: string;
      op: ScriptOp;
      value: string;
      /** 最初の絞り込みの条件を反転するか */
      not?: boolean;
      /** 絞り込みの条件と、変わらない絞り込みの枠の識別子。 */
      or?: FilterCond[];
      no?: number;
      join?: "and" | "or";
      dir: "asc" | "desc";
    }
  | {
      /** ブラウザに値やリストを保存する（localStorage → このホストのクッキー → メモリ の順に試す） */
      kind: "store-save";
      key: string;
      /** {変数} を使える */
      value: string;
      /** 公開 URL のドメインのすべてのサブドメインで共有するクッキーにも保存するか */
      shared?: boolean;
    }
  | {
      /** ブラウザに保存したデータを変数に入れる */
      kind: "store-load";
      key: string;
      into: string;
      /** すべてのサブドメインで共有するクッキーを先に読むか */
      shared?: boolean;
    }
  | { kind: "set-list-item"; list: string; key: string; value: string }
  /** 一致する値をすべて削除するか、配列の位置やオブジェクトのキーで1件を削除する。 */
  | { kind: "remove-list-item"; list: string; mode: "value" | "key"; value: string }
  | { kind: "break-loop" }
  | {
      /**
       * 値を変数に入れる（{変数} と文字を混ぜて書ける）。
       * {名前} が1つだけなら、内部の型を保ったまま代入する。{データ.items.0} などの位置も参照できる
       */
      kind: "set-var";
      value: string;
      into: string;
    }
  | {
      /** 変数に対する、組み合わせられる純粋な操作を1つ。複数のブロックは順に実行する。 */
      kind: "transform";
      /** 読む変数か、入れ子の位置。波かっこは付けない。 */
      source: string;
      /** 出力する変数。順に処理をつなぐ場合は、source と同じでもよい。 */
      into: string;
      transform: ValueTransform;
    }
  | {
      /** 文字をクリップボードにコピーする（{変数} を使える） */
      kind: "copy";
      value: string;
    }
  | { kind: "wait"; seconds: number | string }
  | {
      /** 中のブロックを times 回くり返す（0 = ずっと。止まらなくならないよう、1回ごとに少し間をあける） */
      kind: "repeat";
      times: number | string;
      then: ScriptStep[];
    }
  | {
      /**
       * リストの項目ごとに、中のブロックを実行する。
       * {ループ.値}、{ループ.キー}、{ループ.順番} を参照できる
       */
      kind: "for-each";
      array: string;
      then: ScriptStep[];
    }
  /*
   * データの取得。「このページ｜ページを開いたとき」の直下でだけ動き、
   * 公開したサイトでは、ページを配信する前（サーバー側）に上から順に実行する。
   * 取得した結果は、{名前.項目} などの変数の参照やリストの操作で使う
   */
  | {
      /** URL から JSON を取得して、as の名前を付ける（{変数} を使える） */
      kind: "fetch";
      url: string;
      /** HTTP のメソッド（未設定なら GET） */
      method?: FetchMethod;
      /** 送るヘッダー（値に {変数} を使える） */
      headers?: FetchHeader[];
      /** GET 以外で送る本文（JSON。{変数} を使え、文字列の中では値を JSON 用にエスケープする） */
      body?: string;
      /** 取得したデータの名前（要素では {名前.項目} としても使える） */
      as?: string;
      /** プレビュー用のデータは、実行する取得のリクエストとは別に持つ。 */
      preview?: {
        sample?: unknown;
        totals?: Record<string, number>;
        fetchedAt?: number;
      };
    }
  | {
      kind: "if";
      cond: ScriptCond;
      /** 追加の条件。「もし」のブロックの条件が1つだけなら省略する。 */
      conditions?: JoinedScriptCond[];
      then: ScriptStep[];
      /** 未定義なら「もし〜なら」、配列なら「もし〜なら / でなければ」 */
      else?: ScriptStep[];
    }
);

export type FetchMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FetchHeader {
  name: string;
  value: string;
}

export interface Script {
  id: string;
  /** 未設定なら、きっかけの無いブロックの集まり（実行されない） */
  trigger?: ScriptTrigger;
  /** trigger が "change" のとき、変数の位置を明示すれば、要素ではなくスクリプトが代入した値を見張る。 */
  changeVariable?: string;
  /** hover-end: 「ホバーし始めたとき」に表示した要素の上にいる間は、外れたとみなさない */
  keepOnShown?: boolean;
  steps: ScriptStep[];
  pos: ScriptPos;
}

export interface TextContent {
  content: string;
  /** 0 = 本文（p）/ 1〜6 = h1〜h6 */
  heading: number;
}

export interface ImageContent {
  src: string;
  alt: string;
  width: number;
  height: number;
  assetId?: string;
  /** アセットに付けるクエリやフラグメント（先頭は ? か #）。 */
  assetSuffix?: string;
  priority?: boolean;
  /** false なら、シャドウ付きの SVG が iOS の Safari でぼやけるのを防ぐ処理を適用しない */
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
  /** 「クリックしたとき → 開く」だけのスクリプト。a タグとして出力する */
  link: LinkSetting | null;
  /** 「きっかけ → 動作」のスクリプト（link で表せるものは除く） */
  scripts?: Script[];
  image?: ImageContent;
  code?: { html: string };
  icon?: IconContent;
  field?: FieldContent;
  media?: MediaContent;
  embed?: EmbedContent;
  list?: ListContent;
  /** type === "instance" のときに参照するコンポーネントの ID */
  componentId?: string;
  children: string[];
  styles: NodeStyles;
  /** この要素に常に適用する、生の CSS の宣言（「プロパティ: 値;」の並び） */
  customCss?: string;
  /** 取り込んだセレクターやスクリプトのために残す、元の HTML のクラス。 */
  htmlClass?: string;
  /** HTML の変換で残す、イベントでない安全な HTML の属性。 */
  htmlAttrs?: Record<string, string>;
  motions?: Motion[];
  /** 非表示にするデバイス。含まれないデバイスでは表示する */
  hiddenOn?: Breakpoint[];
  locked?: boolean;
  /**
   * ID 属性。アンカーに使えるほか、フォームの部品では送信するときの項目名になり、
   * テキストを持つ要素では、その内容を {ID} の変数として使える
   */
  attrId?: string;
}

/** URL の直接の指定か、アセットの参照のどちらかで画像を指す */
export interface ImageRef {
  url?: string;
  assetId?: string;
}

/** 手を加えていない HTML のソースファイルを、取り込んだ ZIP のアセットの識別子と結び付ける。 */
export interface HtmlZipPage {
  /** ZIP の中での、HTML の入り口のファイルの元のパス。 */
  path: string;
  /** この取り込みに属するアセットだけ（以前に置き換えた版は含まない）。 */
  assetIds: string[];
}

export interface Page {
  id: string;
  name: string;
  /** "" = トップページ。"blog/post-1" のような階層にもできる */
  slug: string;
  /** リンク先に付けるクエリ（"?" を除いた "tab=news&page=1"）。ページでは {tab} の変数として使える */
  query?: string;
  title: string;
  /**
   * タイトルがまだ決まっていない（追加・複製した直後の）しるし。
   * 初めてページ名を確定したら、タイトルもその名前にして外す（先にタイトルを書き換えた場合も外す）。lib/pageTitle.ts
   */
  titlePending?: boolean;
  description: string;
  /** このページの言語（BCP 47 の言語コード。未設定ならサイトの言語）。lib/site-lang.ts */
  lang?: string;
  /** このページにだけ適用する body のスタイル */
  bodyStyles?: NodeStyles;
  /** html の背景色（オーバースクロールのときに見える色）。未設定なら body の背景が広がる */
  htmlBackground?: string;
  noindex?: boolean;
  /** true なら、書き出しや公開に含めない（下書き） */
  unpublished?: boolean;
  /** 設定されていれば HTML のページ（この HTML をそのまま配信し、要素の編集はできない） */
  rawHtml?: string | null;
  /** 生の HTML のソースは、相対的な参照をそのまま持つ。参照を解決するのは、プレビューと書き出しのときだけ。 */
  htmlZip?: HtmlZipPage;
  /** エディタのページの一覧で入れているフォルダ（URL や公開には関係しない） */
  folderId?: string;
  /** このページ専用のコード（ページの HTML の先頭に挿入する。JSON-LD や計測のタグなど） */
  customTopHtml?: string;
  /** このページ専用のコード（ページの HTML の末尾に挿入する） */
  customEndHtml?: string;
  /** このページの URL からの 301 リダイレクトの転送先 */
  redirectTo?: string;
  /** このページの URL を表示したまま、内容を中継する外部のサイトの URL（リバースプロキシ） */
  rewriteTo?: string;
  /** OGP 画像（SNS でシェアしたときのプレビュー） */
  ogImage?: ImageRef | null;
  /** スクリプトの画面に置いた、要素につながっていないブロック（実行されない） */
  scripts?: Script[];
  /** きっかけが「このページ」のスクリプト（ページを開いたとき。データの取得もここに置く） */
  pageScripts?: Script[];
  children: string[];
}

/** エディタのページの一覧を整理するフォルダ（URL の階層とは関係しない） */
export interface PageFolder {
  id: string;
  name: string;
}

/** 追加した Google Font。weights が "variable" なら可変フォント */
export interface CustomFont {
  family: string;
  weights: string[] | "variable";
}

/** 再利用するコンポーネント。マスターのノードのツリーは nodes の中に持つ */
export interface Component {
  id: string;
  name: string;
  rootId: string;
}

/** リストの要素の設定（配列の項目をくり返し表示する） */
export interface ListContent {
  /** 並べる配列の名前（"記事" や "商品.レビュー" のように「.」で中をたどれる） */
  from?: string;
  /** 表示する件数（未設定ならすべて） */
  limit?: number;
}

/** 元のアーカイブの出どころと、CSS の依存関係。アップロードしたバイト列は決して書き換えない。 */
export interface ZipAssetMetadata {
  version: 1;
  group: string;
  path: string;
  /** 元の ZIP の項目の SHA-256。取り込み直すときに、変わっていないファイルを使い回すために使う。 */
  sha256?: string;
  stylesheet?: {
    source: string;
    references: { url: string; assetId: string; suffix: string }[];
  };
}

export interface Asset {
  id: string;
  name: string;
  /** Workers KV でのパス（/api/assets/file を通して配信する） */
  path?: string;
  /** サーバーの保存先が無いときに、このブラウザの中に保存した中身（data URL） */
  dataUrl?: string;
  /** ファイルの大きさ（bytes。使用量の表示に使う） */
  bytes?: number;
  /** MIME type（未設定なら画像として扱う） */
  mimeType?: string;
  width: number;
  height: number;
  /** 実際に描画される影・ぼかしがSVGに含まれるか。 */
  svgFilter?: boolean;
  zip?: ZipAssetMetadata;
}

export interface LoadingScreenSetting {
  enabled: boolean;
  /** 通常のページと同じ要素のツリーを持つ、編集用のページ */
  pageId?: string;
  /** 最低限表示する時間（ms） */
  minDuration?: number;
  /** フェードアウトの時間（ms） */
  fadeDuration?: number;
  /** 同じタブのセッションの間は、最初の1回だけ表示する */
  showOnce?: boolean;
}

/** JSON を取得するページを作り直す間隔の既定値（秒） */
export const DEFAULT_DATA_REVALIDATE = 60;

/** PWA（ホーム画面に追加して、アプリのように使う）の設定 */
export interface PwaSetting {
  enabled: boolean;
  /** アプリの名前（未設定ならサイト名） */
  name?: string;
  /** ホーム画面のアイコンの下に表示する短い名前（未設定ならアプリの名前） */
  shortName?: string;
  /** アプリのアイコン（未設定ならホーム画面のアイコン → ファビコン の順に使う。512×512 の PNG を推奨） */
  icon?: ImageRef | null;
  /** 表示モード */
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  /** ツールバーなどの色 */
  themeColor?: string;
  /** 起動するときの背景色 */
  backgroundColor?: string;
}

export interface SiteDoc {
  /** 保存する文書のスキーマの版（この値と完全に一致すること）。保存と読み込みのすべての経路で必須。 */
  schemaVersion: 1;
  siteName: string;
  /**
   * 公開するサイトの言語（BCP 47 の言語コード。例: ja, en, zh-Hant）。<html lang> などに使う。
   * 未設定なら ja。lib/site-lang.ts
   */
  lang?: string;
  /** サイトの中で共通して使う、登録した色 */
  colorPalette?: string[];
  /** 公開 URL（例: https://example.com）。OGP の URL を絶対 URL にするのに使う */
  siteUrl?: string;
  /**
   * JSON を取得するページを作り直す間隔（秒）。その間は、作り置きのページ（Cloudflare では取得済みの JSON）を使う。
   * 未設定なら 60、0 ならアクセスのたびに取得する
   */
  dataRevalidate?: number;
  /**
   * 公開したサイトを動かすホスティング（データを取得するページの作り方が変わる）。
   * 未設定なら標準（Vercel・Netlify・Node.js など。ISR でページを作り置く）、
   * cloudflare なら Cloudflare Workers（ページは毎回描画し、取得した JSON を Cloudflare のキャッシュに置く）
   */
  hosting?: "cloudflare";
  favicon?: ImageRef | null;
  /** iPhone・iPad のホーム画面のアイコン（apple-touch-icon。180×180 の PNG を推奨） */
  appleTouchIcon?: ImageRef | null;
  /** 既定の OGP 画像（ページの側で未設定のときに使う） */
  ogImage?: ImageRef | null;
  loadingScreen?: LoadingScreenSetting;
  pwa?: PwaSetting;
  pages: Record<string, Page>;
  pageOrder: string[];
  /** ページの一覧のフォルダ（並び順）。ページは Page.folderId で、フォルダに入る */
  pageFolders?: PageFolder[];
  nodes: Record<string, DocNode>;
  assets: Record<string, Asset>;
  components?: Record<string, Component>;
  /** 追加した Google Fonts */
  customFonts?: CustomFont[];
  /** カスタムのコード: head の中（meta や script など） */
  customHeadHtml?: string;
  /** カスタムのコード: body の末尾 */
  customBodyEndHtml?: string;
  /** ブレークポイント（大きい順。未設定なら既定の lg / md / sm） */
  breakpoints?: BreakpointDef[];
  /** パソコン表示のキャンバスの幅（未設定なら 1280） */
  baseWidth?: number;
}
