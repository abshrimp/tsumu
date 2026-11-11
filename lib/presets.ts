import type {
  DocNode,
  EmbedContent,
  FieldContent,
  FieldKind,
  NodeStyles,
  Page,
  Script,
  ScriptStep,
  SiteDoc,
  StyleMap,
} from "./types";
import { getLang, tr, trc } from "./i18n";
import { BP_ORDER } from "./style";

let counter = 0;
/**
 * 要素・ページなどのID。時刻と通し番号だけだと、共同編集の別の人（や別のサーバー）が
 * 同じミリ秒に同じ番号で作ったときに重なり、マージで別の要素が1つに混ざるため、ランダムな部分も付ける
 */
export function genId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${randomPart()}`;
}

/** IDに付ける、ランダムな英数字4文字 */
export function randomPart(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

function base(styles: StyleMap): NodeStyles {
  return { base: { default: styles } };
}

export function makeBox(name = tr("Box"), styles: StyleMap = {}): DocNode {
  return {
    id: genId("node"),
    type: "box",
    name,
    semantic: "auto",
    text: null,
    link: null,
    children: [],
    styles: base({
      display: "flex",
      flexDirection: "column",
      padding: "0px",
      gap: "0px",
      ...styles,
    }),
  };
}

export function makeText(content = tr("Text", "text_variant_1"), styles: StyleMap = {}): DocNode {
  return {
    id: genId("node"),
    type: "box",
    name: tr("Text", "text_variant_1"),
    semantic: "auto",
    text: { content, heading: 0 },
    link: null,
    children: [],
    styles: base({ fontSize: "16px", lineHeight: "1.7", ...styles }),
  };
}

/** リンク（押すとURL・ページを開く文字。行き先は要素の設定で決める） */
export function makeLink(label = tr("Link")): DocNode {
  return {
    ...makeText(label, { color: "#0b57d0", textDecoration: "underline", textUnderlineOffset: "3px" }),
    name: tr("Link"),
    link: { kind: "url", url: "" },
  };
}

/** スイッチ（非表示のチェックボックスとオン・オフのボックスをスクリプトで切り替える） */
export function makeSwitch(): PresetResult {
  const checkbox = makeField("checkbox");
  checkbox.attrId = "toggle";
  checkbox.field = { kind: "checkbox", label: "" };
  checkbox.hiddenOn = [...BP_ORDER];

  const thumbStyles: StyleMap = {
    width: "16px",
    height: "16px",
    borderRadius: "999px",
    backgroundColor: "#ffffff",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.25)",
  };
  const trackStyles: StyleMap = {
    flexDirection: "row",
    alignItems: "center",
    width: "36px",
    height: "20px",
    padding: "2px",
    borderRadius: "999px",
  };

  const offThumb = makeBox(tr("Thumb"), thumbStyles);
  const offTrack = makeBox(tr("Off"), {
    ...trackStyles,
    justifyContent: "flex-start",
    backgroundColor: "#d4d4d8",
  });
  offTrack.attrId = "switch-off";
  offTrack.children = [offThumb.id];

  const onThumb = makeBox(tr("Thumb"), thumbStyles);
  const onTrack = makeBox(tr("On"), {
    ...trackStyles,
    justifyContent: "flex-end",
    backgroundColor: "#0b57d0",
  });
  onTrack.attrId = "switch-on";
  onTrack.hiddenOn = [...BP_ORDER];
  onTrack.children = [onThumb.id];

  const label = makeText(tr("Get notifications"), { fontSize: "14px", lineHeight: "1.4" });

  const root = makeBox(tr("Switch"), {
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
  });
  root.children = [checkbox.id, offTrack.id, onTrack.id, label.id];
  root.scripts = [
    {
      id: genId("sc"),
      trigger: "click",
      pos: { x: 32, y: 32 },
      steps: [
        {
          id: genId("st"),
          kind: "if",
          cond: { subject: "checked", target: "toggle" },
          then: [
            { id: genId("st"), kind: "set-value", target: "toggle", value: "false" },
            { id: genId("st"), kind: "show", target: "switch-off" },
            { id: genId("st"), kind: "hide", target: "switch-on" },
          ],
          else: [
            { id: genId("st"), kind: "set-value", target: "toggle", value: "true" },
            { id: genId("st"), kind: "hide", target: "switch-off" },
            { id: genId("st"), kind: "show", target: "switch-on" },
          ],
        },
      ],
    },
  ];
  return {
    root,
    nodes: [root, checkbox, offTrack, offThumb, onTrack, onThumb, label],
  };
}

export function makeHeading(
  content = tr("Heading"),
  level = 2,
  styles: StyleMap = {}
): DocNode {
  const sizes: Record<number, string> = {
    1: "44px",
    2: "32px",
    3: "24px",
    4: "20px",
    5: "17px",
    6: "15px",
  };
  return {
    id: genId("node"),
    type: "box",
    name: content.slice(0, 12) || tr("Heading"),
    semantic: "auto",
    text: { content, heading: level },
    link: null,
    children: [],
    styles: base({
      fontSize: sizes[level] ?? "24px",
      fontWeight: "700",
      lineHeight: "1.4",
      ...styles,
    }),
  };
}

export function makeButton(label = tr("Button")): DocNode {
  return {
    id: genId("node"),
    type: "box",
    name: tr("Button"),
    // <button> で出力する（リンクを付けると <a> になる）
    semantic: "button",
    text: { content: label, heading: 0 },
    link: null,
    children: [],
    styles: {
      base: {
        default: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px 28px",
          backgroundColor: "#18181b",
          color: "#ffffff",
          fontSize: "14px",
          fontWeight: "600",
          borderRadius: "8px",
          border: "none",
          textDecoration: "none",
          transition: "all 200ms ease",
          cursor: "pointer",
        },
        hover: { backgroundColor: "#3f3f46" },
      },
    },
  };
}

export function makeImage(): DocNode {
  return {
    id: genId("node"),
    type: "image",
    name: tr("Image"),
    semantic: "auto",
    text: null,
    link: null,
    image: {
      src: "https://picsum.photos/seed/editor/800/500",
      alt: "",
      width: 800,
      height: 500,
    },
    children: [],
    styles: base({ width: "100%" }),
  };
}

export function makeDivider(): DocNode {
  return {
    id: genId("node"),
    type: "divider",
    name: tr("Divider"),
    semantic: "auto",
    text: null,
    link: null,
    children: [],
    styles: base({
      width: "100%",
      height: "1px",
      backgroundColor: "#e4e4e7",
      border: "none",
      margin: "8px 0",
    }),
  };
}

/** 既定アイコン（lucide の star）。差し替えは設定パネルのピッカーで行う */
const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>`;

