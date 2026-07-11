"use client";

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Lightbulb,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor } from "../lib/store";
import { BP_INFO, BP_ORDER } from "../lib/style";
import type { SiteDoc } from "../lib/types";
import { tr } from "../lib/i18n";

type Placement = "top" | "bottom" | "left" | "right" | "center";
type TutorialTask =
  | "open-pages"
  | "create-page"
  | "unpublish-page"
  | "name-page"
  | "slug-page"
  | "open-add"
  | "add-heading"
  | "edit-heading"
  | "style-heading"
  | "add-text"
  | "edit-text"
  | "add-box"
  | "add-first-child"
  | "add-second-child"
  | "flow-box"
  | "align-box"
  | "padding-button"
  | "margin-button"
  | "custom-button"
  | "move-button"
  | "reset-button-position"
  | "round-button"
  | "color-button"
  | "open-settings"
  | "link-button"
  | "mobile-view"
  | "mobile-box"
  | "preview";

interface TutorialStep {
  target?: string;
  placement: Placement;
  /** 章の名前（カード上部に出す） */
  chapter: string;
  title: string;
  body: string;
  /** なぜこの操作をするのか（考え方） */
  why?: string;
  bullets?: string[];
  task?: TutorialTask;
  taskLabel?: string;
  prepare?: {
    leftTab?: "layers" | "add" | "pages" | "assets" | "site";
    rightTab?: "style" | "settings";
    openSection?: string;
    clearSelection?: boolean;
  };
  /** 画面幅別の手順（ブレークポイントが無いサイトでは省く） */
  needsBreakpoint?: boolean;
}

/*
 * 文中の {slug} は練習ページのURL、{mobile} / {mobileId} はいちばん小さいブレークポイントの名前・IDに置き換える
 */
