import type { Topic } from "../manual";
import { tr } from "../i18n";
import { style } from "./helpers";

export const responsiveTopics: Topic[] = [  /* ================= スマホ対応 ================= */
  {
    id: "resp-basics",
    cat: "responsive",
    level: 1,
    q: tr("How do I check and adjust the phone layout?"),
    a: tr("Switch to Phone in the top bar and the canvas takes the phone width. Changes made in this view **apply only to phones**; the desktop look stays the same."),
    keys: [tr("Phone"), tr("responsive"), tr("mobile"), tr("Tablet"), tr("Screen width"), tr("Breakpoints")],
    ctx: ["mobile"],
    body: [
      { fig: "breakpoint-cascade" },
      { p: tr("When you switch, the canvas is exactly the breakpoint width (478px for phones). That is the widest screen the phone styles apply to, so it is wider than real phones.") },
      { note: tr("Use the button next to the width field to check small (360px) and large (430px) phones too. It's worth making sure that text and spacing don't feel cramped on narrow devices.") },
      { p: tr("Settings changed outside desktop turn orange in the right panel (desktop is blue). Right-click a setting's name to undo just that screen width's change.") },
      { rule: tr("Most sites get more phone visitors than desktop ones. Make a habit of checking important pages on phone first."), title: tr("Check on phone") },
    ],
    guide: [
      { target: "breakpoint-{mobile}", text: tr("Click Phone in the top bar."), done: (s) => s.breakpoint !== "base" },
      { target: "bp-bar", text: tr("This shows which screen width you're editing. Changes here apply only to screens this wide or narrower.") },
      { target: "canvas-width", text: tr("Enter a width or drag the canvas edges to check other widths too.") },
    ],
    see: ["resp-stack", "resp-hide", "resp-reset"],
  },
  {
    id: "resp-stack",
    cat: "responsive",
    level: 2,
    q: tr("How do I stack a row vertically on phones?"),
    a: tr("Switch to the phone view, select the row's parent, and **set Flow to vertical (↓)**. It stays a row on desktop."),
    keys: [tr("vertical"), tr("stack on phone"), tr("Wrapping"), tr("one column"), tr("stack")],
    ctx: ["mobile", "box"],
    body: [
      { fig: "stack-mobile" },
      { p: tr("For a grid, set Columns to 1 in the phone view.") },
      { rule: tr("A phone screen fits about two buttons or a few icons in a row. Stack cards and image-plus-text blocks vertically.") },
    ],
    guide: [
      { target: "breakpoint-{mobile}", text: tr("Switch to Phone in the top bar."), done: (s) => s.breakpoint !== "base" },
      { target: "canvas", text: tr("Select the parent box of the row."), needs: "container" },
      {
        target: "style-layout",
        text: tr("Click the down arrow (vertical) in Flow. This change applies only on phones."),
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
    q: tr("How do I show something only on phones or only on desktop?"),
    a: tr("Select the element and, under \"Show on devices\" at the top of Style, turn off the screens where it shouldn't appear."),
    keys: [tr("hidden"), tr("phone only"), tr("desktop only"), tr("Don't show"), tr("device")],
    ctx: ["mobile", "box", "image"],
    body: [
      { fig: "device-visibility" },
      { p: tr("From left, the buttons are Desktop, Tablet, Phone (landscape) and Phone. Hidden elements still appear faded in Layers.") },
      { rule: tr("Don't cut too much on phones. Hide things mainly when showing the same information another way, like replacing a big menu with a small button.") },
    ],
    guide: [
      { target: "style-visibility", text: tr("Click to turn off the screens where it shouldn't show."), needs: "any", prepare: { right: "style" } },
    ],
    see: ["act-menu", "el-lock"],
  },
  {
    id: "resp-font",
    cat: "responsive",
    level: 2,
    q: tr("Text is too big or too small on phones"),
    a: tr("Switch to the phone view, select the text, and change Size under Text. The desktop size stays the same."),
    keys: [tr("phone text"), tr("text too big"), tr("text too small"), tr("line breaks")],
    ctx: ["mobile", "text"],
    body: [
      { rule: tr("Keep body text around 16px on phones too. Text under 12px is hard to read, and the pre-publish check flags it. Scale headings down for the screen (e.g. 48px on desktop → 28px on phones)."), title: tr("Text size on phones") },
      { p: tr("If a heading breaks awkwardly, making it a little smaller on phones usually works better than adding a manual line break.") },
    ],
    guide: [
      { target: "breakpoint-{mobile}", text: tr("Switch to Phone."), done: (s) => s.breakpoint !== "base" },
      { target: "style-typography", text: tr("Select the text and change Size under Text."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-type-scale", "resp-basics"],
  },
  {
    id: "resp-reset",
    cat: "responsive",
    level: 3,
    q: tr("How do I undo phone-only changes? (What blue and orange mean)"),
    a: tr("Changed settings have colored names. **Right-click a name** to clear the change for the current screen width and fall back to the larger screen's setting."),
    keys: [tr("reset"), tr("cancel"), tr("right-click"), tr("orange"), tr("blue"), tr("Overwrites")],
    ctx: ["mobile"],
    body: [
      {
        list: [
          tr("**Blue** … changed on desktop (all screens)"),
          tr("**Orange** … overridden at a screen width other than desktop"),
          tr("**Colored heading on a collapsed section** … it contains changed settings"),
        ],
      },
      { p: tr("Clearing a number field in the phone view (or a similar view) overrides it with \"no value\". To fall back to the larger screen's setting, right-click instead.") },
    ],
    see: ["resp-basics"],
  },
  {
    id: "resp-breakpoints",
    cat: "responsive",
    level: 4,
    q: tr("How do I change or add breakpoints (screen width thresholds)?"),
    a: tr("Under Breakpoints on the Site tab of the left panel, you can rename them, change their widths, and add or remove them."),
    keys: [tr("Breakpoints"), tr("Screen width"), tr("threshold"), tr("Tablet"), tr("media query")],
    body: [
      { fig: "breakpoint-cascade" },
      { warn: tr("Deleting a breakpoint also removes the styles changed for it (⌘Z restores them).") },
      { rule: tr("Choose breakpoints by where the design starts to break, not by device model. Too many become hard to manage; 3–4 levels (desktop, tablet, phone) is typical.") },
    ],
    guide: [
      { target: "site-breakpoints", text: tr("Rename, resize, add or remove them here."), prepare: { left: "site", section: "site-breakpoints" } },
    ],
    see: ["resp-basics"],
  },


];