export function makeIcon(): DocNode {
  return {
    id: genId("node"),
    type: "icon",
    name: tr("Icon"),
    semantic: "auto",
    text: null,
    link: null,
    icon: { name: "star", svg: DEFAULT_ICON_SVG },
    children: [],
    styles: base({
      width: "24px",
      height: "24px",
      display: "inline-flex",
      color: "#18181b",
    }),
  };
}

export function makeField(kind: FieldKind): DocNode {
  const presets: Record<
    FieldKind,
    { name: string; field: Partial<FieldContent>; attrId?: string; styles: StyleMap }
  > = {
    input: {
      name: tr("Input", "input_variant_1"),
      field: { inputType: "text", placeholder: tr("Enter a value") },
      attrId: "field",
      styles: {
        width: "100%",
        padding: "10px 14px",
        fontSize: "14px",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "#d4d4d8",
        borderRadius: "8px",
        backgroundColor: "#ffffff",
      },
    },
    textarea: {
      name: tr("Text area"),
      field: { placeholder: tr("Write anything you like") },
      attrId: "message",
      styles: {
        width: "100%",
        maxWidth: "480px",
        minHeight: "120px",
        padding: "10px 14px",
        fontSize: "14px",
        border: "1px solid #d4d4d8",
        borderRadius: "8px",
        backgroundColor: "#ffffff",
      },
    },
    select: {
      name: tr("Select", "select_variant_1"),
      field: {
        options: [tr("Select…"), tr("Option A"), tr("Option B")]
          .map((value) => ({ label: value, value })),
      },
      attrId: "choice",
      styles: {
        width: "100%",
        maxWidth: "360px",
        padding: "10px 14px",
        fontSize: "14px",
        border: "1px solid #d4d4d8",
        borderRadius: "8px",
        backgroundColor: "#ffffff",
      },
    },
    checkbox: {
      name: tr("Checkbox", "checkbox_variant_1"),
      field: { label: tr("I agree") },
      attrId: "agree",
      styles: {
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "14px",
        cursor: "pointer",
      },
    },
    radio: {
      name: tr("Radio button"),
      // 同じグループ名のラジオボタンから1つだけ選べる（グループ名が値の変数名になる）
      field: { label: tr("Option A"), group: "radio" },
      attrId: "radio-1",
      styles: {
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "14px",
        cursor: "pointer",
      },
    },
    file: {
      name: tr("File picker"),
      field: {},
      attrId: "file",
      styles: { fontSize: "14px" },
    },
    submit: {
      name: tr("Submit button"),
      field: { label: tr("Search") },
      styles: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // 幅いっぱいの入力欄と横に並べても押しつぶされず、文字が1字ずつ折り返されないように
        flexShrink: "0",
        whiteSpace: "nowrap",
        padding: "10px 24px",
        backgroundColor: "#18181b",
        color: "#ffffff",
        fontSize: "14px",
        fontWeight: "600",
        border: "none",
        borderRadius: "8px",
        cursor: "pointer",
      },
    },
  };
  const p = presets[kind];
  return {
    id: genId("node"),
    type: "field",
    name: p.name,
    semantic: "auto",
    text: null,
    link: null,
    field: { kind, ...p.field },
    attrId: p.attrId,
    children: [],
    styles: base(p.styles),
  };
}

