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
    title: tr("Basic"),
    items: [
      { key: "box", label: tr("Box"), icon: "box", make: () => makeBox() },
      { key: "text", label: tr("Text", "text_variant_1"), icon: "text", make: () => makeText() },
      {
        key: "heading",
        label: tr("Heading"),
        icon: "heading",
        make: () => makeHeading(),
      },
      {
        key: "button",
        label: tr("Button"),
        icon: "button",
        make: () => makeButton(),
      },
      { key: "link", label: tr("Link"), icon: "link", make: () => makeLink() },
      { key: "image", label: tr("Image"), icon: "image", make: () => makeImage() },
      { key: "icon", label: tr("Icon"), icon: "shapes", make: makeIcon },
      {
        key: "divider",
        label: tr("Divider"),
        icon: "divider",
        make: () => makeDivider(),
      },
    ],
  },
  {
    title: tr("Form"),
    items: [
      {
        key: "input",
        label: tr("Input", "input_variant_1"),
        icon: "input",
        make: () => makeField("input"),
      },
      {
        key: "textarea",
        label: tr("Text area"),
        icon: "textarea",
        make: () => makeField("textarea"),
      },
      {
        key: "select",
        label: tr("Select", "select_variant_1"),
        icon: "select",
        make: () => makeField("select"),
      },
      {
        key: "checkbox",
        label: tr("Checkbox"),
        icon: "checkbox",
        make: () => makeField("checkbox"),
      },
      {
        key: "radio",
        label: tr("Radio"),
        icon: "radio",
        make: () => makeField("radio"),
      },
      { key: "switch", label: tr("Switch"), icon: "switch", make: () => makeSwitch() },
      {
        key: "file",
        label: tr("File"),
        icon: "file",
        make: () => makeField("file"),
      },
    ],
  },
  {
    title: tr("Data"),
    items: [
      { key: "list", label: tr("List display"), icon: "list", make: () => makeList() },
    ],
  },
  {
    title: tr("Media & embeds"),
    items: [
      {
        key: "video",
        label: tr("Video"),
        icon: "video",
        make: () => makeMedia("video"),
      },
      {
        key: "audio",
        label: tr("Audio"),
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
        label: tr("Map"),
        icon: "map",
        make: () => makeEmbed("map"),
      },
      {
        key: "url-embed",
        label: tr("Embed URL"),
        icon: "embed",
        make: () => makeEmbed("url"),
      },
      { key: "code", label: tr("Code"), icon: "code", make: () => makeCode() },
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
