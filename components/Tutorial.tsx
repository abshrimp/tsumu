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
    chapter: tr("Hands-on tutorial"),
    title: tr("Learn the concepts by building a practice page"),
    body: tr("You'll go hands-on through creating a page, text, layout, design, links and mobile. Each step also explains why you do it, so you learn the reasoning, not just the steps."),
    bullets: [
      tr("When you finish a step, it moves on automatically (you can also use the left and right arrow keys)."),
      tr("The page you make is unpublished, so it won't appear on your live site. It stays even if you stop partway."),
      tr("It takes about 10 minutes."),
    ],
  },

  /* ---------- ページを用意する ---------- */
  {
    target: "left-tab-pages",
    placement: "right",
    chapter: tr("Set up a page"),
    title: tr("Open Pages in the left panel"),
    body: tr("A site is a collection of pages. Add, reorder and publish pages here."),
    why: tr("Before adding elements, you need a page to put them on. Practicing on a new page means mistakes won't affect your real content."),
    task: "open-pages",
    taskLabel: tr("Open the Pages tab"),
  },
  {
    target: "add-page-button",
    placement: "right",
    chapter: tr("Set up a page"),
    title: tr("Click \"Add page\""),
    body: tr("An empty page is added and opened automatically."),
    why: tr("Starting from an empty page lets you see what each element does as you build."),
    task: "create-page",
    taskLabel: tr("Add a new page"),
    prepare: { leftTab: "pages" },
  },
  {
    target: "tutorial-page-publish-checkbox",
    placement: "left",
    chapter: tr("Set up a page"),
    title: tr("Turn off \"Publish this page\""),
    body: tr("The right panel shows the settings for the current page. Uncheck the box."),
    why: tr("This keeps an unfinished page off your live site. Unpublished pages aren't exported when you publish, so you can experiment freely. It's handy for drafts too."),
    task: "unpublish-page",
    taskLabel: tr("Uncheck it to unpublish"),
    prepare: { clearSelection: true, openSection: "tutorial-page-section" },
  },
  {
    target: "tutorial-page-name",
    placement: "left",
    chapter: tr("Set up a page"),
    title: tr("Name the page \"Practice page\""),
    body: tr("Type \"Practice page\" in the Name field and press Enter."),
    why: tr("The page name is for telling pages apart in the editor (the title in browser tabs is set separately under \"Search & sharing\"). Clear names keep things easy as pages pile up."),
    task: "name-page",
    taskLabel: tr("Name it \"Practice page\""),
    prepare: { clearSelection: true, openSection: "tutorial-page-section" },
  },
  {
    target: "tutorial-page-slug",
    placement: "left",
    chapter: tr("Set up a page"),
    title: tr("Set the URL to \"{slug}\"", "set_the_url_to_slug_variant_1"),
    body: tr("Type \"{slug}\" in the URL field and press Enter. Once published, this page opens at /{slug}."),
    why: tr("The URL is the address visitors go to. A short word describing the content is easy to share and helps search engines understand the page."),
    task: "slug-page",
    taskLabel: tr("Set the URL to \"{slug}\""),
    prepare: { clearSelection: true, openSection: "tutorial-page-section" },
  },

  /* ---------- 要素を置く ---------- */
  {
    target: "left-tab-add",
    placement: "right",
    chapter: tr("Add elements"),
    title: tr("Open Add in the left panel"),
    body: tr("Add the building blocks (elements) of a page, like text, images and buttons, from here."),
    why: tr("Everything on a page is a combination of elements. New elements go after the selected element (or inside it, if it's a box). Check \"Insert into\" at the top to see where it'll go."),
    task: "open-add",
    taskLabel: tr("Open the Add tab"),
  },
  {
    target: "add-element-heading",
    placement: "right",
    chapter: tr("Add elements"),
    title: tr("Click \"Heading\""),
    body: tr("A heading is added to the practice page and selected."),
    why: tr("Headings describe what the page is about. Beyond looking big, search engines and screen readers read them as the page's structure. Starting with a heading makes the page's purpose clear."),
    task: "add-heading",
    taskLabel: tr("Add a heading"),
    prepare: { leftTab: "add" },
  },
  {
    target: "selected-node",
    placement: "left",
    chapter: tr("Add elements"),
    title: tr("Double-click the heading to edit it"),
    body: tr("Type \"My first page\" and click outside the text to confirm."),
    why: tr("You edit directly on the canvas, so you can see the actual size and line breaks as you write."),
    task: "edit-heading",
    taskLabel: tr("Type \"My first page\""),
  },
  {
    target: "style-typography",
    placement: "left",
    chapter: tr("Add elements"),
    title: tr("Set the font size to 40px in the right panel"),
    body: tr("Enter 40 in the Size field under Text and press Enter."),
    why: tr("Making the heading larger than the body text shows what matters at a glance. \"Select on the canvas, change in the right panel\" is the basic flow of this editor."),
    task: "style-heading",
    taskLabel: tr("Set the font size to 40px"),
    prepare: { rightTab: "style" },
  },
  {
    target: "add-element-text",
    placement: "right",
    chapter: tr("Add elements"),
    title: tr("With the heading selected, click \"Text\""),
    body: tr("Body text is added right after the heading."),
    why: tr("Where new elements go depends on what's selected. Selecting the spot first saves you from reordering later."),
    task: "add-text",
    taskLabel: tr("Add text"),
    prepare: { leftTab: "add" },
  },
  {
    target: "selected-node",
    placement: "left",
    chapter: tr("Add elements"),
    title: tr("Edit the body text"),
    body: tr("Double-click, type \"I made this page in the tutorial.\" and click outside to confirm."),
    why: tr("Headings say what the page is; body text gives the details. That split is the basis of a readable page."),
    task: "edit-text",
    taskLabel: tr("Enter the given text"),
  },

  /* ---------- レイアウト ---------- */
  {
    placement: "center",
    chapter: tr("How layout works"),
    title: tr("The parent decides the layout", "the_parent_decides_the_layout_variant_1"),
    body: tr("To place elements side by side or center them, put them in a box (the parent) and set the layout on the parent. It holds up better across screen widths than moving each child by numbers."),
    bullets: [
      tr("Flow … which direction children are arranged (vertical or horizontal)"),
      tr("Alignment … where in the parent they're placed"),
      tr("Spacing … the gap inside (padding) and outside (margin) an element"),
    ],
  },
  {
    target: "add-element-box",
    placement: "right",
    chapter: tr("Layout"),
    title: tr("Add a box", "add_a_box_variant_1"),
    body: tr("An empty box is added after the body text."),
    why: tr("A box is a container that groups content. It's the base for arranging its elements or giving them a background."),
    task: "add-box",
    taskLabel: tr("Add a box"),
    prepare: { leftTab: "add" },
  },
  {
    target: "add-element-button",
    placement: "right",
    chapter: tr("Layout"),
    title: tr("Add a button inside the box", "add_a_button_inside_the_box_variant_1"),
    body: tr("With the box selected, click \"Button\". \"Insert into\" at the top now says inside the box."),
    why: tr("Adding with a parent selected puts the new element inside it (as a child). In the Layers panel, you'll see the button nested one level inside the box."),
    task: "add-first-child",
    taskLabel: tr("Add a button inside the box"),
    prepare: { leftTab: "add" },
  },
  {
    target: "add-element-button",
    placement: "right",
    chapter: tr("Layout"),
    title: tr("Add another button"),
    body: tr("Add a second button in the same box. For now they stack vertically."),
    why: tr("Boxes start out vertical. You'll need two buttons to see in the next step how the parent's setting alone changes the arrangement."),
    task: "add-second-child",
    taskLabel: tr("Add a second button"),
    prepare: { leftTab: "add" },
  },
  {
    target: "style-layout",
    placement: "left",
    chapter: tr("Layout"),
    title: tr("Set the box to horizontal flow"),
    body: tr("Under Layout, click the right arrow in Flow."),
    why: tr("You didn't touch the buttons, yet the parent's setting put them side by side. To change an arrangement, select the parent, not the children. Remember this and layout gets easy."),
    task: "flow-box",
    taskLabel: tr("Use horizontal flow to put children side by side"),
    prepare: { rightTab: "style", openSection: "style-layout" },
  },
  {
    target: "style-layout",
    placement: "left",
    chapter: tr("Layout"),
    title: tr("Center the children"),
    body: tr("Click the middle of the 3×3 grid under Alignment."),
    why: tr("Flow sets the direction; alignment sets where things sit inside the parent. Centered content stays centered even when the screen or content changes (positioning by numbers would drift)."),
    task: "align-box",
    taskLabel: tr("Center the alignment"),
    prepare: { rightTab: "style", openSection: "style-layout" },
  },
  {
    target: "style-spacing",
    placement: "left",
    chapter: tr("Layout"),
    title: tr("Set the button's padding to 32px left/right and 16px top/bottom"),
    body: tr("The first button is selected. Under Spacing, enter 32 for left/right padding and 16 for top/bottom."),
    why: tr("Padding is the space inside an element, between its content and its edge. On buttons it also enlarges the clickable area, making them easier to press."),
    task: "padding-button",
    taskLabel: tr("Set padding to 32px left/right and 16px top/bottom"),
    prepare: { rightTab: "style", openSection: "style-spacing" },
  },
  {
    target: "style-spacing",
    placement: "left",
    chapter: tr("Layout"),
    title: tr("Set the margin to 16px left/right", "set_the_margin_to_16px_left_ri_variant_1"),
    body: tr("Enter 16 for the left/right margin."),
    why: tr("Margin is the space outside an element, between it and its neighbors. The button stays the same size; only the gap between the buttons grows. Use padding to grow the inside and margin to add space between."),
    task: "margin-button",
    taskLabel: tr("Set the margin to 16px left/right"),
    prepare: { rightTab: "style", openSection: "style-spacing" },
  },

  /* ---------- 自由な位置 ---------- */
  {
    target: "style-position",
    placement: "left",
    chapter: tr("Free positioning"),
    title: tr("Set the button's position to Custom"),
    body: tr("Click Custom under Position."),
    why: tr("This is for elements that should leave the normal flow, like badges or text over an image. The next two steps show why you shouldn't use it all the time."),
    task: "custom-button",
    taskLabel: tr("Set position to Custom"),
    prepare: { rightTab: "style", openSection: "style-position" },
  },
  {
    target: "style-position",
    placement: "left",
    chapter: tr("Free positioning"),
    title: tr("Move it by setting X and Y to 20px"),
    body: tr("Enter 20 for X and 20 for Y."),
    why: tr("You can move it freely by numbers, but the button no longer takes part in the parent's flow (notice the other button slid over). It can easily overlap other elements when the screen width changes."),
    task: "move-button",
    taskLabel: tr("Set X to 20px and Y to 20px"),
    prepare: { rightTab: "style", openSection: "style-position" },
  },
  {
    target: "style-position",
    placement: "left",
    chapter: tr("Free positioning"),
    title: tr("Set position back to Auto", "set_position_back_to_auto_variant_1"),
    body: tr("Click Auto and the button returns to the row."),
    why: tr("Keeping things on Auto and letting the parent's flow handle layout is the most robust approach. Use Custom only when you really need to overlap."),
    task: "reset-button-position",
    taskLabel: tr("Set position back to Auto"),
    prepare: { rightTab: "style", openSection: "style-position" },
  },

  /* ---------- 見た目 ---------- */
  {
    target: "style-appearance",
    placement: "left",
    chapter: tr("Polish the look"),
    title: tr("Round the button's corners to 12px"),
    body: tr("Enter 12 for Corner radius under Appearance and press Enter."),
    why: tr("Corner rounding has a big effect on the feel. Keeping it the same across your site's buttons makes it look consistent."),
    task: "round-button",
    taskLabel: tr("Set the corner radius to 12px"),
    prepare: { rightTab: "style", openSection: "style-appearance" },
  },
  {
    target: "style-background",
    placement: "left",
    chapter: tr("Polish the look"),
    title: tr("Set the button's background color to \"#2563eb\""),
    body: tr("Enter #2563eb for the color under Background and press Enter."),
    why: tr("A colored button says \"this is an important action you can take.\" Saving a strong (accent) color for key actions makes them stand out."),
    task: "color-button",
    taskLabel: tr("Set the background color to #2563eb"),
    prepare: { rightTab: "style", openSection: "style-background" },
  },

  /* ---------- 動き ---------- */
  {
    target: "right-tab-settings",
    placement: "left",
    chapter: tr("Add interaction"),
    title: tr("Open Settings in the right panel", "open_settings_in_the_right_pan_variant_1"),
    body: tr("Now set what happens when the button is clicked."),
    why: tr("The right panel is split into Style (looks) and Settings (content and behavior). What happens on click isn't about looks, so it's under Settings."),
    task: "open-settings",
    taskLabel: tr("Open Settings in the right panel"),
  },
  {
    target: "settings-link",
    placement: "left",
    chapter: tr("Add interaction"),
    title: tr("Make it open another page when clicked"),
    body: tr("Open \"Edit page scripts\", drag \"When clicked\" onto the workspace, and attach \"Open ［page］\" below it. The trigger element is already this button. Choose a page other than the practice page to open."),
    why: tr("Interactions combine a trigger (like \"When clicked\") with actions (like \"Open page\"). Once you know this pattern, toggling visibility, scrolling and showing data all work the same way."),
    task: "link-button",
    taskLabel: tr("Link to an existing page"),
    prepare: { rightTab: "settings" },
  },

  /* ---------- スマホ対応 ---------- */
  {
    target: "breakpoint-{mobileId}",
    placement: "bottom",
    chapter: tr("Make it work on phones"),
    title: tr("Click \"{mobile}\" at the top"),
    body: tr("The canvas switches to the {mobile} width. The top shows which screen width you're editing."),
    why: tr("The desktop design is the base for every screen; on smaller screens you override only what needs to change. No need to rebuild for each width."),
    task: "mobile-view",
    taskLabel: tr("Switch to the {mobile} view"),
    needsBreakpoint: true,
  },
  {
    target: "style-layout",
    placement: "left",
    chapter: tr("Make it work on phones"),
    title: tr("Stack the buttons vertically on {mobile}"),
    body: tr("Still in the {mobile} view, click the down arrow in the box's Flow."),
    why: tr("Side-by-side buttons get cramped on narrow screens. This change applies only at the {mobile} width, so the desktop row stays as is (switch back to Desktop at the top to check)."),
    task: "mobile-box",
    taskLabel: tr("Stack vertically on {mobile} only"),
    prepare: { rightTab: "style", openSection: "style-layout" },
    needsBreakpoint: true,
  },

  /* ---------- 確認 ---------- */
  {
    target: "preview",
    placement: "bottom",
    chapter: tr("Check the result"),
    title: tr("Click \"Preview\""),
    body: tr("Selection outlines disappear, and you can use buttons and links just like on the published site."),
    why: tr("On the editing canvas, clicking selects elements. In Preview, scripts actually run, so you can check what happens on click before publishing."),
    task: "preview",
    taskLabel: tr("Switch to Preview"),
  },
  {
    placement: "center",
    chapter: tr("Tutorial complete"),
    title: tr("Your practice page is done"),
    body: tr("The ideas you used here apply to every page you build."),
    bullets: [
      tr("Select on the canvas, change in the right panel"),
      tr("The parent decides the layout (flow, alignment, spacing)"),
      tr("Use custom position only for overlapping"),
      tr("Interactions are triggers plus actions"),
      tr("On phones, override only what needs to change"),
      tr("To publish the practice page, turn on \"Publish this page\" in Page settings"),
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
      .replaceAll("{mobile}", mobileBp ? BP_INFO[mobileBp]?.label ?? tr("Phone") : tr("Phone"));
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
    .find((node) => node.name === tr("Text", "text_variant_1") && node.text?.heading === 0);
  const tutorialBox = tutorialNodeIds
    .map((id) => doc.nodes[id])
    .find((node) => node.name === tr("Box") && !node.text);
  const childButtons = (tutorialBox?.children ?? [])
    .map((id) => doc.nodes[id])
    .filter((node) => node?.name === tr("Button"));
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
        return tutorialPage?.name === tr("Practice page");
      case "slug-page":
        return tutorialPage?.slug === expectedSlug;
      case "open-add":
        return leftTab === "add";
      case "add-heading":
        return !!heading;
      case "edit-heading":
        return heading?.text?.content.trim() === tr("My first page");
      case "style-heading":
        return heading?.styles.base?.default?.fontSize === "40px";
      case "add-text":
        return !!paragraph;
      case "edit-text":
        return (
          paragraph?.text?.content.trim() ===
          tr("I made this page in the tutorial.")
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
          aria-label={tr("End tutorial")}
          data-tip={tr("End", "end_variant_1")}
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
              <b>{tr("Why?")}</b>
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
                ? tr("Done", "done_variant_2")
                : step.taskLabel
                  ? formatStepText(step.taskLabel)
                  : tr("Your turn")}
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
              {tr("Back")}
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
                  {tr("Done")}
                </>
              ) : (
                <>
                  {index === 0 ? tr("Start") : tr("Next")}
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