export function makeMedia(kind: "video" | "audio"): DocNode {
  return {
    id: genId("node"),
    type: "media",
    name: kind === "video" ? tr("Video") : tr("Audio"),
    semantic: "auto",
    text: null,
    link: null,
    media: { kind, src: "" },
    children: [],
    styles: base(
      kind === "video"
        ? { width: "100%", maxWidth: "720px" }
        : { width: "100%", maxWidth: "480px" }
    ),
  };
}

export function makeEmbed(kind: EmbedContent["kind"]): DocNode {
  const names = {
    youtube: "YouTube",
    map: tr("Google Maps"),
    url: tr("Embed URL"),
  };
  return {
    id: genId("node"),
    type: "embed",
    name: names[kind],
    semantic: "auto",
    text: null,
    link: null,
    embed: { kind, src: "" },
    children: [],
    styles: base({
      width: "100%",
      maxWidth: "720px",
      aspectRatio: kind === "map" ? "4 / 3" : "16 / 9",
    }),
  };
}

/** リスト要素（テンプレートの項目カード付き） */
export function makeList(from?: string): PresetResult {
  const title = makeHeading(tr("Title"), 3, { fontSize: "18px" });
  const desc = makeText(tr("Description"), { fontSize: "14px", color: "#71717a" });
  const item = makeBox(tr("Item"), {
    padding: "20px",
    gap: "8px",
    backgroundColor: "#ffffff",
    border: "1px solid #e4e4e7",
    borderRadius: "12px",
  });
  item.children = [title.id, desc.id];
  const root: DocNode = {
    id: genId("node"),
    type: "list",
    name: tr("List display"),
    semantic: "auto",
    text: null,
    link: null,
    list: from ? { from } : {},
    children: [item.id],
    styles: base({
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      padding: "0px",
    }),
  };
  return { root, nodes: [root, item, title, desc] };
}

