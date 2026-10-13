import type { Topic } from "../manual";
import { tr } from "../i18n";

export const elementTopics: Topic[] = [  /* ================= 要素の追加と選択 ================= */
  {
    id: "el-add",
    cat: "element",
    level: 1,
    q: tr("How do I add text, images and other elements?"),
    a: tr("Click an element in the Add tab of the left panel. It goes **inside the selected box, or after the selected element**. Switch between the two with \"Inside / After\" next to Insert into. You can also drag it onto the canvas."),
    keys: [tr("Add"), tr("Insert"), tr("Element"), tr("element"), tr("Alignment")],
    ctx: ["none", "box"],
    body: [
      {
        table: {
          head: [tr("Element"), tr("When to use")],
          rows: [
            [tr("Box"), tr("A container for other elements. The base for layout and backgrounds.")],
            [tr("Heading"), tr("Titles for pages and sections")],
            [tr("Text", "text_variant_1"), tr("Body")],
            [tr("Button"), tr("Actions you want people to take (sign up, learn more, etc.)")],
            [tr("Image"), tr("Photos, logos, illustrations")],
          ],
        },
      },
      { rule: tr("Select where you want it before adding, so you don't have to reorder later. \"Insert into\" at the top of the Add tab shows where it will go."), title: tr("Choose the spot first") },
      { fig: "insert-mode", caption: tr("Switch how the position is chosen with \"Inside / After\" next to Insert into") },
    ],
    guide: [
      { target: "left-tab-add", text: tr("Open the Add tab in the left panel."), done: (s) => s.leftTab === "add" },
      { target: "insert-target", text: tr("This shows where new elements will go. To change it, select a spot on the canvas first."), prepare: { left: "add" } },
      { target: "add-panel", text: tr("Click the element you want, or drag it onto the canvas."), prepare: { left: "add" } },
    ],
    see: ["el-insert", "el-select", "el-move", "img-add"],
  },
  {
    id: "el-insert",
    cat: "element",
    level: 1,
    q: tr("Added elements go inside the box (I want them after it)"),
    a: tr("Choose **After** next to Insert into in the Add tab, and new elements go right after the selected element (at the same level). Switch back to **Inside** to put them inside a selected box."),
    keys: [tr("Insert into"), tr("Inside"), tr("After"), tr("sibling"), tr("same level")],
    body: [
      { fig: "insert-mode" },
      { p: tr("The setting applies not only to adding elements but also to **pasting (⌘V)** and adding images or components. You aren't asked every time; the last choice made in this browser is used.") },
      { note: tr("When the selected element can't contain others, like text or an image, new elements always go after it.") },
    ],
    guide: [
      { target: "insert-target", text: tr("Switch between Inside and After here."), prepare: { left: "add" } },
    ],
    see: ["el-add", "el-move"],
  },
  {
    id: "el-select",
    cat: "element",
    level: 1,
    q: tr("I can't select the right element / How do I select a parent?"),
    a: tr("Each click selects **one level deeper**. **⌘-click (Ctrl-click on Windows) selects the innermost element** directly. To select the outer (parent) element, press ⇧Enter or use the arrow at the top left of the selection."),
    keys: [tr("Select"), tr("can't select"), tr("parent"), tr("multi-select"), tr("Layers"), tr("deep"), tr("level")],
    body: [
      { fig: "select-depth", caption: tr("Each click on the same spot goes one level deeper. ⌘-click selects the innermost element at once.") },
      {
        list: [
          tr("**Click** … selects the large outer element first; click inside again to go one level deeper (levels that exactly overlap are skipped)"),
          tr("**Double-click** … selects the innermost element and edits it if it's text"),
          tr("**⌘-click (Ctrl-click)** … select the innermost element right away"),
          tr("**⇧+click** … selects multiple elements (style changes, delete and duplicate apply to all)"),
          tr("**⇧Enter / the arrow at the top left of the selection** … selects the parent"),
          tr("**Layers** … lists the nesting of elements, so you can select them even when they overlap"),
        ],
      },
      { note: tr("Locked elements can't be dragged on the canvas. Unlock them with the lock button in Layers.") },
      { p: tr("Clicking an element at **the same level** as the selection, such as another card, switches to it at that level. Clicking somewhere unrelated starts again from the outermost element.") },
    ],
    guide: [
      { target: "canvas", text: tr("Click an element on the canvas to select it."), needs: "any" },
      { target: "sel-parent", text: tr("The arrow at the top left of the selection selects the parent element.") },
      { target: "layers-panel", text: tr("In Layers, you can select elements within their nested structure."), prepare: { left: "layers" } },
    ],
    see: ["el-move", "el-lock"],
  },
  {
    id: "el-move",
    cat: "element",
    level: 1,
    q: tr("How do I reorder elements or move them to another box?"),
    a: tr("Drag the element in Layers or on the canvas. It goes where the blue line is; **drop it in the middle of a box to put it inside**."),
    keys: [tr("Navigation"), tr("reorder"), tr("order"), tr("drag"), tr("swap")],
    ctx: ["box", "text", "image"],
    body: [
      { p: tr("You can also move one step at a time with \"Move up\" and \"Move down\" in the right-click menu. Multiple selected elements move together.") },
      { rule: tr("To move elements, change their order and container (box) instead of position numbers. That way, nothing breaks when the screen width changes."), title: tr("Position by order") },
    ],
    guide: [
      { target: "layers-panel", text: tr("Drag a row in Layers to move it to the blue line. Drop it onto the middle of a box row to put it inside."), prepare: { left: "layers" } },
    ],
    see: ["el-select", "d-flow-not-absolute"],
  },
  {
    id: "el-copy",
    cat: "element",
    level: 1,
    q: tr("How do I duplicate, copy or delete elements?"),
    a: tr("⌘D duplicates, ⌘C/⌘V copies and pastes, and Delete removes. The right-click menu works too."),
    keys: [tr("Duplicate"), tr("Copy"), tr("Paste"), tr("Paste"), tr("Delete"), tr("remove")],
    ctx: ["box", "text", "image"],
    body: [
      { p: tr("Pasted elements go inside the selected box or after the selected element. You can paste into other pages too.") },
      { note: tr("Locked elements can't be deleted (this prevents accidents).") },
    ],
    see: ["el-lock", "start-shortcuts"],
  },
  {
    id: "el-lock",
    cat: "element",
    level: 2,
    q: tr("How do I lock or temporarily hide an element?"),
    a: tr("Lock it with **Lock** under Settings in the right panel, or with the lock button on its row in Layers. To hide it, use the eye button in Layers."),
    keys: [tr("Lock"), tr("Fixed"), tr("hidden"), tr("Hide"), tr("eye icon")],
    body: [
      { p: tr("Locking **prevents moving, resizing, deleting and cutting** on the canvas and in Layers. Styles such as color and text can still be changed, so it's a way to protect finished parts from accidental moves or deletion. The eye button hides the element at the current screen width and below ([[resp-hide|showing per device]]).") },
    ],
    guide: [
      { target: "layer-selected", text: tr("The selected element's row has lock and eye (visibility) buttons at the right."), needs: "any", prepare: { left: "layers" } },
    ],
    see: ["resp-hide", "el-select"],
  },
  {
    id: "el-name",
    cat: "element",
    level: 1,
    q: tr("How do I rename layers?"),
    a: tr("Double-click the layer name, or change \"Name\" under Settings in the right panel."),
    keys: [tr("Name"), tr("layer name"), tr("rename")],
    body: [
      { p: tr("Names are labels for the editor only and don't appear on your live site. Naming by role, like \"Header\" or \"News list\", keeps you oriented as pages grow.") },
    ],
    guide: [
      { target: "settings-name", text: tr("Rename it here."), needs: "any", prepare: { right: "settings" } },
    ],
  },
  {
    id: "el-semantic",
    cat: "element",
    level: 3,
    q: tr("What is \"Meaning (output tag)\"?"),
    a: tr("It tells search engines and screen readers what part of the page a box is, like a header, navigation or main content. **It doesn't change the look**."),
    keys: [tr("Meaning", "meaning_variant_1"), tr("tag"), tr("semantic"), "header", "nav", "main", "section", "footer"],
    ctx: ["box"],
    body: [
      {
        table: {
          head: [tr("Meaning", "meaning_variant_1"), tr("Where to use")],
          rows: [
            [tr("Header"), tr("The logo and menu at the top of the page")],
            [tr("Navigation", "navigation_variant_1"), tr("A row of main links")],
            [tr("Main"), tr("The main content of the page (one per page)")],
            [tr("Section"), tr("A group with its own heading")],
            [tr("Article"), tr("A self-contained article or announcement")],
            [tr("Footer"), tr("Supplementary info at the bottom of the page")],
          ],
        },
      },
      { p: tr("On \"Auto\", the tag is chosen from the content. If unsure, Auto is fine.") },
    ],
    guide: [{ target: "settings-semantic", text: tr("Choose the meaning here."), needs: "container", prepare: { right: "settings" } }],
    see: ["text-heading", "d-accessibility"],
  },


];
