"use client";

/**
 * スクリプト画面のブロックの分類・アイコン・色と、パレットに並べるブロックの一覧
 */

import { type CSSProperties } from "react";
import {
  ArrowDownToLine,
  Ban,
  ClipboardCopy,
  CloudDownload,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Funnel,
  LogOut,
  MousePointer2,
  MousePointerClick,
  PenLine,
  Repeat,
  IterationCw,
  ListMinus,
  ListPlus,
  Save,
  ScanEye,
  Split,
  TextCursorInput,
  Timer,
  ToggleRight,
  Palette,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { scriptUid, TRIGGER_LABELS, TRIGGER_ORDER, type PageScript } from "../../lib/script";
import { type ScriptStep, type ScriptTrigger } from "../../lib/types";
import { tr, trc } from "../../lib/i18n";
import { type Loc } from "./step-tree";

/* ---------- ブロックの分類 ---------- */

type Cat = "event" | "load" | "look" | "move" | "input" | "var" | "array" | "store" | "control";

export const CAT_INFO: Record<Cat, { label: string; color: string }> = {
  event: { label: tr("Triggers"), color: "#d97706" },
  load: { label: tr("Data"), color: "#059669" },
  look: { label: trc("block_category", "Looks"), color: "#7c3aed" },
  move: { label: tr("Navigation"), color: "#0d99ff" },
  input: { label: tr("Input"), color: "#0f766e" },
  var: { label: tr("Variables"), color: "#0891b2" },
  array: { label: tr("List", "list_variant_1"), color: "#db2777" },
  store: { label: tr("Storage"), color: "#4f46e5" },
  control: { label: tr("Control"), color: "#52525b" },
};
export const CAT_ORDER: Cat[] = ["event", "look", "move", "input", "var", "load", "array", "store", "control"];

export const CAT_OF: Record<ScriptStep["kind"], Cat> = {
  show: "look",
  "set-state": "look",
  hide: "look",
  toggle: "look",
  "open-page": "move",
  "open-url": "move",
  "scroll-to": "move",
  "set-value": "input",
  "set-enabled": "input",
  fetch: "load",


  copy: "input",

  "set-var": "var",
  "set-list-item": "array",
  "remove-list-item": "array",
  "break-loop": "control",
  transform: "var",
  "list-display": "array",

  repeat: "control",
  "for-each": "array",



  "store-save": "store",
  "store-load": "store",
  wait: "control",
  if: "control",
};

export const TRIGGER_ICON: Record<ScriptTrigger, LucideIcon> = {
  click: MousePointerClick,
  "hover-start": MousePointer2,
  "hover-end": LogOut,
  change: TextCursorInput,
  load: Zap,
  "in-view": ScanEye,
};

export const STEP_ICON: Record<ScriptStep["kind"], LucideIcon> = {
  show: Eye,
  "set-state": Palette,
  hide: EyeOff,
  toggle: ToggleRight,
  "open-page": FileText,
  "open-url": ExternalLink,
  "scroll-to": ArrowDownToLine,
  "set-value": PenLine,
  "set-enabled": Ban,
  fetch: CloudDownload,


  copy: ClipboardCopy,

  "set-var": Variable,
  "set-list-item": ListPlus,
  "remove-list-item": ListMinus,
  "break-loop": LogOut,
  transform: Workflow,
  "list-display": Funnel,

  repeat: Repeat,
  "for-each": IterationCw,



  "store-save": Save,
  "store-load": FolderOpen,
  wait: Timer,
  if: Split,
};

export function Ico({ icon: I, cat }: { icon: LucideIcon; cat: Cat }) {
  return (
    <span className="se-ico" style={colorVar(cat)}>
      <I size={13} strokeWidth={2} />
    </span>
  );
}

function colorVar(cat: Cat): CSSProperties {
  return { "--blk": CAT_INFO[cat].color } as CSSProperties;
}

export type Payload =
  | { type: "trigger"; trigger: ScriptTrigger }
  | { type: "steps"; steps: ScriptStep[]; from?: { loc: Loc; remaining: PageScript[] } }
  /** group: 一緒に動かす選択中のスクリプト（script を含む） */
  | { type: "script"; script: PageScript; group: PageScript[] };

export interface PaletteItem {
  key: string;
  cat: Cat;
  icon: LucideIcon;
  /** ［］で囲んだ部分は入力欄として表示する */
  label: string;
  make: () => Payload;
}

const st = () => scriptUid("st");
const one = (step: ScriptStep): Payload => ({ type: "steps", steps: [step] });

export const PALETTE: PaletteItem[] = [
  ...TRIGGER_ORDER.map<PaletteItem>((t) => ({
    key: t,
    cat: "event",
    icon: TRIGGER_ICON[t],
    label: TRIGGER_LABELS[t],
    make: () => ({ type: "trigger", trigger: t }),
  })),
  {
    key: "fetch",
    cat: "load",
    icon: CloudDownload,
    label: tr("Fetch data from ［URL］ as ［name］"),
    make: () => one({ id: st(), kind: "fetch", url: "" }),
  },
  {
    key: "show",
    cat: "look",
    icon: Eye,
    label: tr("［Show / Hide / Toggle］［element］"),
    make: () => one({ id: st(), kind: "show", target: "" }),
  },
  {
    key: "set-state",
    cat: "look",
    icon: Palette,
    label: tr("Set element ［］ to state ［state name］"),
    make: () => one({ id: st(), kind: "set-state", target: "", state: "" }),
  },
  {
    key: "open-page",
    cat: "move",
    icon: FileText,
    label: tr("Open ［page / URL］"),
    make: () => one({ id: st(), kind: "open-page", pageId: "" }),
  },
  {
    key: "scroll-to",
    cat: "move",
    icon: ArrowDownToLine,
    label: tr("Scroll to ［element］"),
    make: () => one({ id: st(), kind: "scroll-to", target: "" }),
  },
  {
    key: "set-value",
    cat: "input",
    icon: PenLine,
    label: tr("Set ［field］ to ［value］"),
    make: () => one({ id: st(), kind: "set-value", target: "", value: "" }),
  },
  {
    key: "set-enabled",
    cat: "input",
    icon: Ban,
    label: tr("Set ［field］ to ［enabled / disabled］"),
    make: () => one({ id: st(), kind: "set-enabled", target: "", op: "disable" }),
  },
  {
    key: "for-each",
    cat: "array",
    icon: IterationCw,
    label: tr("For each item in list ［］"),
    make: () => one({ id: st(), kind: "for-each", array: "", then: [] }),
  },
  {
    key: "list-display",
    cat: "array",
    icon: Funnel,
    label: tr("Filter list ［］"),
    make: () => one({ id: st(), kind: "list-display", mode: "filter", array: "", field: "", op: "eq", value: "", dir: "asc" }),
  },
  {
    key: "store-save",
    cat: "store",
    icon: Save,
    label: tr("Save ［value］ to storage key ［key］"),
    make: () => one({ id: st(), kind: "store-save", key: "", value: "" }),
  },
  {
    key: "store-load",
    cat: "store",
    icon: FolderOpen,
    label: tr("Load storage key ［key］ into variable ［］"),
    make: () => one({ id: st(), kind: "store-load", key: "", into: "" }),
  },
  {
    key: "set-var",
    cat: "var",
    icon: Variable,
    label: tr("Set variable ［］ to ［value / {data.path}］"),
    make: () => one({ id: st(), kind: "set-var", value: "", into: "" }),
  },
  {
    key: "make-list",
    cat: "array",
    icon: ListPlus,
    label: tr("Create an empty list in variable ［］"),
    make: () => one({ id: st(), kind: "set-var", value: "[]", into: "" }),
  },
  {
    key: "set-list-item",
    cat: "array",
    icon: ListPlus,
    label: tr("Set ［value］ at key ［］ of list ［］"),
    make: () => one({ id: st(), kind: "set-list-item", list: "", key: "", value: "" }),
  },
  {
    key: "remove-list-item",
    cat: "array",
    icon: ListMinus,
    label: tr("Remove entries from list ［］"),
    make: () => one({ id: st(), kind: "remove-list-item", list: "", mode: "value", value: "" }),
  },
  {
    key: "transform",
    cat: "var",
    icon: Workflow,
    label: tr("Apply an operation to a variable and store the result"),
    make: () => one({
      id: st(), kind: "transform", source: "", into: "", transform: { kind: "field", key: "" },
    }),
  },
  {
    key: "copy",
    cat: "input",
    icon: ClipboardCopy,
    label: tr("Copy ［text］"),
    make: () => one({ id: st(), kind: "copy", value: "" }),
  },
  {
    key: "wait",
    cat: "control",
    icon: Timer,
    label: tr("Wait ［1］ seconds"),
    make: () => one({ id: st(), kind: "wait", seconds: 1 }),
  },
  {
    key: "if",
    cat: "control",
    icon: Split,
    label: tr("If ［condition］ then (else)"),
    make: () =>
      one({
        id: st(),
        kind: "if",
        cond: { subject: "value", target: "", op: "eq", value: "" },
        then: [],
      }),
  },
  {
    key: "break-loop",
    cat: "control",
    icon: LogOut,
    label: tr("Break out of loop"),
    make: () => one({ id: st(), kind: "break-loop" }),
  },
  {
    key: "repeat",
    cat: "control",
    icon: Repeat,
    label: tr("Repeat ［3］ times"),
    make: () => one({ id: st(), kind: "repeat", times: 3, then: [] }),
  },
];


/** Search uses plain-language synonyms; labels and saved step kinds stay unchanged. */
const SEARCH_TERMS: Record<string, string> = {
  click: "押す 押したとき ボタンを押す ボタン押下 押下 クリック クリックする タップ タップする タッチ 触る 選択したとき クリックイベント onclick click tap press",
  "hover-start": "マウスを乗せる マウスを重ねる カーソルを合わせる ポインターを乗せる ホバー ホバー開始 マウスオーバー マウスが乗ったとき mouseover mouseenter pointerenter hover enter",
  "hover-end": "マウスを離す マウスが離れたとき カーソルを外す ポインターを外す ホバー終了 マウスアウト マウスリーブ mouseout mouseleave pointerleave hover leave",
  change: "入力 変更 変更したとき 値が変わる 値が変わったとき 選択が変わる 選択したとき フォーム変更 入力イベント チェックを変える チェックしたとき onChange change input",
  load: "ページを開く 開いたとき 読み込み ページ読み込み ページ表示 初期表示 最初に 起動時 ロードしたとき 初期化 読み込み完了 onload load initialize startup",
  "in-view": "画面内 現れる 見える 画面に入る 表示領域 表示領域に入る スクロールして見える 見えたとき ビューポート スクロールで出現 要素が現れたとき viewport intersection observer inview visible",
  fetch: "取得 データ取得 データを読む API WebAPI HTTP HTTPS GET POST リクエスト REST JSON サーバーから取得 サーバーと通信 サーバーデータ 外部データ 通信 送信 受信 ダウンロード URL 接続 エンドポイント レスポンス request response fetch download",
  show: "見せる 隠す 表示 非表示 表示する 非表示にする 消す 出す 見えるようにする 見えなくする 開閉 表示切り替え 表示を切り替える トグル 可視 非表示解除 visibility display show hide toggle visible",
  "set-state": "状態を変更する スタイルを切り替える 別の要素の色を変える 状態名 状態切り替え 色変更 set state style variant",
  "open-page": "ページ移動 ページを開く ページを切り替える ページ遷移 リンク リンクを開く リンク先 別ページ 別タブ 別ウィンドウ 外部サイトへ移動 サイト移動 URLを開く URLに飛ぶ 遷移 リダイレクト ジャンプ navigate redirect open link href location",
  "scroll-to": "スクロール スクロールする ページ内移動 ページの中を移動 位置に移動 要素まで移動 アンカーへ移動 アンカーリンク 特定の場所へ 位置へジャンプ 要素へ飛ぶ ジャンプ scroll anchor jump scrollto",
  "set-value": "入力する 入力欄に入れる フォームに入力 フォームの値 テキストボックスに入れる 入力値を変える 入力値更新 選択欄を設定 フィールドの値を設定 フォームに書く setvalue set input field form",
  "set-enabled": "有効 無効 有効にする 無効にする 入力禁止 入力できなくする 入力可能 操作可能 操作不可 クリック不可 押せなくする ボタンを無効 ボタンを有効 活性 非活性 disabled enabled disable enable",

  "for-each": "繰り返し 繰り返す くりかえし くりかえす 一件ずつ 1件ずつ 各項目 各要素 各項目に対して 順番に実行 全件に実行 すべての要素を処理 全項目を処理 ループ foreach each iterate for",



  "store-save": "保存 保存する 記録 記憶 ブラウザ ストレージ 保存領域 端末に保存 ブラウザに保存 設定を保存 データを保存 次回にも残す 次に開いたときも使う ローカルストレージ 永続化 localstorage storage save persist",
  "store-load": "読み込む 読み出す 呼び出す 復元 復元する 記録を読む 保存した値を使う 保存したデータを読む 保存データを取り出す 前回の値を読む 前回の状態に戻す ブラウザ保存 ローカルストレージ localstorage storage load restore retrieve",
  "set-var": "変数 変数を作る 変数に入れる 変数を設定 代入 値を入れる 名前をつける 新しい変数 既存の変数を上書き 上書き 値を保持 値を渡す 変数に保存 変数を変更 変数を更新 assign set variable",
  "remove-list-item": "リストから項目を削除 リスト削除 要素を削除 値で削除 位置で削除 キーで削除 指定した項目を取り除く remove delete list item entry index key",
  "list-display": "リスト表示 絞り込み解除 フィルター解除 ソート 並べ替え 表示を絞り込む clear sort filter リスト表示操作",
  transform: "数値演算 値を加工 データを加工 変数を加工 加工する 組み合わせ 演算 分割 結合 検索 置換 比較 ソート フィルタ 加工ブロック 変換処理 transform operation pipeline math list text",

  copy: "コピー コピーする クリップボード クリップボードにコピー テキストをコピー 文字列をコピー 貼り付け用 貼り付け用に記録 複写 copy clipboard copytext",
  wait: "待つ 待機 秒待つ 時間を置く 時間差 遅らせる 一定時間停止 一時停止 ディレイ ウェイト スリープ 遅延 後で実行 sleep delay pause wait timeout",
  if: "条件 分岐 条件分岐 もし だったら 場合 判定 比較 条件が合えば 条件に応じて でなければ そうでなければ else if then conditional branching",
  repeat: "繰り返し 繰り返す くりかえし くりかえす 指定回数 何度も 何回も ずっと 無限ループ 永遠 回数 ループ 反復 繰り返し処理 repeat loop forever iteration",
};

const normalizeSearch = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

/** Search the action palette by its current labels and keywords. */
export function findPaletteItems(query: string): PaletteItem[] {
  const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return PALETTE;
  return PALETTE.filter((item) => {
    const text = normalizeSearch([
      item.key, item.label, CAT_INFO[item.cat].label, SEARCH_TERMS[item.key] ?? "",
      item.cat === "array" ? "リスト" : "",
    ].join(" "));
    return words.every((word) => text.includes(word));
  });
}