export function makeCode(): DocNode {
  return {
    id: genId("node"),
    type: "code",
    name: tr("Custom code"),
    semantic: "auto",
    text: null,
    link: null,
    code: { html: tr("<p>Write your HTML here</p>") },
    children: [],
    styles: base({}),
  };
}

/* ---------- プリセットレイアウト ---------- */

export interface PresetResult {
  root: DocNode;
  nodes: DocNode[];
}

function link(node: DocNode, url: string): DocNode {
  node.link = { kind: "url", url, newTab: false };
  const s = node.styles.base?.default;
  if (s) {
    s.textDecoration = "none";
    s.color = s.color ?? "#18181b";
  }
  return node;
}

/** ハンバーガーメニュー用アイコン（アイコンピッカーで「menu」を選んだときと同じSVG） */
const MENU_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-menu" aria-hidden="true"><path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path></svg>`;

function presetNavbar(): PresetResult {
  const logo = makeHeading("Site", 6, { fontSize: "18px", fontWeight: "700" });
  logo.name = tr("Logo");
  const l1 = link(makeText(tr("Home"), { fontSize: "14px" }), "#");
  const l2 = link(makeText(tr("Blog"), { fontSize: "14px" }), "#");
  const l3 = link(makeText(tr("Contact"), { fontSize: "14px" }), "#");
  const links = makeBox(tr("Nav links"), {
    flexDirection: "row",
    gap: "28px",
    padding: "0px",
    alignItems: "center",
  });
  links.children = [l1.id, l2.id, l3.id];
  links.attrId = "nav-links";
  // スマホ幅: 非表示のドロップダウンにして、ハンバーガーの表示切替で開閉する
  links.styles.sm = {
    default: {
      display: "none",
      position: "absolute",
      top: "100%",
      left: "0",
      right: "0",
      zIndex: "50",
      flexDirection: "column",
      alignItems: "stretch",
      gap: "0px",
      padding: "8px 0",
      backgroundColor: "#ffffff",
      borderBottom: "1px solid #e4e4e7",
    },
  };
  for (const l of [l1, l2, l3]) {
    l.styles.sm = { default: { padding: "12px 24px" } };
  }

  // スマホ幅で表示するハンバーガー。スクリプトで #nav-links を開閉する
  const toggle: DocNode = {
    id: genId("node"),
    type: "icon",
    name: tr("Menu toggle"),
    semantic: "auto",
    text: null,
    link: null,
    icon: { name: "menu", svg: MENU_ICON_SVG },
    scripts: [
      {
        id: genId("sc"),
        trigger: "click",
        pos: { x: 32, y: 32 },
        steps: [{ id: genId("st"), kind: "toggle", target: "nav-links" }],
      },
    ],
    children: [],
    styles: {
      base: {
        default: {
          display: "none",
          width: "24px",
          height: "24px",
          color: "#18181b",
          cursor: "pointer",
        },
      },
      sm: { default: { display: "inline-flex" } },
    },
  };

  const root = makeBox(tr("Navbar"), {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 40px",
    gap: "24px",
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e4e4e7",
  });
  root.semantic = "header";
  root.attrId = "navbar";
  root.children = [logo.id, links.id, toggle.id];
  return { root, nodes: [root, logo, links, toggle, l1, l2, l3] };
}

function presetHero(): PresetResult {
  const h = makeHeading(tr("Your headline here,\nacross two lines."), 1, {
    textAlign: "center",
    letterSpacing: "-0.02em",
  });
  const p = makeText(
    tr("A short introduction to your site. Say what it does and who it's for."),
    { fontSize: "17px", color: "#71717a", textAlign: "center", maxWidth: "560px" }
  );
  const btn = makeButton(tr("Get started"));
  const root = makeBox(tr("Hero"), {
    alignItems: "center",
    justifyContent: "center",
    padding: "110px 40px",
    gap: "24px",
    backgroundColor: "#fafafa",
  });
  root.children = [h.id, p.id, btn.id];
  return { root, nodes: [root, h, p, btn] };
}

