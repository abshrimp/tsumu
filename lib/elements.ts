import type { DocNode } from "./types";
import {
  makeBox,
  makeButton,
  makeCode,
  makeDivider,
  makeEmbed,
  makeField,
  makeHeading,
  makeIcon,
  makeImage,
  makeLink,
  makeList,
  makeMedia,
  makeSwitch,
  makeText,
  type PresetResult,
} from "./presets";
import { tr } from "./i18n";

export interface ElementDef {
  key: string;
  label: string;
  /** components/icons.tsx の Icon 名 */
  icon: string;
  make: () => DocNode | PresetResult;
}

/** make() の戻りを { root, nodes } に正規化 */
export function normalizeMade(
  made: DocNode | PresetResult
): { root: DocNode; nodes: DocNode[] } {
  return "root" in made ? made : { root: made, nodes: [made] };
}

export const ELEMENT_SECTIONS: { title: string; items: ElementDef[] }[] = [
  {
    title: tr("基本"),
    items: [
      { key: "box", label: tr("ボックス"), icon: "box", make: () => makeBox() },
      { key: "text", label: tr("テキスト"), icon: "text", make: () => makeText() },
      {
        key: "heading",
        label: tr("見出し"),
        icon: "heading",
        make: () => makeHeading(),
      },
      {
        key: "button",
        label: tr("ボタン"),
        icon: "button",
        make: () => makeButton(),
      },
      { key: "link", label: tr("リンク"), icon: "link", make: () => makeLink() },
      { key: "image", label: tr("画像"), icon: "image", make: () => makeImage() },
      { key: "icon", label: tr("アイコン"), icon: "shapes", make: makeIcon },
      {
        key: "divider",
        label: tr("区切り線"),
        icon: "divider",
        make: () => makeDivider(),
      },
    ],
  },
  {
    title: tr("フォーム"),
    items: [
      {
        key: "input",
        label: tr("インプット"),
        icon: "input",
        make: () => makeField("input"),
      },
      {
        key: "textarea",
        label: tr("テキストエリア"),
        icon: "textarea",
        make: () => makeField("textarea"),
      },
      {
        key: "select",
        label: tr("選択肢"),
        icon: "select",
        make: () => makeField("select"),
      },
      {
        key: "checkbox",
        label: tr("チェック"),
        icon: "checkbox",
        make: () => makeField("checkbox"),
      },
      {
        key: "radio",
        label: tr("ラジオ"),
        icon: "radio",
        make: () => makeField("radio"),
      },
      { key: "switch", label: tr("スイッチ"), icon: "switch", make: () => makeSwitch() },
      {
        key: "file",
        label: tr("ファイル"),
        icon: "file",
        make: () => makeField("file"),
      },
    ],
  },
  {
    title: tr("データ"),
    items: [
      { key: "list", label: tr("リスト"), icon: "list", make: () => makeList() },
    ],
  },
  {
    title: tr("メディア・埋め込み"),
    items: [
      {
        key: "video",
        label: tr("動画"),
        icon: "video",
        make: () => makeMedia("video"),
      },
      {
        key: "audio",
        label: tr("音声"),
        icon: "audio",
        make: () => makeMedia("audio"),
      },
      {
        key: "youtube",
        label: "YouTube",
        icon: "youtube",
        make: () => makeEmbed("youtube"),
      },
      {
        key: "map",
        label: tr("マップ"),
        icon: "map",
        make: () => makeEmbed("map"),
      },
      {
        key: "url-embed",
        label: tr("URL埋め込み"),
        icon: "embed",
        make: () => makeEmbed("url"),
      },
      { key: "code", label: tr("コード"), icon: "code", make: () => makeCode() },
    ],
  },
];

/** D&D用のMIMEタイプ */
export const ELEMENT_DRAG_TYPE = "application/x-tsumu-element";

export function makeElementByKey(
  key: string
): DocNode | PresetResult | null {
  for (const sec of ELEMENT_SECTIONS) {
    const def = sec.items.find((i) => i.key === key);
    if (def) return def.make();
  }
  return null;
}
