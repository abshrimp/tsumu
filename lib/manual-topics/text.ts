import type { Topic } from "../manual";
import { tr } from "../i18n";

export const textTopics: Topic[] = [  /* ================= 文字 ================= */
  {
    id: "text-edit",
    cat: "text",
    level: 1,
    q: tr("How do I edit text or add line breaks?"),
    a: tr("**Double-click text** to edit it. Enter adds a line break; Esc or clicking outside confirms."),
    keys: [tr("Text"), tr("Text (element)"), tr("edit"), tr("rewrite"), tr("line break")],
    ctx: ["text"],
    body: [
      { p: tr("You can also press Enter on a selected element to start editing. ⌘Enter confirms too.") },
      { note: tr("Typing \"{\" in text shows suggestions for [[act-vars|variables]] that insert data or field values. To type a literal \"{\", just close the suggestions and keep going.") },
    ],
    guide: [
      { target: "selected-node", text: tr("Double-click the text you want to change, type, then click outside to confirm."), needs: "text", done: (s) => !!s.editingText },
    ],
    see: ["text-size", "text-partial"],
  },
  {
    id: "text-size",
    cat: "text",
    level: 1,
    q: tr("How do I change text size, weight or color?"),
    a: tr("Select the text and change Size, Weight and Color under Text in the Style tab of the right panel."),
    keys: [tr("font size"), tr("size"), tr("bold"), tr("Weight"), tr("Text color"), tr("text size")],
    ctx: ["text"],
    body: [
      { p: tr("You can also drag the label on the left of a number field. ↑↓ change by 1, or by 10 with ⇧.") },
      { rule: tr("Body text around 16px, headings 1.5–2.5× that. Stick to 4–5 sizes ([[d-type-scale|type size guide]])."), title: tr("Type size guide") },
      { note: tr("Text styles on a box are inherited by all text inside. Setting site-wide defaults on \"body\" makes things easy.") },
    ],
    guide: [
      { target: "style-typography", text: tr("Change Size, Weight and Color under Text."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-type-scale", "text-font", "text-partial"],
  },
  {
    id: "text-partial",
    cat: "text",
    level: 2,
    q: tr("How do I style part of a sentence?"),
    a: tr("While editing, drag to select the part you want, then change its color or weight in the right panel. Choose \"Split and apply\" to make just that part a separate element."),
    keys: [tr("part"), tr("portion"), tr("emphasis"), tr("highlight"), "span"],
    ctx: ["text"],
    body: [
      { p: tr("Splitting creates three elements: before, the selection and after.") },
      { warn: tr("After splitting, you can't edit the whole sentence at once. Split once the wording is final.") },
      { rule: tr("Emphasize only 1–2 spots per paragraph. When everything is emphasized, nothing stands out.") },
    ],
    see: ["text-size", "d-hierarchy"],
  },
  {
    id: "text-font",
    cat: "text",
    level: 2,
    q: tr("How do I change the font or use Google Fonts?"),
    a: tr("Choose a font under Font in Text. Use \"+\" on the right to add a Google Fonts font by name."),
    keys: [tr("Font"), tr("typeface"), "Google Fonts", tr("serif"), tr("sans-serif")],
    ctx: ["text", "body"],
    body: [
      { p: tr("Find one on fonts.google.com and enter its name exactly as shown (e.g. Playfair Display).") },
      { rule: tr("Use at most two fonts (one for headings, one for body text). More fonts look less unified and load more slowly. Fonts with large character sets (like Japanese) are especially heavy, so using a system font for body text is a good option."), title: tr("Two fonts at most") },
    ],
    guide: [
      { target: "style-typography", text: tr("Choose from the Font field, or add one from Google Fonts with \"+\" on the right."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-fonts", "d-performance", "text-adobe-fonts"],
  },
  {
    id: "text-adobe-fonts",
    cat: "text",
    level: 2,
    q: tr("How do I add Adobe Fonts?"),
    a: tr("Create an Adobe Fonts Web Project, copy its Project ID, and select the published fonts from Tsumu's font dialog."),
    keys: ["Adobe Fonts", "Typekit", tr("Web Project"), tr("Project ID"), tr("Font"), tr("font-family")],
    ctx: ["text", "body"],
    body: [
      { list: [
        tr('On Adobe Fonts, open the page of the font you want to use. Click the "</>" button and create a Web Project. Publish it.'),
        tr('Open "Web Projects" under "Manage fonts" in Adobe Fonts and copy the seven-character "Project ID".'),
        tr('In Tsumu, select a text element, then choose Text → Font → + → Adobe Fonts.'),
        tr('Paste the Project ID (or its use.typekit.net URL). Select a font from the published list and click Add.'),
      ], ordered: true },
      { external: {
        url: "https://fonts.adobe.com/my_fonts#web_projects-section",
        label: tr("Open Adobe Fonts Web Projects"),
      } },
      { note: tr("The Project ID is stored in the site's font settings as adobeFonts[].kitId. Server-saved sites store these settings in their database; browser-only sites store them locally. No Adobe embed code or font files are saved.") },
      { warn: tr("If the font list does not appear, check that the Web Project is published and contains fonts you can use. A lookup failure does not mean your Adobe subscription has expired.") },
    ],
    guide: [
      { target: "style-typography", text: tr("In the Text section, open Font → + → Adobe Fonts to enter the Project ID."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["text-font", "d-fonts"],
  },
  {
    id: "text-heading",
    cat: "text",
    level: 1,
    q: tr("When should I use headings vs. body text?"),
    a: tr("A heading is a short label for what a section contains. **Use Heading 1 for the page title**, Heading 2 for sections under it, Heading 3 for subsections, and so on."),
    keys: [tr("Heading"), "h1", "h2", tr("Heading level"), tr("Body")],
    ctx: ["text"],
    body: [
      { fig: "heading-outline" },
      { rule: tr("One Heading 1 per page, and don't skip levels. Search engines and screen readers use heading levels to understand the page's structure."), title: tr("Heading rules") },
      { note: tr("Heading level and text size are separate. You can change the look freely with Size.") },
    ],
    guide: [
      { target: "style-typography", text: tr("Switch between Body and Heading 1–6 with \"Heading level\"."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-hierarchy", "d-seo"],
  },
  {
    id: "text-align",
    cat: "text",
    level: 1,
    q: tr("How do I center text or truncate long text with \"…\"?"),
    a: tr("Choose left, center or right under Align in Text. Set Wrapping to \"Truncate\" to cut text beyond a set number of lines with \"…\"."),
    keys: [tr("Align center"), tr("right align"), tr("Truncate"), tr("ellipsis"), tr("Wrapping"), tr("no wrap")],
    ctx: ["text"],
    body: [
      { rule: tr("Left-align long text; center only headings and short lines. Centering more than three lines makes ragged starts that are hard to read."), title: tr("Choosing an alignment") },
      { note: tr("Wrapping: Wrap = continue on the next line, None = stay on one line, Truncate = cut with \"…\". To center a whole element, use [[layout-center|Alignment]].") },
    ],
    guide: [
      { target: "style-typography", text: tr("Change Align and Wrapping."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["layout-center", "d-line-length"],
  },
  {
    id: "text-spacing",
    cat: "text",
    level: 2,
    q: tr("How do I adjust line height and letter spacing?"),
    a: tr("Adjust Line height and Letter spacing under Text. For body text, **a line height of about 1.5–1.9** is easy to read (Japanese text needs the higher end)."),
    keys: [tr("Line height"), tr("Letter spacing"), tr("line height"), "line-height", "letter-spacing", tr("readability")],
    ctx: ["text", "body"],
    body: [
      {
        table: {
          head: ["", tr("Line height"), tr("Letter spacing")],
          rows: [
            [tr("Body"), "1.7〜1.9", "0〜0.05em"],
            [tr("Heading"), "1.2〜1.5", "0〜0.08em"],
            [tr("Small notes"), "1.5〜1.7", "0.02〜0.05em"],
          ],
        },
      },
      { rule: tr("Set line height without a unit (like 1.8). The ratio follows the font size, so nothing breaks when text gets smaller on phones."), title: tr("Unitless line height") },
    ],
    guide: [
      { target: "style-typography", text: tr("Adjust Line height and Letter spacing."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-line-length", "d-units"],
  },


];