function presetCards(): PresetResult {
  const nodes: DocNode[] = [];
  const cardIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const t = makeHeading(tr("Card {i}", { i }), 2, { fontSize: "18px" });
    const d = makeText(tr("Add a description here."), {
      fontSize: "14px",
      color: "#71717a",
    });
    const card = makeBox(tr("Card {i}", { i }), {
      padding: "28px",
      gap: "10px",
      backgroundColor: "#ffffff",
      borderRadius: "12px",
      border: "1px solid #e4e4e7",
    });
    card.children = [t.id, d.id];
    nodes.push(card, t, d);
    cardIds.push(card.id);
  }
  const root = makeBox(tr("Card grid"), {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "20px",
    padding: "64px 40px",
  });
  root.styles.md = { default: { gridTemplateColumns: "repeat(1, 1fr)" } };
  root.children = cardIds;
  return { root, nodes: [root, ...nodes] };
}

function presetFooter(): PresetResult {
  const t = makeText("© 2026 Your Site", {
    fontSize: "13px",
    color: "#71717a",
  });
  const root = makeBox(tr("Footer"), {
    alignItems: "center",
    padding: "40px",
    backgroundColor: "#fafafa",
    borderTop: "1px solid #e4e4e7",
  });
  root.semantic = "footer";
  root.children = [t.id];
  return { root, nodes: [root, t] };
}


/* ---------- 初期ドキュメント ---------- */

/** サンプルデータソース（dummyjson.com の商品カタログ） */
const DEMO_PRODUCTS_SAMPLE: Record<string, unknown>[] = [
  {
    id: 1,
    title: "Essence Mascara Lash Princess",
    description:
      "The Essence Mascara Lash Princess is a popular mascara known for its volumizing …",
    price: 9.99,
    thumbnail:
      "https://cdn.dummyjson.com/product-images/beauty/essence-mascara-lash-princess/thumbnail.webp",
    category: "beauty",
    brand: "Essence",
    rating: 2.56,
  },
  {
    id: 2,
    title: "Eyeshadow Palette with Mirror",
    description:
      "The Eyeshadow Palette with Mirror offers a versatile range of eyeshadow shades f…",
    price: 19.99,
    thumbnail:
      "https://cdn.dummyjson.com/product-images/beauty/eyeshadow-palette-with-mirror/thumbnail.webp",
    category: "beauty",
    brand: "Glamour Beauty",
    rating: 2.86,
  },
  {
    id: 3,
    title: "Powder Canister",
    description:
      "The Powder Canister is a finely milled setting powder designed to set makeup and…",
    price: 14.99,
    thumbnail:
      "https://cdn.dummyjson.com/product-images/beauty/powder-canister/thumbnail.webp",
    category: "beauty",
    brand: "Velvet Touch",
    rating: 4.64,
  },
  {
    id: 4,
    title: "Red Lipstick",
    description:
      "The Red Lipstick is a classic and bold choice for adding a pop of color to your …",
    price: 12.99,
    thumbnail:
      "https://cdn.dummyjson.com/product-images/beauty/red-lipstick/thumbnail.webp",
    category: "beauty",
    brand: "Chic Cosmetics",
    rating: 4.36,
  },
];

/** スクリプト「このページ｜ページを開いたとき → ［URL］のデータを取得する → …」 */
function loadScript(url: string, sample: unknown, then: ScriptStep[]): Script {
  return {
    id: genId("sc"),
    trigger: "load",
    pos: { x: 32, y: 32 },
    steps: [
      { id: genId("st"), kind: "fetch", url, as: trc("variable_name", "data"),
        preview: { sample, fetchedAt: Date.now() } },
      ...then,
    ],
  };
}