const ALL_STEPS: TutorialStep[] = [
  {
    placement: "center",
    chapter: tr("ハンズオン・チュートリアル"),
    title: tr("練習ページを作りながら、考え方ごと覚えます"),
    body: tr("ページ作成・文章・レイアウト・デザイン・リンク・スマホ対応までを、実際に操作しながら進めます。各ステップには「なぜその操作をするのか」も添えてあるので、手順だけでなく理由も一緒に確かめてください。"),
    bullets: [
      tr("操作が終わると、自動で次へ進みます（左右の矢印キーでも移動できます）。"),
      tr("作るページは非公開なので、公開サイトには出ません。途中でやめても残ります。"),
      tr("所要時間は約10分です。"),
    ],
  },

  /* ---------- ページを用意する ---------- */
  {
    target: "left-tab-pages",
    placement: "right",
    chapter: tr("ページを用意する"),
    title: tr("左パネルの「ページ」を開きます"),
    body: tr("サイトはページの集まりです。ページの追加・並べ替え・公開状態は、ここでまとめて管理します。"),
    why: tr("要素は必ずどこかのページに置きます。いまあるページを使わずに練習用のページを新しく作れば、失敗しても本番の内容には影響しません。"),
    task: "open-pages",
    taskLabel: tr("「ページ」タブを開く"),
  },
  {
    target: "add-page-button",
    placement: "right",
    chapter: tr("ページを用意する"),
    title: tr("「ページを追加」を押します"),
    body: tr("空のページが追加され、自動でそのページに切り替わります。"),
    why: tr("空のページには自分で置いた要素しかないので、それぞれが何をしているのかを確かめながら進められます。"),
    task: "create-page",
    taskLabel: tr("新しいページを追加する"),
    prepare: { leftTab: "pages" },
  },
  {
    target: "tutorial-page-publish-checkbox",
    placement: "left",
    chapter: tr("ページを用意する"),
    title: tr("「このページを公開する」をオフにします"),
    body: tr("右パネルに、いま開いているページの設定が出ています。チェックを外してください。"),
    why: tr("作りかけのページを公開サイトに出さないためです。非公開にしたページは、公開ボタンを押しても公開サイトに含まれません。下書き中のページにも使えます。"),
    task: "unpublish-page",
    taskLabel: tr("公開チェックを外して非公開にする"),
    prepare: { clearSelection: true, openSection: "tutorial-page-section" },
  },
  {
    target: "tutorial-page-name",
    placement: "left",
    chapter: tr("ページを用意する"),
    title: tr("ページ名を「練習ページ」にします"),
    body: tr("名前欄へ「練習ページ」と入力し、Enterを押してください。"),
    why: tr("ページ名は、エディタの中でページを見分けるための名前です。ページが増えても、名前を見れば何のページかすぐ分かります（ブラウザのタブに出るタイトルは「検索・シェア」で別に設定します）。"),
    task: "name-page",
    taskLabel: tr("名前を「練習ページ」にする"),
    prepare: { clearSelection: true, openSection: "tutorial-page-section" },
  },
  {
    target: "tutorial-page-slug",
    placement: "left",
    chapter: tr("ページを用意する"),
    title: tr("URLを「{slug}」にします"),
    body: tr("URL欄へ半角で「{slug}」と入力し、Enterを押してください。公開すると /{slug} でこのページが開きます。"),
    why: tr("URLは、訪問者がこのページを開くときのアドレスです。内容が分かる短い英単語にしておくと、人に伝えやすく、検索エンジンにもページの内容が伝わりやすくなります。"),
    task: "slug-page",
    taskLabel: tr("URLを「{slug}」にする"),
    prepare: { clearSelection: true, openSection: "tutorial-page-section" },
  },

  /* ---------- 要素を置く ---------- */
  {
    target: "left-tab-add",
    placement: "right",
    chapter: tr("要素を置く"),
    title: tr("左パネルの「追加」を開きます"),
    body: tr("文字・画像・ボタンなど、ページを作る部品（要素）はここから置きます。"),
    why: tr("ページは、文字やボタンなどの要素を組み合わせて作ります。新しい要素は、いま選んでいる要素のすぐ後ろ（ボックスを選んでいるときはその中）に入ります。入る場所は上部の「挿入先」で確認できます。"),
    task: "open-add",
    taskLabel: tr("「追加」タブを開く"),
  },
  {
    target: "add-element-heading",
    placement: "right",
    chapter: tr("要素を置く"),
    title: tr("「見出し」を押します"),
    body: tr("練習ページに見出しが入り、そのまま選ばれた状態になります。"),
    why: tr("見出しは、そのページが何についてのページかを示します。見た目が大きいだけでなく、検索エンジンや読み上げソフトも見出しを手がかりにページの内容をつかみます。"),
    task: "add-heading",
    taskLabel: tr("見出しを追加する"),
    prepare: { leftTab: "add" },
  },
  {
    target: "selected-node",
    placement: "left",
    chapter: tr("要素を置く"),
    title: tr("見出しをダブルクリックして書き換えます"),
    body: tr("「はじめてのページ」と入力し、文字の外側をクリックして確定してください。"),
    why: tr("キャンバス上で直接書き換えると、実際の文字の大きさや改行される位置を見ながら文章を調整できます。"),
    task: "edit-heading",
    taskLabel: tr("「はじめてのページ」と入力する"),
  },
  {
    target: "style-typography",
    placement: "left",
    chapter: tr("要素を置く"),
    title: tr("右パネルで文字サイズを40pxにします"),
    body: tr("「テキスト」のサイズ欄に40と入力し、Enterを押してください。"),
    why: tr("見出しを本文より大きくしておくと、どこが大事なのかが一目で分かります。このように「キャンバスで要素を選び、右パネルで変える」のが、このエディタの基本の操作です。"),
    task: "style-heading",
    taskLabel: tr("文字サイズを40pxにする"),
    prepare: { rightTab: "style" },
  },
  {
    target: "add-element-text",
    placement: "right",
    chapter: tr("要素を置く"),
    title: tr("見出しを選んだまま「テキスト」を押します"),
    body: tr("見出しのすぐ後ろに本文が入ります。"),
    why: tr("新しい要素は、選んでいる要素のすぐ後ろに入ります。追加する前に入れたい場所の要素を選んでおけば、あとから並べ替えずに済みます。"),
    task: "add-text",
    taskLabel: tr("テキストを追加する"),
    prepare: { leftTab: "add" },
  },
  {
    target: "selected-node",
    placement: "left",
    chapter: tr("要素を置く"),
    title: tr("本文を書き換えます"),
    body: tr("ダブルクリックして「このページはチュートリアルで作りました。」と入力し、外側をクリックして確定してください。"),
    why: tr("見出しで「何のページか」を、本文で「詳しい内容」を伝えます。このように役割を分けると、読みやすいページになります。"),
    task: "edit-text",
    taskLabel: tr("指定された本文を入力する"),
  },

  /* ---------- レイアウト ---------- */
  {
    placement: "center",
    chapter: tr("レイアウトの考え方"),
    title: tr("並べ方は「親」が決めます"),
    body: tr("要素を横に並べたい・中央に寄せたいときは、並べたい要素を「ボックス（親）」に入れ、親の設定で並べ方を決めます。子を1つずつ数値で動かすより、画面幅が変わっても崩れにくいからです。"),
    bullets: [
      tr("フロー … 子をどの向きに並べるか（縦・横）"),
      tr("配置 … 親の中のどこへ寄せるか"),
      tr("余白 … 要素の内側（内側余白）と外側（外側余白）のすき間"),
    ],
  },
  {
    target: "add-element-box",
    placement: "right",
    chapter: tr("レイアウト"),
    title: tr("「ボックス」を追加します"),
    body: tr("本文の後ろに、空のボックスが入ります。"),
    why: tr("ボックスは、ほかの要素をまとめて入れる箱です。中に入れた要素の並べ方を決めたり、まとめて背景を付けたりできます。"),
    task: "add-box",
    taskLabel: tr("ボックスを追加する"),
    prepare: { leftTab: "add" },
  },
  {
    target: "add-element-button",
    placement: "right",
    chapter: tr("レイアウト"),
    title: tr("ボックスの中にボタンを追加します"),
    body: tr("ボックスを選んだ状態で「ボタン」を押してください。上部の挿入先が「ボックスの中」になっています。"),
    why: tr("ボックスを選んだまま追加すると、要素はボックスの中に入ります。このとき、ボックスを「親」、中の要素を「子」と呼びます。レイヤーパネルでは、ボタンがボックスより一段内側に表示されます。"),
    task: "add-first-child",
    taskLabel: tr("ボックスの中へボタンを追加する"),
    prepare: { leftTab: "add" },
  },
  {
    target: "add-element-button",
    placement: "right",
    chapter: tr("レイアウト"),
    title: tr("もう1つボタンを追加します"),
    body: tr("同じボックスの中に2つ目のボタンを入れてください。いまは縦に並びます。"),
    why: tr("ボックスの中の要素は、最初は縦に並びます（垂直フロー）。並び方の変化が分かるようにボタンを2つにしておき、次のステップでボックスの設定だけで横並びに変えてみます。"),
    task: "add-second-child",
    taskLabel: tr("2つ目のボタンを追加する"),
    prepare: { leftTab: "add" },
  },
  {
    target: "style-layout",
    placement: "left",
    chapter: tr("レイアウト"),
    title: tr("ボックスを「水平フロー」にします"),
    body: tr("「レイアウト」のフローで、右向きの矢印を押してください。"),
    why: tr("ボタン自体は何も変えていないのに、ボックスの設定だけで横並びになりました。並び方を変えたいときは、中の要素（子）ではなく、それを囲むボックス（親）を選びます。"),
    task: "flow-box",
    taskLabel: tr("水平フローにして子要素を横に並べる"),
    prepare: { rightTab: "style", openSection: "style-layout" },
  },
  {
    target: "style-layout",
    placement: "left",
    chapter: tr("レイアウト"),
    title: tr("子要素を中央に寄せます"),
    body: tr("「配置」の3×3のボタンで、真ん中を押してください。"),
    why: tr("フローは「どの向きに並べるか」、配置は「ボックスの中のどこに寄せるか」を決めます。数値で位置を合わせると画面幅が変わったときにずれますが、中央寄せにしておけば常に真ん中に収まります。"),
    task: "align-box",
    taskLabel: tr("配置を中央揃えにする"),
    prepare: { rightTab: "style", openSection: "style-layout" },
  },
  {
    target: "style-spacing",
    placement: "left",
    chapter: tr("レイアウト"),
    title: tr("ボタンの内側余白を左右32px・上下16pxにします"),
    body: tr("1つ目のボタンが選ばれています。「余白」の内側余白に、左右32・上下16を入力してください。"),
    why: tr("内側余白は、要素の内側のすき間（文字と枠の間）です。ボタンの場合は見た目が大きくなるだけでなく、押せる範囲も広がるので押しやすくなります。"),
    task: "padding-button",
    taskLabel: tr("内側余白を左右32px・上下16pxにする"),
    prepare: { rightTab: "style", openSection: "style-spacing" },
  },
  {
    target: "style-spacing",
    placement: "left",
    chapter: tr("レイアウト"),
    title: tr("外側余白を左右16pxにします"),
    body: tr("外側余白の左右に16を入力してください。"),
    why: tr("外側余白は、要素の外側のすき間（隣の要素との間）です。ボタンの大きさは変わらず、2つのボタンの間隔だけが広がります。要素そのものを大きくしたいなら内側余白、隣との間をあけたいなら外側余白を使います。"),
    task: "margin-button",
    taskLabel: tr("外側余白を左右16pxにする"),
    prepare: { rightTab: "style", openSection: "style-spacing" },
  },

  /* ---------- 自由な位置 ---------- */
  {
    target: "style-position",
    placement: "left",
    chapter: tr("自由な位置"),
    title: tr("ボタンの位置を「カスタム」にします"),
    body: tr("「位置」でカスタムを押してください。"),
    why: tr("「カスタム」は、画像の上に文字を重ねるときなど、要素を並びから外して好きな位置に置きたいときの設定です。便利ですが、ふだんは使いません。その理由を次の2ステップで確かめます。"),
    task: "custom-button",
    taskLabel: tr("位置を「カスタム」にする"),
    prepare: { rightTab: "style", openSection: "style-position" },
  },
  {
    target: "style-position",
    placement: "left",
    chapter: tr("自由な位置"),
    title: tr("XとYを20pxにして動かします"),
    body: tr("Xに20、Yに20を入力してください。"),
    why: tr("数値で好きな位置に動かせますが、このボタンはボックスの並びから外れます（もう1つのボタンが空いた場所に詰めてきたのが分かります）。そのため、画面幅が変わるとほかの要素と重なりやすくなります。"),
    task: "move-button",
    taskLabel: tr("Xを20px・Yを20pxにする"),
    prepare: { rightTab: "style", openSection: "style-position" },
  },
  {
    target: "style-position",
    placement: "left",
    chapter: tr("自由な位置"),
    title: tr("位置を「自動」に戻します"),
    body: tr("「自動」を押すと、ボタンは再び横並びに戻ります。"),
    why: tr("ふだんは「自動」のまま、並び方はボックス（親）に任せるのが崩れにくいページの作り方です。「カスタム」は、要素を重ねたいときだけ使いましょう。"),
    task: "reset-button-position",
    taskLabel: tr("位置を「自動」に戻す"),
    prepare: { rightTab: "style", openSection: "style-position" },
  },

  /* ---------- 見た目 ---------- */
  {
    target: "style-appearance",
    placement: "left",
    chapter: tr("見た目を整える"),
    title: tr("ボタンの角を12pxに丸めます"),
    body: tr("「外見」の角の丸みに12を入力し、Enterを押してください。"),
    why: tr("角の丸みで、ボタンの印象は大きく変わります。サイト内のボタンの丸みをそろえると、全体に統一感が出ます。"),
    task: "round-button",
    taskLabel: tr("角の丸みを12pxにする"),
    prepare: { rightTab: "style", openSection: "style-appearance" },
  },
  {
    target: "style-background",
    placement: "left",
    chapter: tr("見た目を整える"),
    title: tr("ボタンの背景色を「#2563eb」にします"),
    body: tr("「背景」の色に #2563eb を入力し、Enterを押してください。"),
    why: tr("色の付いたボタンは「ここを押せる」「ここが大事」と伝えます。目立つ色を大事なボタンだけに使うと、本当に見てほしい所がきちんと目立ちます。"),
    task: "color-button",
    taskLabel: tr("背景色を #2563eb にする"),
    prepare: { rightTab: "style", openSection: "style-background" },
  },

  /* ---------- 動き ---------- */
  {
    target: "right-tab-settings",
    placement: "left",
    chapter: tr("動きを付ける"),
    title: tr("右パネルの「設定」を開きます"),
    body: tr("ボタンを押したときの動きを付けます。"),
    why: tr("右パネルは、見た目を変える「スタイル」と、内容や動きを決める「設定」に分かれています。押したときの動きは見た目ではないので、「設定」で決めます。"),
    task: "open-settings",
    taskLabel: tr("右パネルの「設定」を開く"),
  },
  {
    target: "settings-link",
    placement: "left",
    chapter: tr("動きを付ける"),
    title: tr("押したら別のページが開くようにします"),
    body: tr("「ページのスクリプトを編集」を開き、「クリックしたとき」をワークスペースへドラッグして、その下に「［ページ］を開く」をつなげます。きっかけの要素はこのボタンになっています。開くページは練習ページ以外を選んでください。"),
    why: tr("動きは「きっかけ（例：クリックしたとき）」と「動作（例：ページを開く）」を組み合わせて作ります。この組み合わせ方を覚えれば、表示の切り替えやスクロール、データの表示なども同じやり方で作れます。"),
    task: "link-button",
    taskLabel: tr("既存ページへのリンクを設定する"),
    prepare: { rightTab: "settings" },
  },

  /* ---------- スマホ対応 ---------- */
  {
    target: "breakpoint-{mobileId}",
    placement: "bottom",
    chapter: tr("スマホに対応する"),
    title: tr("上部の「{mobile}」を押します"),
    body: tr("キャンバスが{mobile}の幅に切り替わります。上部に、いまどの画面幅を編集しているかが出ます。"),
    why: tr("パソコンで作った見た目が、すべての画面幅の基本になります。小さい画面では変えたい所だけを上書きすればよいので、画面幅ごとに作り直す必要はありません。"),
    task: "mobile-view",
    taskLabel: tr("{mobile}の表示に切り替える"),
    needsBreakpoint: true,
  },
  {
    target: "style-layout",
    placement: "left",
    chapter: tr("スマホに対応する"),
    title: tr("{mobile}ではボタンを縦に並べます"),
    body: tr("{mobile}の表示のまま、ボックスのフローで下向きの矢印を押してください。"),
    why: tr("狭い画面でボタンを横に並べると窮屈になります。ここで変えた設定は{mobile}の表示にだけ反映されるので、パソコンでは横並びのままです（上部の「パソコン」を押すと確かめられます）。"),
    task: "mobile-box",
    taskLabel: tr("{mobile}だけ縦並びにする"),
    prepare: { rightTab: "style", openSection: "style-layout" },
    needsBreakpoint: true,
  },

  /* ---------- 確認 ---------- */
  {
    target: "preview",
    placement: "bottom",
    chapter: tr("仕上がりを確かめる"),
    title: tr("「プレビュー」を押します"),
    body: tr("選択枠などが消え、公開したときと同じようにボタンやリンクを操作できます。"),
    why: tr("編集画面でのクリックは、要素を選ぶための操作です。プレビューではスクリプトも実際に動くので、公開する前に「押したらどうなるか」まで確かめられます。"),
    task: "preview",
    taskLabel: tr("プレビューへ切り替える"),
  },
  {
    placement: "center",
    chapter: tr("チュートリアル完了"),
    title: tr("練習ページが完成しました"),
    body: tr("ここで使った考え方は、どんなページを作るときも同じです。"),
    bullets: [
      tr("キャンバスで選んで、右パネルで変える"),
      tr("並べ方は親で決める（フロー・配置・余白）"),
      tr("位置のカスタムは、重ねたいときだけ"),
      tr("動きは「きっかけ」と「動作」の組み合わせ"),
      tr("スマホでは、変えたい所だけを上書きする"),
      tr("練習ページを公開したいときは、ページ設定の「このページを公開する」をオンにします"),
    ],
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const EDGE = 12;
const TARGET_GAP = 7;
const CARD_GAP = 18;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pageNodeIds(doc: SiteDoc, pageId: string | null): string[] {
  if (!pageId) return [];
  const result: string[] = [];
  const walk = (id: string) => {
    const node = doc.nodes[id];
    if (!node) return;
    result.push(id);
    node.children.forEach(walk);
  };
  doc.pages[pageId]?.children.forEach(walk);
  return result;
}

export default function Tutorial({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const leftTab = useEditor((s) => s.leftTab);
  const breakpoint = useEditor((s) => s.breakpoint);
  const mode = useEditor((s) => s.mode);
  const initialPageIds = useRef(new Set(useEditor.getState().doc.pageOrder));
  const expectedSlug = useRef(
    (() => {
      const initialDoc = useEditor.getState().doc;
      const used = new Set(Object.values(initialDoc.pages).map((page) => page.slug));
      if (!used.has("practice")) return "practice";
      let suffix = 2;
      while (used.has(`practice-${suffix}`)) suffix += 1;
      return `practice-${suffix}`;
    })()
  ).current;
  const [index, setIndex] = useState(0);
  const rightTab = useEditor((s) => s.rightTab);
  /** スマホ対応の手順で使う、いちばん小さいブレークポイント（無ければその手順を省く） */
  const mobileBp = useRef(BP_ORDER.length > 1 ? BP_ORDER[BP_ORDER.length - 1] : null).current;
  const STEPS = useMemo(
    () => ALL_STEPS.filter((st) => !st.needsBreakpoint || mobileBp),
    [mobileBp]
  );
  const [uiRevision, setUiRevision] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ width: 380, height: 270 });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const formatStepText = (value: string) =>
    value
      .replaceAll("{slug}", expectedSlug)
      .replaceAll("{mobileId}", mobileBp ?? "")
      .replaceAll("{mobile}", mobileBp ? BP_INFO[mobileBp]?.label ?? tr("スマホ") : tr("スマホ"));
  const target = step.target ? formatStepText(step.target) : undefined;

  const createdPageId =
    doc.pageOrder.find((id) => !initialPageIds.current.has(id)) ?? null;
  const tutorialPage = createdPageId ? doc.pages[createdPageId] : null;
  const tutorialNodeIds = pageNodeIds(doc, createdPageId);
  const heading = tutorialNodeIds
    .map((id) => doc.nodes[id])
    .find((node) => !!node.text && node.text.heading > 0);
  const paragraph = tutorialNodeIds
    .map((id) => doc.nodes[id])
    .find((node) => node.name === tr("テキスト") && node.text?.heading === 0);
  const tutorialBox = tutorialNodeIds
    .map((id) => doc.nodes[id])
    .find((node) => node.name === tr("ボックス") && !node.text);
  const childButtons = (tutorialBox?.children ?? [])
    .map((id) => doc.nodes[id])
    .filter((node) => node?.name === tr("ボタン"));
  const button = childButtons[0];
  // 操作に必要な要素を選んだ状態にする（追加は、選んだ要素の後ろ・中に入る）
  const preparedSelectionId =
    step.task === "edit-heading" || step.task === "style-heading" || step.task === "add-text"
      ? heading?.id
      : step.task === "edit-text" || step.task === "add-box"
        ? paragraph?.id
        : step.task === "add-first-child" ||
            step.task === "add-second-child" ||
            step.task === "flow-box" ||
            step.task === "align-box" ||
            step.task === "mobile-box"
          ? tutorialBox?.id
          : step.task === "open-settings" ||
              step.task === "link-button" ||
              step.task === "padding-button" ||
              step.task === "margin-button" ||
              step.task === "custom-button" ||
              step.task === "move-button" ||
            step.task === "reset-button-position" ||
            step.task === "round-button" ||
            step.task === "color-button"
            ? button?.id
            : undefined;

  const taskDone = (() => {
    switch (step.task) {
      case "open-pages":
        return leftTab === "pages";
      case "create-page":
        return !!tutorialPage;
      case "unpublish-page":
        return !!tutorialPage?.unpublished;
      case "name-page":
        return tutorialPage?.name === tr("練習ページ");
      case "slug-page":
        return tutorialPage?.slug === expectedSlug;
      case "open-add":
        return leftTab === "add";
      case "add-heading":
        return !!heading;
      case "edit-heading":
        return heading?.text?.content.trim() === tr("はじめてのページ");
      case "style-heading":
        return heading?.styles.base?.default?.fontSize === "40px";
      case "add-text":
        return !!paragraph;
      case "edit-text":
        return (
          paragraph?.text?.content.trim() ===
          tr("このページはチュートリアルで作りました。")
        );
      case "add-box":
        return !!tutorialBox;
      case "add-first-child":
        return childButtons.length >= 1;
      case "add-second-child":
        return childButtons.length >= 2;
      case "flow-box":
        return (
          tutorialBox?.styles.base?.default?.display === "flex" &&
          tutorialBox.styles.base.default.flexDirection === "row"
        );
      case "align-box":
        return (
          tutorialBox?.styles.base?.default?.justifyContent === "center" &&
          tutorialBox.styles.base.default.alignItems === "center"
        );
      case "padding-button":
        return (
          button?.styles.base?.default?.paddingLeft === "32px" &&
          button.styles.base.default.paddingRight === "32px" &&
          button.styles.base.default.paddingTop === "16px" &&
          button.styles.base.default.paddingBottom === "16px"
        );
      case "margin-button":
        return (
          button?.styles.base?.default?.marginLeft === "16px" &&
          button.styles.base.default.marginRight === "16px"
        );
      case "custom-button":
        return button?.styles.base?.default?.position === "absolute";
      case "move-button":
        return (
          button?.styles.base?.default?.position === "absolute" &&
          button.styles.base.default.left === "20px" &&
          button.styles.base.default.top === "20px"
        );
      case "reset-button-position":
        return !button?.styles.base?.default?.position;
      case "round-button":
        return button?.styles.base?.default?.borderRadius === "12px";
      case "color-button":
        return (
          button?.styles.base?.default?.backgroundColor?.toLowerCase() ===
          "#2563eb"
        );
      case "open-settings":
        return rightTab === "settings";
      case "link-button":
        return (
          button?.link?.kind === "page" &&
          !!button.link.pageId &&
          initialPageIds.current.has(button.link.pageId)
        );
      case "mobile-view":
        return !!mobileBp && breakpoint === mobileBp;
      case "mobile-box":
        return (
          !!mobileBp &&
          tutorialBox?.styles[mobileBp]?.default?.display === "flex" &&
          tutorialBox.styles[mobileBp].default?.flexDirection === "column"
        );
      case "preview":
        return mode === "preview";
      default:
        return true;
    }
  })();


  // 操作に必要なページ・タブ・選択・セクションが閉じられても自動で復元する。
  useLayoutEffect(() => {
    let cancelled = false;
    const restore = () => {
      if (cancelled || taskDone) return;
      const state = useEditor.getState();
      if (index >= 3 && createdPageId && state.activePageId !== createdPageId) {
        state.setActivePage(createdPageId);
        return;
      }
      // スクリプト画面はリンクの手順でだけ使う（開いたままだと次の操作の場所が隠れる）
      if (state.scriptEditor && step.task !== "link-button") {
        state.openScriptEditor(null);
        return;
      }
      if (step.prepare?.leftTab && state.leftTab !== step.prepare.leftTab) {
        state.setLeftTab(step.prepare.leftTab);
        return;
      }
      if (step.prepare?.clearSelection && state.selection !== null) {
        state.select(null);
        return;
      }
      if (preparedSelectionId && state.selection !== preparedSelectionId) {
        state.select(preparedSelectionId);
        return;
      }
      if (step.prepare?.rightTab && state.rightTab !== step.prepare.rightTab) {
        state.setRightTab(step.prepare.rightTab);
        return;
      }
      if (step.prepare?.openSection) {
        const section = document.querySelector<HTMLElement>(
          `[data-tutorial="${step.prepare.openSection}"]`
        );
        if (section && !section.querySelector(".sec-head.is-open")) {
          section.querySelector<HTMLElement>(".sec-title")?.click();
          setUiRevision((value) => value + 1);
        }
      }
    };
    restore();
    const timer = window.setInterval(restore, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    createdPageId,
    index,
    preparedSelectionId,
    taskDone,
    step.prepare?.clearSelection,
    step.prepare?.leftTab,
    step.prepare?.openSection,
    step.prepare?.rightTab,
  ]);

  const measureTarget = useCallback(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tutorial="${target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const next = el.getBoundingClientRect();
    setRect({
      top: Math.max(0, next.top),
      left: Math.max(0, next.left),
      width: Math.max(
        0,
        Math.min(window.innerWidth, next.right) - Math.max(0, next.left)
      ),
      height: Math.max(
        0,
        Math.min(window.innerHeight, next.bottom) - Math.max(0, next.top)
      ),
    });
  }, [target, selection, leftTab, mode, rightTab, uiRevision]);

  useLayoutEffect(() => {
    let measureFrame = 0;
    const scrollFrame = requestAnimationFrame(() => {
      if (target) {
        document
          .querySelector<HTMLElement>(`[data-tutorial="${target}"]`)
          ?.scrollIntoView({ block: "center", inline: "nearest" });
      }
      measureFrame = requestAnimationFrame(measureTarget);
    });
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    // 開くアニメーション（拡大・フェード）の途中で測ると枠が小さくなるため、終わったら測り直す
    window.addEventListener("animationend", measureTarget, true);
    window.addEventListener("transitionend", measureTarget, true);
    const el = target
      ? document.querySelector<HTMLElement>(`[data-tutorial="${target}"]`)
      : null;
    const observer =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measureTarget)
        : null;
    if (el) observer?.observe(el);
    return () => {
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(measureFrame);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
      window.removeEventListener("animationend", measureTarget, true);
      window.removeEventListener("transitionend", measureTarget, true);
      observer?.disconnect();
    };
  }, [index, measureTarget, target]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => {
      const next = card.getBoundingClientRect();
      setCardSize({ width: next.width, height: next.height });
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(card);
    return () => observer?.disconnect();
  }, [index, taskDone]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [index, taskDone]);

  useEffect(() => {
    if (!step.task || !taskDone) return;
    const timer = window.setTimeout(() => {
      setIndex((value) => Math.min(STEPS.length - 1, value + 1));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [index, step.task, taskDone]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      // ドロップダウン・色の選択・右クリックメニューなどを閉じる Esc では、チュートリアルを終えない
      const popupOpen = !!document.querySelector(
        ".dd-menu, .color-pop, .modal-backdrop:not(.is-leaving), [data-se-popover]"
      );
      if (event.key === "Escape" && !isTyping && !popupOpen) onClose();
      if (event.key === "ArrowRight" && !isTyping && taskDone) {
        setIndex((value) => Math.min(STEPS.length - 1, value + 1));
      }
      if (event.key === "ArrowLeft" && !isTyping) {
        setIndex((value) => Math.max(0, value - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, taskDone]);

  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  let cardTop = (viewportHeight - cardSize.height) / 2;
  let cardLeft = (viewportWidth - cardSize.width) / 2;
  if (rect && step.placement !== "center") {
    if (step.placement === "bottom" || step.placement === "top") {
      const preferBottom = step.placement === "bottom";
      cardTop = preferBottom
        ? rect.top + rect.height + CARD_GAP
        : rect.top - cardSize.height - CARD_GAP;
      if (cardTop < EDGE || cardTop + cardSize.height > viewportHeight - EDGE) {
        cardTop = preferBottom
          ? rect.top - cardSize.height - CARD_GAP
          : rect.top + rect.height + CARD_GAP;
      }
      cardLeft = rect.left + (rect.width - cardSize.width) / 2;
    } else {
      const preferRight = step.placement === "right";
      cardLeft = preferRight
        ? rect.left + rect.width + CARD_GAP
        : rect.left - cardSize.width - CARD_GAP;
      if (cardLeft < EDGE || cardLeft + cardSize.width > viewportWidth - EDGE) {
        cardLeft = preferRight
          ? rect.left - cardSize.width - CARD_GAP
          : rect.left + rect.width + CARD_GAP;
      }
      cardTop = rect.top + (rect.height - cardSize.height) / 2;
    }
  }
  cardTop = clamp(
    cardTop,
    EDGE,
    Math.max(EDGE, viewportHeight - cardSize.height - EDGE)
  );
  cardLeft = clamp(
    cardLeft,
    EDGE,
    Math.max(EDGE, viewportWidth - cardSize.width - EDGE)
  );

  const finish = index === STEPS.length - 1;
  const goNext = () => {
    if (!taskDone) return;
    if (finish) {
      useEditor.getState().setMode("design");
      onClose();
    } else {
      setIndex((value) => value + 1);
    }
  };
  const spotlight = rect
    ? {
        top: rect.top - TARGET_GAP,
        left: rect.left - TARGET_GAP,
        width: rect.width + TARGET_GAP * 2,
        height: rect.height + TARGET_GAP * 2,
      }
    : null;

  return (
    <div className="tutorial" aria-live="polite">
      {spotlight ? (
        <>
          <div
            className="tutorial-shade"
            style={{ height: Math.max(0, spotlight.top) }}
          />
          <div
            className="tutorial-shade"
            style={{ top: spotlight.top + spotlight.height, bottom: 0 }}
          />
          <div
            className="tutorial-shade"
            style={{
              top: Math.max(0, spotlight.top),
              left: 0,
              width: Math.max(0, spotlight.left),
              height: spotlight.height,
            }}
          />
          <div
            className="tutorial-shade"
            style={{
              top: Math.max(0, spotlight.top),
              left: spotlight.left + spotlight.width,
              right: 0,
              height: spotlight.height,
            }}
          />
          <div className="tutorial-spotlight" style={spotlight} />
        </>
      ) : (
        <div className="tutorial-shade tutorial-shade-full" />
      )}

      <div
        ref={cardRef}
        className="tutorial-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-body"
        style={{ top: cardTop, left: cardLeft }}
      >
        <button
          className="tutorial-close"
          onClick={onClose}
          aria-label={tr("チュートリアルを終了")}
          data-tip={tr("終了")}
        >
          <X size={15} />
        </button>
        <div className="tutorial-eyebrow">{step.chapter}</div>
        <h2 id="tutorial-title">{formatStepText(step.title)}</h2>
        <p id="tutorial-body">{formatStepText(step.body)}</p>
        {step.why && (
          <div className="tutorial-why">
            <Lightbulb size={14} />
            <div>
              <b>{tr("なぜ？")}</b>
              {formatStepText(step.why)}
            </div>
          </div>
        )}
        {step.bullets && (
          <ul className="tutorial-points">
            {step.bullets.map((point) => (
              <li key={point}>{formatStepText(point)}</li>
            ))}
          </ul>
        )}
        {step.task && (
          <div className={`tutorial-task${taskDone ? " is-done" : ""}`}>
            {taskDone ? <CheckCircle2 size={15} /> : <Circle size={15} />}
            <span>
              {taskDone
                ? tr("操作完了")
                : step.taskLabel
                  ? formatStepText(step.taskLabel)
                  : tr("操作してください")}
            </span>
          </div>
        )}

        <div
          className="tutorial-progress"
          aria-label={`${index + 1} / ${STEPS.length}`}
        >
          {STEPS.map((_, stepIndex) => (
            <span
              key={stepIndex}
              className={
                stepIndex === index
                  ? "is-current"
                  : stepIndex < index
                    ? "is-done"
                    : ""
              }
            />
          ))}
        </div>

        <div className="tutorial-actions">
          <span className="tutorial-count">
            {index + 1} / {STEPS.length}
          </span>
          {index > 0 && (
            <button className="btn" onClick={() => setIndex((value) => value - 1)}>
              <ChevronLeft size={14} />
              {tr("戻る")}
            </button>
          )}
          {!step.task && (
            <button
              ref={primaryRef}
              className="btn btn-primary"
              onClick={goNext}
            >
              {finish ? (
                <>
                  <Check size={14} />
                  {tr("完了")}
                </>
              ) : (
                <>
                  {index === 0 ? tr("始める") : tr("次へ")}
                  <ChevronRight size={14} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