/** dummyjson.com を使った商品一覧・詳細のデモページ一式 */
function buildDemoProducts(nodes: Record<string, DocNode>): {
  listPage: Page;
  detailPage: Page;
} {
  const add = <T extends DocNode>(n: T): T => {
    nodes[n.id] = n;
    return n;
  };
  /* --- 詳細ページ（動的） --- */
  const dImg = add(makeImage());
  dImg.name = tr("Product image");
  dImg.image = {
    src: String(DEMO_PRODUCTS_SAMPLE[0].thumbnail),
    alt: tr("Product image"),
    width: 400,
    height: 400,
  };
  dImg.image.src = tr("{product.thumbnail}");
  dImg.styles.base!.default = {
    width: "320px",
    borderRadius: "16px",
    backgroundColor: "#fafafa",
  };
  const dTitle = add(makeHeading(tr("{product.title}"), 1, { fontSize: "34px" }));
  dTitle.name = tr("Product name");
  const dBrand = add(
    makeText(tr("{product.brand}"), { fontSize: "13px", color: "#a1a1aa" })
  );
  dBrand.name = tr("Brand");
  const dDesc = add(
    makeText(tr("{product.description}"), { fontSize: "15px", color: "#52525b" })
  );
  dDesc.name = tr("Description");
  const dPrice = add(
    makeHeading(tr("${product.price}"), 2, { fontSize: "26px", color: "#0d99ff" })
  );
  dPrice.name = tr("Price");
  const dInfo = add(
    makeBox(tr("Product info"), {
      padding: "0px",
      gap: "12px",
      alignItems: "flex-start",
    })
  );
  dInfo.styles.base!.default!.flex = "1";
  dInfo.children = [dBrand.id, dTitle.id, dPrice.id, dDesc.id];
  const dWrap = add(
    makeBox(tr("Detail layout"), {
      flexDirection: "row",
      gap: "40px",
      padding: "64px 40px",
      maxWidth: "900px",
      margin: "0 auto",
      width: "100%",
    })
  );
  dWrap.styles.md = { default: { flexDirection: "column" } };
  dWrap.children = [dImg.id, dInfo.id];

  const detailPage: Page = {
    id: genId("page"),
    name: tr("Product detail (demo)"),
    slug: "products/[slug]",
    title: tr("Product detail"),
    description: "",
    children: [dWrap.id],
    pageScripts: [
      loadScript("https://dummyjson.com/products/{slug}", DEMO_PRODUCTS_SAMPLE[0], [
        { id: genId("st"), kind: "set-var", value: tr("{data}"), into: trc("variable_name", "product") },
      ]),
    ],
  };

  /* --- 一覧ページ --- */
  const lHead = add(makeHeading(tr("Product catalog"), 1, { textAlign: "center" }));
  const lLede = add(
    makeText(
      tr("A sample list, search and detail page powered by data from dummyjson.com."),
      { fontSize: "14px", color: "#71717a", textAlign: "center" }
    )
  );
  const sInput = add(makeField("input"));
  sInput.field = { kind: "input", placeholder: tr("Search products…") };
  sInput.attrId = "q";
  const sBtn = add(makeButton(tr("Search")));
  // 幅いっぱいの入力欄と横に並べても押しつぶされず、文字が1字ずつ折り返されないように
  Object.assign(sBtn.styles.base.default!, { flexShrink: "0", whiteSpace: "nowrap", padding: "10px 24px", fontSize: "14px" });
  const sForm = add(
    makeBox(tr("Search form"), {
      flexDirection: "row",
      gap: "10px",
      padding: "0px",
      justifyContent: "center",
      width: "100%",
    })
  );
  sForm.semantic = "form";
  sForm.children = [sInput.id, sBtn.id];

  const cImg = add(makeImage());
  cImg.name = tr("Thumbnail");
  cImg.image = {
    src: String(DEMO_PRODUCTS_SAMPLE[0].thumbnail),
    alt: tr("Product thumbnail"),
    width: 400,
    height: 400,
  };
  cImg.image.src = "{thumbnail}";
  cImg.styles.base!.default = {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: "10px",
    backgroundColor: "#fafafa",
  };
  const cTitle = add(makeHeading("{title}", 2, { fontSize: "15px" }));
  cTitle.name = tr("Product name");
  const cPrice = add(
    makeText("\u00a5{price}", {
      fontSize: "14px",
      fontWeight: "600",
      color: "#0d99ff",
    })
  );
  cPrice.name = tr("Price");
  const card = add(
    makeBox(tr("Product card"), {
      padding: "0px",
      gap: "10px",
      cursor: "pointer",
    })
  );
  card.children = [cImg.id, cTitle.id, cPrice.id];
  card.link = { kind: "url", url: "/products/{id}" };

  const list = add({
    id: genId("node"),
    type: "list",
    name: tr("Product list"),
    attrId: "product-list",
    semantic: "auto",
    text: null,
    link: null,
    list: {
      from: trc("variable_name", "products"),
      limit: 12,
    },
    children: [card.id],
    styles: {
      base: {
        default: {
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "24px",
          padding: "0px",
          width: "100%",
        },
      },
      md: { default: { gridTemplateColumns: "repeat(2, 1fr)" } },
    },
  } satisfies DocNode);

  const lWrap = add(
    makeBox(tr("Product list section"), {
      padding: "64px 40px",
      gap: "28px",
      alignItems: "center",
      maxWidth: "1080px",
      margin: "0 auto",
      width: "100%",
    })
  );
  lWrap.children = [lHead.id, lLede.id, sForm.id, list.id];

  const listPage: Page = {
    id: genId("page"),
    name: tr("Products (demo)"),
    slug: "catalog",
    title: tr("Products"),
    description: tr("A sample page powered by dummyjson.com data"),
    children: [lWrap.id],
    pageScripts: [
      loadScript(
        "https://dummyjson.com/products/search?q={q}",
        { products: DEMO_PRODUCTS_SAMPLE },
        [{ id: genId("st"), kind: "set-var", value: tr("{data.products}"), into: trc("variable_name", "products") }]
      ),
    ],
  };

  return { listPage, detailPage };
}

export function createInitialDoc(): SiteDoc {
  const nodes: Record<string, DocNode> = {};
  const add = (r: PresetResult) => {
    r.nodes.forEach((n) => (nodes[n.id] = n));
    return r.root.id;
  };
  const nav = add(presetNavbar());
  const hero = add(presetHero());
  const cards = add(presetCards());
  const footer = add(presetFooter());

  const home: Page = {
    id: genId("page"),
    name: tr("Home"),
    slug: "",
    title: tr("Home"),
    description: "",
    children: [nav, hero, cards, footer],
  };

  /* --- 404ページ（URLを「404」にすると not-found として出力される） --- */
  const nfH = makeHeading("404", 1, {
    fontSize: "64px",
    letterSpacing: "0.04em",
    textAlign: "center",
  });
  nfH.name = tr("404 heading");
  const nfT = makeText(tr("We couldn't find the page you're looking for."), {
    fontSize: "15px",
    color: "#71717a",
    textAlign: "center",
  });
  const nfBtn = makeButton(tr("Back to home"));
  nfBtn.link = { kind: "page", pageId: home.id };
  const nfWrap = makeBox(tr("404 section"), {
    alignItems: "center",
    justifyContent: "center",
    padding: "140px 40px",
    gap: "18px",
  });
  nfWrap.children = [nfH.id, nfT.id, nfBtn.id];
  for (const n of [nfWrap, nfH, nfT, nfBtn]) nodes[n.id] = n;

  const notFoundPage: Page = {
    id: genId("page"),
    name: tr("404 (not found)"),
    slug: "404",
    title: tr("Page not found"),
    description: "",
    children: [nfWrap.id],
  };

  const demo = buildDemoProducts(nodes);

  return {
    schemaVersion: 1,
    siteName: "My Site",
    // 初期の文言はエディタの表示言語で入るので、サイトの言語もそれに合わせる
    lang: getLang(),
    colorPalette: [],
    pages: {
      [home.id]: home,
      [demo.listPage.id]: demo.listPage,
      [demo.detailPage.id]: demo.detailPage,
      [notFoundPage.id]: notFoundPage,
    },
    pageOrder: [
      home.id,
      demo.listPage.id,
      demo.detailPage.id,
      notFoundPage.id,
    ],
    nodes,
    assets: {},
  };
}
