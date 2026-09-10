/**
 * Webマニュアルの記事（Q&A）。
 * guide の target は画面の data-tutorial の値。新しい場所を案内するときは、
 * 画面側に data-tutorial を足してからここで使う
 */

import type { EditorState, Topic } from "./manual";
import { resolveStyles } from "./style";
import { canContainElements } from "./tags";
import { tr, trc } from "./i18n";

/* ---------- 手順が済んだかの判定 ---------- */

const node = (s: EditorState) => (s.selection ? s.doc.nodes[s.selection] : undefined);

/** 選んでいる要素の、いまの画面幅・状態で効いているスタイル */
const style = (s: EditorState, prop: string): string | undefined => {
  const n = node(s);
  return n ? resolveStyles(n, s.breakpoint, s.styleState)[prop] : undefined;
};

const isContainer = (s: EditorState) => {
  const n = node(s);
  return !!n && canContainElements(n);
};

const hasScript = (s: EditorState, kinds: string[]) => {
  const n = node(s);
  if (!n) return false;
  if (n.link && kinds.some((k) => k === "open-page" || k === "open-url")) return true;
  return !!n.scripts?.some((sc) => sc.steps.some((st) => kinds.includes(st.kind)));
};

const pageCount = (s: EditorState) => s.doc.pageOrder.length;

/* ---------- 記事 ---------- */

export const TOPICS: Topic[] = [
  /* ================= はじめに ================= */
  {
    id: "start-screen",
    cat: "start",
    level: 1,
    q: tr("What does each part of the screen do?"),
    a: tr("**Add and select on the left, view in the middle, change on the right**. The top bar switches screen widths and publishes."),
    keys: [tr("how to use"), tr("screen"), tr("layout"), tr("first time"), tr("panel")],
    ctx: ["none"],
    body: [
      { fig: "editor-map" },
      { rule: tr("When in doubt: select on the canvas, change in the right panel. Almost everything works this way."), title: tr("The basic flow") },
      { note: tr("Open and close the side panels with ⌘[ and ⌘].") },
    ],
    guide: [
      { target: "canvas", text: tr("The middle is the canvas. It shows your page as it is. Click an element to select it.") },
      { target: "left-tabs", text: tr("The tabs at the top of the left panel switch between Pages, Layers, Add, Assets and Site."), prepare: { design: true } },
      { target: "inspector", text: tr("The right panel shows settings for the selected element. With nothing selected, it shows the current page's settings.") },
      { target: "responsive", text: tr("Switch between desktop, tablet and phone views here. You can also change the look for phones only.") },
      { target: "preview", text: tr("In Preview, try out buttons and links just as they'll work when published.") },
      { target: "publish", text: tr("When you're done, click Publish to update your site. Changes save automatically, so there's no save button.") },
    ],
    see: ["start-tutorial", "start-save", "el-select"],
  },
  {
    id: "start-tutorial",
    cat: "start",
    level: 1,
    q: tr("Where should I start?"),
    a: tr("The 10-minute tutorial walks you through the basics as you build a practice page."),
    keys: [tr("Tutorial"), tr("practice"), tr("start"), tr("beginner")],
    ctx: ["none"],
    body: [
      { p: tr("You'll create an unpublished practice page, add a heading, text and buttons, then try layout, spacing, color, links and mobile one by one. Each step explains why.") },
      { action: "tutorial" },
      { p: tr("The tutorial page is unpublished, so it won't appear on your live site. You can delete it from the [[page-order|page list]] when you're done.") },
      { rule: tr("Don't aim for perfect from the start. Placing headings, text, images and buttons first and polishing afterwards gets you there faster."), title: tr("A tip for building") },
    ],
    see: ["start-screen", "el-add", "d-hierarchy"],
  },
  {
    id: "start-save",
    cat: "start",
    level: 1,
    q: tr("How do I save?"),
    a: tr("**Saving is automatic**. When the bottom right says \"Saved to server\", you can open the same content from other devices."),
    keys: [tr("save"), tr("saving"), tr("lost"), tr("autosave"), tr("sync")],
    body: [
      {
        table: {
          head: [tr("Bottom-right status"), tr("Meaning")],
          rows: [
            [tr("Saved to server"), tr("Saving is complete")],
            [tr("Saving to server…"), tr("Saving in progress")],
            [tr("Couldn't save to server"), tr("The connection may be down, for example. Your work is kept in this browser")],
            [tr("Saved in this browser only"), tr("Server storage isn't configured, so work is saved in this browser only")],
          ],
        },
      },
      { p: tr("If you close the editor before saving finishes, you'll be asked next time whether to use this browser's version or the server's.") },
      { note: tr("The server also keeps 7 days of backups automatically. To keep your own file, use [[pub-backup|Backup]].") },
    ],
    guide: [{ target: "save-status", text: tr("Check the save status at the bottom right. \"Saved to server\" means you're all set.") }],
    see: ["start-undo", "start-collab", "pub-backup"],
  },
  {
    id: "start-undo",
    cat: "start",
    level: 1,
    q: tr("How do I undo a mistake?"),
    a: tr("Press ⌘Z to undo and ⇧⌘Z to redo. The arrow buttons in the top bar do the same."),
    keys: [tr("Undo"), tr("undo"), "undo", tr("redo"), "redo", tr("cancel"), "Ctrl+Z", "Ctrl+Y"],
    body: [
      { p: tr("You can undo up to 100 steps. Even after others' changes come in, undo only reverts your own actions.") },
      { warn: tr("Deleting assets (images) and loading a backup can't be undone.") },
      { note: tr("While typing, ⌘Z undoes only that typing. On Windows, Ctrl+Y also redoes.") },
    ],
    guide: [{ target: "undo", text: tr("Use the arrows at the top left to undo and redo.") }],
    see: ["start-shortcuts", "pub-backup"],
  },
  {
    id: "start-shortcuts",
    cat: "start",
    level: 2,
    q: tr("What keyboard shortcuts are there?"),
    a: tr("Common actions have keyboard shortcuts. Keys are shown for your computer (Mac or Windows)."),
    keys: [tr("Shortcuts"), tr("keyboard"), tr("Key"), tr("shortcut list"), "Ctrl", "Command", tr("command"), tr("control")],
    body: [
      {
        table: {
          head: [tr("Key"), tr("Action")],
          rows: [
            ["⌘Z / ⇧⌘Z", tr("Undo / redo")],
            ["⌘C / ⌘X / ⌘V", tr("Copy / cut / paste elements")],
            ["⌘D", tr("Duplicate (all selected elements)")],
            ["Delete", tr("Delete (locked elements aren't deleted)")],
            ["⌘A", tr("Select all elements at the same level")],
            [tr("⇧+click"), tr("Add to or remove from selection")],
            ["Enter", tr("Edit the selected text")],
            ["⇧Enter", tr("Select the parent element")],
            ["Esc", tr("Deselect (or finish editing text)")],
            ["⌘[ / ⌘]", tr("Open/close the left or right panel")],
            [tr("⌘ + scroll"), tr("Zoom the canvas")],
            [tr("{ (while typing)"), tr("Show variable suggestions")],
            ["?", tr("Open this Help")],
          ],
        },
      },
    ],
    see: ["start-undo", "el-select"],
  },
  {
    id: "ai-chat",
    cat: "start",
    level: 1,
    q: tr("I want AI to edit the page for me"),
    a: tr("Click the **sparkle button** (Ask AI) at the top right and describe what you want. AI edits the page, and **⌘Z undoes it all at once**."),
    keys: [tr("AI"), tr("chat"), tr("automatic"), tr("let AI do it"), "Claude"],
    body: [
      { fig: "ai-flow" },
      {
        list: [
          tr("**Adjusting the look** … \"Make the heading bigger\", \"Round the button corners\""),
          tr("**Layout** … \"Put the cards in three columns\", \"Stack them on phones\""),
          tr("**Building** … \"Add a pricing section\", \"Put company info in the footer\""),
          tr("**Writing** … \"Make this description shorter and friendlier\""),
        ],
      },
      { rule: tr("Select an element before asking: \"this\" and \"it\" then refer to it. Asking for one or two things at a time gives more predictable results."), title: tr("Tips for asking") },
      { note: tr("AI only edits the page you have open (or the component you're editing). It can't set up scripts or data, or upload images.") },
      { warn: tr("This button appears only when the editor's administrator has enabled AI on the server. The administrator also chooses which AI is used (Claude, Gemini, etc.).") },
    ],
    guide: [
      { target: "ai", text: tr("Open the AI panel with this button, type what you want, and press Enter to send.") },
    ],
    see: ["start-undo", "el-select"],
  },
  {
    id: "start-collab",
    cat: "start",
    level: 2,
    q: tr("Can I edit at the same time as others?"),
    a: tr("Yes. But if two people change the same element at once, **whoever saves last wins**. Split up pages or sections between people."),
    keys: [tr("simultaneous editing"), tr("collaboration"), tr("multiple people"), tr("conflict")],
    body: [
      { p: tr("Others' saves show up on your screen within seconds. If you edit different elements at the same time, both changes are kept.") },
      { warn: tr("If you change the same element (like the same heading) at the same time, the later save wins. Text isn't merged character by character.") },
      { note: tr("While you're editing text, others' changes wait. They come in when you finish.") },
      { p: tr("Hover over Save at the bottom right to see who made the latest change and who edited in the last 10 minutes. Hover over Publish to see when the site was last published and by whom.") },
    ],
    see: ["start-save", "start-comments", "pub-accounts"],
  },
  {
    id: "start-comments",
    cat: "start",
    level: 2,
    q: tr("I want to leave comments on a page and discuss them with others"),
    a: tr("Turn on comment mode with the speech-bubble button in the top bar (or the C key), then click an element on the canvas to comment on it."),
    keys: [tr("Comments"), tr("note"), tr("review"), tr("feedback"), tr("Reply"), tr("remark")],
    body: [
      { p: tr("A comment is attached to the element you clicked, so it follows that element when you change the screen width or move it. Click a pin to reply, resolve or delete it.") },
      { p: tr("The right panel lists the comments on this page (or all pages). Click one to jump to it.") },
      { note: tr("Comments aren't part of the published site and aren't affected by Undo. You can only edit or delete comments you wrote.") },
    ],
    guide: [
      { target: "comments", text: tr("This button starts comment mode.") },
    ],
    see: ["start-collab"],
  },
  {
    id: "start-zoom",
    cat: "start",
    level: 1,
    q: tr("How do I zoom the canvas?"),
    a: tr("Choose a zoom level from \"Fit\" in the top bar, or scroll while holding ⌘."),
    keys: [tr("Zoom in"), tr("Zoom out"), tr("zoom"), tr("magnification")],
    body: [
      { p: tr("\"Fit\" sizes the canvas to fit your screen. Use 100% or 150% to see details.") },
      { note: tr("Zooming doesn't change the size of your page (only how it looks on screen).") },
    ],
    guide: [{ target: "zoom", text: tr("Choose the zoom level here. You can also zoom by scrolling over the canvas while holding ⌘.") }],
  },

  /* ================= ページ ================= */
  {
    id: "page-add",
    cat: "page",
    level: 1,
    q: tr("How do I create a new page?"),
    a: tr("Click \"Add page\" in the Pages tab of the left panel. Then give it a name and URL."),
    keys: [tr("add page"), tr("new page"), tr("create page")],
    ctx: ["none"],
    body: [
      { p: tr("The new page opens right away. Set its name and URL in the right panel (with nothing selected).") },
      { rule: tr("Turn off \"Publish this page\" for unfinished pages so they stay hidden even when you publish."), title: tr("Keep it as a draft") },
    ],
    guide: [
      { target: "left-tab-pages", text: tr("Open the Pages tab in the left panel."), done: (s) => s.leftTab === "pages" },
      { target: "add-page-button", text: tr("Click \"Add page\"."), prepare: { left: "pages" }, done: (s) => pageCount(s) > 0 && !!s.doc.pages[s.activePageId] },
      { target: "tutorial-page-name", text: tr("Name it in the right panel (visitors don't see this name)."), prepare: { deselect: true, section: "tutorial-page-section" } },
      { target: "tutorial-page-slug", text: tr("Set the URL (the page's address) using letters and numbers."), prepare: { deselect: true, section: "tutorial-page-section" } },
    ],
    see: ["page-url", "page-draft", "page-folder"],
  },
  {
    id: "page-url",
    cat: "page",
    level: 1,
    q: tr("How do I set a page's URL?"),
    a: tr("Enter a short word describing the content in the URL field of Page settings. **Leave it empty for the home page**."),
    keys: ["URL", tr("address"), tr("slug"), "slug", tr("path")],
    ctx: ["none"],
    body: [
      { p: tr("\"access\" becomes \"your-site-URL/access\". Use \"/\" for levels, as in \"news/2026\".") },
      { rule: tr("Join lowercase English words with hyphens (e.g. `about-us`). Don't change it after publishing, or links shared on social media will break."), title: tr("Naming URLs") },
      { note: tr("Links to the page inside the editor update automatically when you change its URL.") },
    ],
    guide: [
      { target: "tutorial-page-slug", text: tr("Enter the URL here and press Enter. Leave it empty for the home page."), prepare: { deselect: true, section: "tutorial-page-section" } },
    ],
    see: ["page-redirect", "page-404", "d-seo"],
  },
  {
    id: "page-draft",
    cat: "page",
    level: 1,
    q: tr("How do I keep an unfinished page private?"),
    a: tr("Turn off \"Publish this page\" in Page settings. **It becomes a draft** and stays hidden when you publish."),
    keys: [tr("unpublished"), tr("draft"), tr("Hide"), tr("don't publish")],
    ctx: ["none"],
    body: [
      { p: tr("Draft pages appear faded in the page list. You can also toggle this with the eye button in the list.") },
      { note: tr("You can't publish if the home page (the page with an empty URL) is unpublished.") },
      { p: tr("To publish a page but keep it out of search results, use \"Hide from search results\" under [[page-seo|Search & sharing]].") },
    ],
    guide: [
      { target: "tutorial-page-publish-checkbox", text: tr("Uncheck this to make it a draft."), prepare: { deselect: true, section: "tutorial-page-section" } },
    ],
    see: ["page-seo", "pub-publish"],
  },
  {
    id: "page-order",
    cat: "page",
    level: 1,
    q: tr("How do I reorder, duplicate or delete pages?"),
    a: tr("In the Pages tab, drag rows to reorder. Hover over a row for duplicate and delete buttons. To move or delete **several pages at once**, use [[page-multi|multi-select]]."),
    keys: [tr("delete page"), tr("duplicate page"), tr("reorder"), tr("page order")],
    body: [
      { p: tr("Duplicating copies the page with all its elements. \"copy\" and \"-copy\" are added to the name and URL to avoid clashes.") },
      { p: tr("Deleted pages can be restored with ⌘Z. Links to the page are removed.") },
      { note: tr("The list order doesn't affect URLs on your live site. Arrange it however is easiest to find things.") },
    ],
    guide: [{ target: "pages-panel", text: tr("Drag rows to reorder. Hover over a row to show duplicate, delete and publish buttons at the right."), prepare: { left: "pages" } }],
    see: ["page-folder", "page-add"],
  },
  {
    id: "page-folder",
    cat: "page",
    level: 1,
    q: tr("I have too many pages (how do I use folders?)"),
    a: tr("Create a folder with the folder button at the top of the Pages tab, then drag pages into it. Folders are for organizing in the editor only and **don't affect URLs**."),
    keys: [tr("Folder"), tr("organize"), tr("group"), tr("categorize")],
    body: [
      { fig: "folders-vs-url" },
      {
        list: [
          tr("Drop onto a folder row → moves it inside"),
          tr("Drag between pages outside the folder → moves it out"),
          tr("The folder's \"+\" → creates a new page inside"),
          tr("Double-click to rename. Deleting a folder keeps its pages"),
        ],
      },
    ],
    guide: [
      { target: "left-tab-pages", text: tr("Open the Pages tab."), done: (s) => s.leftTab === "pages" },
      { target: "add-folder-button", text: tr("Click this folder button to create a new folder. Then type a name and press Enter."), prepare: { left: "pages" }, done: (s) => !!s.doc.pageFolders?.length },
      { target: "pages-panel", text: tr("Drag a page row onto a folder row to move it in. Double-click the folder name to rename it."), prepare: { left: "pages" } },
    ],
    see: ["page-order"],
  },
  {
    id: "page-multi",
    cat: "page",
    level: 2,
    q: tr("I want to organize or delete many pages at once"),
    a: tr("Click the **select button** in the Pages tab, or **⌘-click / Shift-click** pages, and a bar for acting on all of them appears at the top."),
    keys: [tr("multi-select"), tr("bulk"), tr("at once"), tr("bulk delete"), tr("Move to folder")],
    body: [
      { fig: "page-multi" },
      {
        table: {
          head: [tr("Action"), tr("How")],
          rows: [
            [tr("Select one at a time"), tr("⌘-click (Ctrl-click on Windows)")],
            [tr("Select a range"), tr("Shift-click")],
            [tr("Move to folder"), tr("The folder button on the bar, or drag the selected pages onto a folder")],
            [tr("Publish / unpublish"), tr("The eye button on the bar")],
            [tr("Delete"), tr("The trash button on the bar (⌘Z brings them back)")],
            [tr("Stop selecting"), tr("Esc, or the × button on the bar")],
          ],
        },
      },
      { note: tr("A plain click opens a page. Selected pages are separate from the page shown on the canvas, so you can keep working while you organize.") },
    ],
    guide: [
      { target: "pages-panel", text: tr("Click the select button above the list, or ⌘-click pages to select them."), prepare: { left: "pages" } },
    ],
    see: ["page-folder", "page-order"],
  },
  {
    id: "page-seo",
    cat: "page",
    level: 2,
    q: tr("How do I control how pages look in search and social media?"),
    a: tr("With nothing selected, open \"Search & sharing (SEO)\" in the right panel and set the title, description and share image."),
    keys: ["SEO", tr("Title"), tr("Description"), "OGP", tr("share"), tr("search results"), tr("description"), "noindex"],
    ctx: ["none"],
    body: [
      {
        table: {
          head: [tr("Item"), tr("Guideline")],
          rows: [
            [tr("Title"), tr("Around 50–60 characters. Put words that describe the page first")],
            [tr("Description"), tr("About 120–160 characters. The summary shown under the search result")],
            [tr("Share image (OGP)"), tr("1200×630px. The large image shown when shared on social media")],
          ],
        },
      },
      { rule: tr("Give each page its own title. If every page has the same title, people can't tell them apart in search results."), title: tr("A different title for each page") },
      { note: tr("Tabs and search results show \"Title | Site name\". With \"Hide from search results\" on, only people who know the URL can open it.") },
    ],
    guide: [
      { target: "page-seo", text: tr("Open \"Search & sharing (SEO)\" and enter the title, description and share image."), prepare: { deselect: true, section: "page-seo" } },
    ],
    see: ["d-seo", "pub-site"],
  },
  {
    id: "page-404",
    cat: "page",
    level: 3,
    q: tr("How do I make a page for missing URLs (404)?"),
    a: tr("Create a page with the URL \"404\". It's shown whenever someone opens an address that doesn't exist."),
    keys: ["404", tr("not found"), tr("error page"), "Not Found"],
    body: [
      { p: tr("It usually has a message like \"We couldn't find that page\" and a button back to the home page.") },
      { rule: tr("Always give a 404 page somewhere to go, like \"Back to home\". A dead end makes visitors leave your site.") },
    ],
    see: ["page-url", "page-redirect"],
  },
  {
    id: "page-redirect",
    cat: "page",
    level: 3,
    q: tr("How do I send an old URL to a new page (redirect)?"),
    a: tr("Create a page, set \"Page type\" to \"Redirect\" under \"Custom code\" in Page settings, and enter the target."),
    keys: [tr("Redirect"), tr("forward"), "301", tr("URL change"), tr("reverse proxy")],
    body: [
      { p: tr("Enter a site URL like \"/new-page\" or an external URL starting with \"https://\". It's a 301 redirect, which tells search engines the page has moved.") },
      { warn: tr("301 redirects ignore letter case and also match a trailing /. Changing only the query (after ?) or # still returns to the same redirect, so choose a different path. For sources containing [slug], make sure the destination does not return to the same rule either.") },
      { p: tr("\"Show an external site\" displays another site's content while keeping your address (a reverse proxy).") },
      { p: tr("Under the home page (/), this site's pages and files take priority. Only unmatched paths are forwarded to the external site.") },
      { p: tr("If the destination URL contains ? or #, only paths matching this page's URL are forwarded.") },
      { note: tr("This site does not forward /_next/image to the external site. Some features, such as the external site's image optimization, may not work the same way.") },
      { rule: tr("When you change the URL of a published page, add a redirect at the old URL so links shared on social media keep working.") },
    ],
    guide: [
      { target: "page-code", text: tr("Choose \"Redirect\" under \"Page type\" in \"Custom code\"."), prepare: { deselect: true, section: "page-code" } },
    ],
    see: ["page-url"],
  },
  {
    id: "page-html",
    cat: "page",
    level: 4,
    q: tr("How do I add a page written directly in HTML?"),
    a: tr("Set \"Page type\" to \"HTML\" under \"Custom code\" in Page settings, and your HTML is served as is."),
    keys: ["HTML", tr("Code"), tr("hand-coded"), tr("game"), "ZIP"],
    body: [
      { p: tr("You can load an HTML file, or a zip bundling images, CSS and JavaScript. Files in the zip are added to Assets automatically, and references in the HTML are updated.") },
      { warn: tr("HTML pages don't include the site-wide header, meta information or custom code, and can't be edited on the canvas.") },
      { p: tr("To add HTML to just part of a page, use the Code element from Add.") },
    ],
    guide: [
      { target: "page-code", text: tr("Choose \"HTML\" under \"Page type\", then paste code or load a file or zip."), prepare: { deselect: true, section: "page-code" } },
    ],
    see: ["page-code-snippet"],
  },
  {
    id: "page-code-snippet",
    cat: "page",
    level: 4,
    q: tr("How do I add analytics code (like Google Analytics)?"),
    a: tr("For every page, paste it into \"Head code\" under \"Custom code (all pages)\" in the Site tab. For specific pages, use \"Custom code\" in Page settings."),
    keys: ["Google Analytics", tr("analytics"), tr("tag"), tr("tracking"), "head", tr("Scripts"), "JSON-LD"],
    ctx: ["site"],
    body: [
      { p: tr("Paste the `<script>` code from your analytics service as is. Structured data (JSON-LD) goes in the same place.") },
      { warn: tr("Code goes onto your live site as is, without checks. Only paste code from sources you trust, and test it on the [[pub-publish|test site]] before publishing.") },
    ],
    guide: [
      { target: "site-code", text: tr("Open \"Custom code (all pages)\" and paste into \"Head code\"."), prepare: { left: "site", section: "site-code" } },
    ],
    see: ["page-html"],
  },

  /* ================= 要素の追加と選択 ================= */
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
            [tr("Box"), tr("A container for other elements. The base for layout and backgrounds")],
            [tr("Heading"), tr("Titles for pages and sections")],
            [tr("Text", "text_variant_1"), tr("Body")],
            [tr("Button"), tr("Actions you want people to take (sign up, learn more, etc.)")],
            [tr("Image"), tr("Photos, logos, illustrations")],
          ],
        },
      },
      { rule: tr("Select where you want it before adding to save reordering later. \"Insert into\" at the top of the Add tab shows where it'll go."), title: tr("Choose the spot first") },
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
      { p: tr("The setting applies not only to adding elements but also to **pasting (⌘V)** and adding images or components. It isn't asked every time; the last choice in this browser is used.") },
      { note: tr("When the selected element can't contain others, like text or an image, it always goes after.") },
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
      { fig: "select-depth", caption: tr("Each click on the same spot goes one level deeper. ⌘-click selects the innermost element at once") },
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
      { rule: tr("To move elements, change their order and container (box) instead of position numbers. That way nothing breaks when the screen width changes."), title: tr("Position by order") },
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
    a: tr("Lock it with **Lock** under Settings in the right panel, or the lock button on its row in Layers. To hide it, use the eye button in Layers."),
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
      { p: tr("On \"Auto\", it's chosen from the content. If unsure, Auto is fine.") },
    ],
    guide: [{ target: "settings-semantic", text: tr("Choose the meaning here."), needs: "container", prepare: { right: "settings" } }],
    see: ["text-heading", "d-accessibility"],
  },

  /* ================= 文字 ================= */
  {
    id: "text-edit",
    cat: "text",
    level: 1,
    q: tr("How do I edit text or add line breaks?"),
    a: tr("**Double-click text** to edit it. Enter adds a line break; Esc or clicking outside confirms."),
    keys: [tr("Text"), tr("Text", "text_variant_1"), tr("edit"), tr("rewrite"), tr("line break")],
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
    a: tr("Choose one under Font in Text. Use \"+\" on the right to add a Google Fonts font by name."),
    keys: [tr("Font"), tr("typeface"), "Google Fonts", tr("serif"), tr("sans-serif")],
    ctx: ["text", "body"],
    body: [
      { p: tr("Find one on fonts.google.com and enter its name exactly as shown (e.g. Playfair Display).") },
      { rule: tr("Use at most two fonts (one for headings, one for body). More fonts look less unified and load slower. Fonts with large character sets (like Japanese) are especially heavy, so a system font for body text is a good option."), title: tr("Two fonts at most") },
    ],
    guide: [
      { target: "style-typography", text: tr("Choose from the Font field, or add one from Google Fonts with \"+\" on the right."), needs: "text", prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-fonts", "d-performance"],
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
    a: tr("Adjust Line height and Letter spacing under Text. For body text, **a line height around 1.5–1.9** is easy to read (Japanese text needs the higher end)."),
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

  /* ================= レイアウト ================= */
  {
    id: "layout-row",
    cat: "layout",
    level: 1,
    q: tr("How do I place elements side by side?"),
    a: tr("Put the elements in one box, **select that box (the parent)**, and set Flow under Layout to horizontal (the right arrow)."),
    keys: [tr("side by side"), tr("horizontal"), tr("arrangement"), "flex", tr("flex"), tr("Flow")],
    ctx: ["box"],
    body: [
      { fig: "parent-row" },
      { rule: tr("Whenever you want things side by side or centered, select the parent (container) first. It holds up across screen widths better than moving children one by one."), title: tr("The parent decides the layout") },
      { fig: "flow-modes", caption: tr("There are four flows. \"Auto\" follows the flow of text, and Grid arranges items in cells.") },
    ],
    guide: [
      { target: "canvas", text: tr("Select the box (parent) containing the elements. If a child is selected, press ⇧Enter to select the parent."), needs: "container" },
      {
        target: "style-layout",
        text: tr("Click the right arrow (horizontal) in Flow."),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => isContainer(s) && style(s, "display") === "flex" && (style(s, "flexDirection") ?? "row").startsWith("row"),
      },
      { target: "style-layout", text: tr("Use the 3×3 grid in Alignment to set the position, and Gap for the space between elements."), prepare: { right: "style", section: "style-layout" } },
    ],
    see: ["layout-center", "layout-gap", "resp-stack"],
  },
  {
    id: "layout-center",
    cat: "layout",
    level: 1,
    q: tr("How do I center an element (horizontally and vertically)?"),
    a: tr("Select the parent box, set Flow to vertical or horizontal, then click **the middle of the 3×3 grid in Alignment**."),
    keys: [tr("Center"), tr("middle"), tr("center"), tr("centering"), tr("vertical center")],
    ctx: ["box"],
    body: [
      { fig: "align-center" },
      { p: tr("Vertical centering needs the parent to have a height (or min height). If it's only as tall as its content, there's no room to center in.") },
      { note: tr("To center the text itself, use [[text-align|text alignment]].") },
    ],
    guide: [
      { target: "canvas", text: tr("Select the parent (container box) of the element you want to center."), needs: "container" },
      {
        target: "style-layout",
        text: tr("Set Flow to vertical (↓) or horizontal (→)."),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => style(s, "display") === "flex",
      },
      {
        target: "style-layout",
        text: tr("Click the middle of the 3×3 grid in Alignment."),
        prepare: { right: "style", section: "style-layout" },
        done: (s) => style(s, "alignItems") === "center" && style(s, "justifyContent") === "center",
      },
    ],
    see: ["layout-row", "text-align", "layout-height"],
  },
  {
    id: "layout-gap",
    cat: "layout",
    level: 1,
    q: tr("How do I add space between elements?"),
    a: tr("Select the parent box and enter a number in Gap under Layout. **All elements inside get the same spacing**."),
    keys: [tr("Gap"), tr("gap"), tr("space"), "gap", tr("spacing"), tr("even")],
    ctx: ["box"],
    body: [
      { fig: "gap-vs-margin" },
      { rule: tr("Set spacing once with the parent's Gap instead of adding margins to each child. Spacing stays even as you add or remove elements."), title: tr("Use the parent's gap") },
      { note: tr("The Auto button next to Gap pushes items to both ends and spreads the rest evenly. Keep numbers on a scale like 8, 16, 24… for a tidy look ([[d-spacing|spacing rules]]).") },
    ],
    guide: [
      { target: "canvas", text: tr("Select the parent (container) of the elements."), needs: "container" },
      { target: "style-layout", text: tr("Enter a number in Gap, which appears when Flow is vertical, horizontal or grid. If Flow is Auto, switch to vertical first."), prepare: { right: "style", section: "style-layout" }, done: (s) => !!style(s, "gap") },
    ],
    see: ["layout-spacing", "d-spacing"],
  },
  {
    id: "layout-spacing",
    cat: "layout",
    level: 1,
    q: tr("What's the difference between padding and margin?"),
    a: tr("Padding is the space inside the border (between content and edge). Margin is the space outside it (between neighbors)."),
    keys: [tr("Spacing"), tr("Padding"), tr("Margin"), "padding", "margin", tr("padding"), tr("margin")],
    ctx: ["box", "text"],
    body: [
      { fig: "box-model" },
      { p: tr("In Spacing, the left field is left/right and the right field is top/bottom. Use the square button to set each side separately.") },
      { rule: tr("Around button text, make left/right about twice top/bottom (e.g. 12px top/bottom, 24px left/right). Aim for a tap target at least 44px tall."), title: tr("Button padding") },
    ],
    guide: [
      { target: "style-spacing", text: tr("Set padding and margin under Spacing. The left field is left/right; the right is top/bottom."), needs: "any", prepare: { right: "style", section: "style-spacing" } },
    ],
    see: ["layout-gap", "d-spacing", "d-mobile"],
  },
  {
    id: "layout-width",
    cat: "layout",
    level: 2,
    q: tr("How do I make an element full width or fill the remaining width?"),
    a: tr("Enter 100% for W under Size to fill the parent's width. In a row, use the arrow button next to W (Fill remaining space)."),
    keys: [tr("Width"), tr("width"), "100%", tr("full width"), tr("Fill remaining space"), tr("Stretch"), tr("Size")],
    ctx: ["box", "image"],
    body: [
      { fig: "width-percent" },
      { rule: tr("Match the parent with % or \"Fill remaining space\", and cap it with a px Max width. Fix sizes in px only for things like icons that shouldn't change."), title: tr("Size widths to the parent") },
      { note: tr("With width empty (auto), a box fills its parent, or fits its content inside a row. Click the unit to switch units while keeping the same size.") },
    ],
    guide: [
      { target: "style-layout", text: tr("Enter 100% for W under Size, or in a row, turn on \"Fill remaining space\" with the arrow button."), needs: "any", prepare: { right: "style", section: "style-layout" } },
    ],
    see: ["d-units", "layout-max-width", "d-no-fixed-height"],
  },
  {
    id: "layout-max-width",
    cat: "layout",
    level: 2,
    q: tr("How do I stop content from getting too wide on desktop?"),
    a: tr("Give the content box a **Max width (e.g. 1080px)** and center it with the parent's Alignment."),
    keys: [tr("Max width"), "max-width", tr("content width"), tr("too wide"), tr("Center")],
    ctx: ["box"],
    body: [
      { fig: "max-width" },
      { rule: tr("Aim for a max width of about 640–760px for text and 1080–1200px for card rows. A full-width background box with a max-width content box inside is the standard pattern."), title: tr("Content width guide") },
    ],
    guide: [
      { target: "style-layout", text: tr("Click the button to the right of Size and enter a Max width."), needs: "container", prepare: { right: "style", section: "style-layout" } },
    ],
    see: ["d-line-length", "layout-center"],
  },
  {
    id: "layout-grid",
    cat: "layout",
    level: 2,
    q: tr("How do I arrange cards in 2 or 3 columns?"),
    a: tr("Select the box containing the cards, set Flow to Grid, and enter a number in Columns."),
    keys: [tr("Grid"), tr("Columns"), tr("card"), tr("tile"), tr("2 columns"), tr("3 columns"), tr("grid cells")],
    ctx: ["box", "list"],
    body: [
      { fig: "grid-responsive" },
      { p: tr("Items that don't fit move to the next row. Gap lets you set column and row spacing separately.") },
      { rule: tr("Three columns on desktop, one on phones. Switch to the [[resp-basics|phone view]] and change only Columns; the desktop keeps its three."), title: tr("Fewer columns on smaller screens") },
    ],
    guide: [
      { target: "canvas", text: tr("Select the box containing the cards."), needs: "container" },
      { target: "style-layout", text: tr("Click the last Flow option (Grid) and enter the number of columns."), prepare: { right: "style", section: "style-layout" }, done: (s) => style(s, "display") === "grid" },
    ],
    see: ["resp-stack", "data-list"],
  },
  {
    id: "layout-wrap",
    cat: "layout",
    level: 2,
    q: tr("How do I wrap a row onto the next line when it doesn't fit?"),
    a: tr("Check \"Wrap\" on a box with horizontal flow."),
    keys: [tr("Wrapping"), "wrap", tr("overflow"), tr("side by side"), tr("tag")],
    ctx: ["box"],
    body: [
      { fig: "wrap" },
      { note: tr("Good for rows with a varying number of items, like tags. For a fixed number like three cards, a [[layout-grid|grid]] keeps columns aligned.") },
    ],
    guide: [
      { target: "style-layout", text: tr("Check \"Wrap\", which appears with horizontal flow."), needs: "container", prepare: { right: "style", section: "style-layout" } },
    ],
  },
  {
    id: "layout-height",
    cat: "layout",
    level: 2,
    q: tr("How do I make a full-screen-height hero section?"),
    a: tr("Set the box's Min height to 100vh (the screen height) and center its content with Alignment."),
    keys: [tr("height"), tr("above the fold"), tr("Hero"), tr("full screen"), "vh", tr("Full screen")],
    ctx: ["box"],
    body: [
      { fig: "min-height-vh" },
      { rule: tr("A fixed Height overflows when text grows or wraps on phones. Use Min height when you want to set a height."), title: tr("Use min height") },
    ],
    see: ["d-no-fixed-height", "d-units", "layout-center"],
  },
  {
    id: "layout-position",
    cat: "layout",
    level: 3,
    q: tr("How do I position an element freely or overlap other elements?"),
    a: tr("Set Position to Custom to place it by X and Y relative to its parent. Use this **only to take things out of the normal flow**, like overlay text or badges."),
    keys: [tr("free position"), tr("overlap"), "absolute", tr("Position"), tr("coordinates"), tr("badge")],
    ctx: ["box", "image", "text"],
    body: [
      { fig: "position-custom" },
      { p: tr("Set \"Relative to\" to Viewport to fix it to the screen. Change what's in front with Stacking order.") },
      { rule: tr("Normally position things with layout (flow, alignment, spacing), and use Custom only for true overlaps. Custom elements easily collide with others when the screen width changes."), title: tr("Free positioning is a last resort") },
    ],
    guide: [
      { target: "style-position", text: tr("Choose Custom under Position and set X, Y and the anchor."), needs: "any", prepare: { right: "style", section: "style-position" } },
    ],
    see: ["d-flow-not-absolute", "layout-sticky"],
  },
  {
    id: "layout-sticky",
    cat: "layout",
    level: 3,
    q: tr("How do I keep the header at the top while scrolling?"),
    a: tr("Set the header box's Position to Sticky. It stops at the top when you scroll there and stays visible."),
    keys: [tr("Sticky"), tr("Fixed"), tr("sticky header"), "sticky", "fixed", tr("Scroll")],
    ctx: ["box"],
    body: [
      { fig: "sticky" },
      { p: tr("Sticky works on a header placed directly in the page. If it hides behind other elements, bring it forward with Stacking order.") },
      { rule: tr("A sticky header takes up a lot of a phone screen. Consider keeping it shorter on phones.") },
    ],
    guide: [
      { target: "style-position", text: tr("Choose Sticky under Position and enter the distance \"From the top edge\"."), needs: "container", prepare: { right: "style", section: "style-position" } },
    ],
    see: ["layout-position"],
  },
  {
    id: "layout-overflow",
    cat: "layout",
    level: 3,
    q: tr("How do I hide overflow or make just that area scroll?"),
    a: tr("Set Overflow under Layout to Hidden or Scroll."),
    keys: [tr("Overflow"), "overflow", tr("Scroll"), tr("Hide"), tr("clip")],
    ctx: ["box"],
    body: [
      { p: tr("If an image pokes out of a rounded box's corners, Hidden clips it to the corners.") },
      { warn: tr("Elements that overflow sideways make the whole page wobble horizontally on phones. Before hiding overflow, fix the width of the overflowing element (the pre-publish check flags this too).") },
    ],
    see: ["d-units", "look-radius"],
  },

  /* ================= 色と見た目 ================= */
  {
    id: "look-color",
    cat: "look",
    level: 1,
    q: tr("How do I change background or text colors?"),
    a: tr("For backgrounds, choose Color under Background in Style. For text, change Color under Text."),
    keys: [tr("Color"), tr("Background color"), tr("Text color"), tr("color"), tr("fill")],
    ctx: ["box", "text", "body"],
    body: [
      { p: tr("Pick from the swatch or type a code like #2563eb. The number on the right is opacity.") },
      { rule: tr("Limit yourself to base, main and accent colors, and keep strong contrast between text and background ([[d-color|choosing colors]])."), title: tr("Stick to three colors") },
    ],
    guide: [
      { target: "style-background", text: tr("Choose Color under Background and pick a color."), needs: "any", prepare: { right: "style", section: "style-background" } },
      { target: "style-typography", text: tr("Change text color with Color under Text."), prepare: { right: "style", section: "style-typography" } },
    ],
    see: ["d-color", "look-bg-image"],
  },
  {
    id: "look-bg-image",
    cat: "look",
    level: 2,
    q: tr("How do I use an image or gradient as a background?"),
    a: tr("Choose Image or Gradient under Background. Pick an image from Assets or upload a new one."),
    keys: [tr("background image"), tr("Gradient"), tr("Background"), tr("photo"), tr("Cover")],
    ctx: ["box", "body"],
    body: [
      { p: tr("Set Size to Cover to fill the area without gaps, cropping the overflow. Position decides which part stays visible.") },
      { rule: tr("When putting text over a photo, give the text's box a semi-transparent black background. The text stays readable on any photo."), title: tr("Text over photos") },
      { note: tr("Put important info like dates and places in text, not baked into a background image. Search engines and screen readers can read it, and it's legible on phones.") },
    ],
    guide: [
      { target: "style-background", text: tr("Choose Image or Gradient under Background."), needs: "any", prepare: { right: "style", section: "style-background" } },
    ],
    see: ["look-color", "d-images"],
  },
  {
    id: "look-radius",
    cat: "look",
    level: 2,
    q: tr("How do I round corners or add a shadow?"),
    a: tr("For corners, use Corner radius under Appearance. For shadows, add a Drop shadow with \"+\" under Effects."),
    keys: [tr("rounded corners"), tr("round"), tr("Shadow"), tr("Shadow"), tr("Drop shadow"), tr("depth")],
    ctx: ["box", "image"],
    body: [
      { fig: "shadow" },
      { rule: tr("For a refined shadow, use a large blur and light color (e.g. Y 4px, blur 16px, about 10% opacity). Keep corner radius and shadows consistent across the site."), title: tr("Shadows and corners") },
      { note: tr("For a circular image, make width and height equal and set a large corner radius (like 999px).") },
    ],
    guide: [
      { target: "style-appearance", text: tr("Enter a number for Corner radius under Appearance."), needs: "any", prepare: { right: "style", section: "style-appearance" } },
      { target: "style-effects", text: tr("Add shadows with \"+\" at the top right of Effects."), prepare: { right: "style", section: "style-effects" } },
    ],
    see: ["d-consistency", "look-border"],
  },
  {
    id: "look-border",
    cat: "look",
    level: 1,
    q: tr("How do I add a border?"),
    a: tr("Enter a width under Border in Style to add one. You can choose a style (solid, dashed, etc.) and color too."),
    keys: [tr("border"), tr("Border"), tr("outline"), "border", tr("frame")],
    ctx: ["box", "image"],
    body: [
      { rule: tr("Separating with spacing or background color looks cleaner than adding lines. When you do use a line, a 1px light gray is the norm.") },
    ],
    guide: [
      { target: "style-border", text: tr("Enter a width under Border."), needs: "any", prepare: { right: "style", section: "style-border" } },
    ],
    see: ["look-radius", "d-hierarchy"],
  },
  {
    id: "look-hover",
    cat: "look",
    level: 2,
    q: tr("How do I change color on mouse-over (hover)?"),
    a: tr("**Switch State at the top of the right panel to Hover**, then change colors and so on. Those settings apply only while the mouse is over the element."),
    keys: [tr("Hover"), tr("mouse-over"), tr("State"), tr("Pressed"), "hover", "active"],
    ctx: ["box", "text"],
    body: [
      { fig: "states" },
      { p: tr("Settings changed in a state apply only in that state. Switch back to Default when you're done. To smooth the color change, add \"On state change\" in [[look-animation|Motion]].") },
      { rule: tr("Phones have no hover. Don't hide information behind hover; keep it to a hint that something is clickable."), title: tr("Don't rely on hover") },
    ],
    guide: [
      { target: "style-state", text: tr("Choose Hover under State."), needs: "any", prepare: { right: "style" }, done: (s) => s.styleState === "hover" },
      { target: "style-background", text: tr("Change the background color or other styles. These apply only on hover."), prepare: { right: "style", section: "style-background" } },
      { target: "preview", text: tr("Check it by hovering in Preview. Switch State back to Default when you're done.") },
    ],
    see: ["look-animation", "d-accessibility"],
  },
  {
    id: "look-animation",
    cat: "look",
    level: 3,
    q: tr("How do I make things fade in (animation)?"),
    a: tr("Add motion with \"+\" under Motion in Style, and set the trigger to \"When scrolled into view\" or \"Play on page load\"."),
    keys: [tr("animation"), tr("Motion"), tr("fade"), tr("Animation"), tr("Scroll"), tr("transition")],
    ctx: ["box", "text", "image"],
    body: [
      {
        table: {
          head: [tr("Triggers"), tr("When it plays")],
          rows: [
            [tr("On state change"), tr("When the look changes, e.g. on hover (smooths the change)")],
            [tr("Play on hover / Play on press"), tr("On mouse-over or press")],
            [tr("Play on page load"), tr("When the page opens")],
            [tr("When scrolled into view"), tr("When scrolled into view (once)")],
          ],
        },
      },
      { rule: tr("About 0.2–0.5 seconds feels right. Animate only key things like headings and images."), title: tr("Keep motion short and sparse") },
    ],
    guide: [
      { target: "style-motion", text: tr("Add it with \"+\" at the top right of Motion, then choose the trigger and animation."), needs: "any", prepare: { right: "style", section: "style-motion" } },
      { target: "preview", text: tr("Check the motion in Preview.") },
    ],
    see: ["look-hover", "d-performance"],
  },
  {
    id: "look-effects",
    cat: "look",
    level: 3,
    q: tr("How do I add effects like transparency, frosted glass or black and white?"),
    a: tr("Use Opacity under Appearance for transparency, Background blur under Effects for frosted glass, and Grayscale for black and white."),
    keys: [tr("translucent"), tr("transparent"), tr("frosted glass"), tr("Blur"), tr("black and white"), tr("filter", "filter_variant_1"), tr("blend")],
    ctx: ["box", "image"],
    body: [
      { p: tr("Background blur blurs whatever is behind the element. Combined with a semi-transparent (60–80%) background color, it looks like frosted glass.") },
      { warn: tr("Adding blur or shadows to many elements can make things sluggish on phones.") },
    ],
    guide: [
      { target: "style-effects", text: tr("Set effects under Effects."), needs: "any", prepare: { right: "style", section: "style-effects" } },
    ],
  },
  {
    id: "look-transform",
    cat: "look",
    level: 3,
    q: tr("I want to nudge, scale or skew an element (transform)"),
    a: tr("Add Transform with the + in Effects to set move, scale, rotate and skew, and their origin. The layout around the element doesn't change."),
    keys: ["transform", tr("Transform", "transform_variant_1"), tr("Zoom in"), tr("Zoom out"), tr("Rotation"), tr("skew"), tr("Navigation"), tr("nudge")],
    ctx: ["box", "image"],
    body: [
      { p: tr("Set the state to Hover, set Scale to 105%, and add a “state change” motion to make a button or card that grows smoothly when the pointer is over it.") },
      { note: tr("A move in % is relative to the element's own size (-50% moves it left by half its width).") },
    ],
    guide: [
      { target: "style-effects", text: tr("Choose Transform from the + in Effects."), needs: "any", prepare: { right: "style", section: "style-effects" } },
    ],
    see: ["look-hover", "look-animation"],
  },
  {
    id: "form-fields",
    cat: "element",
    level: 2,
    q: tr("I want to set up inputs, checkboxes, switches and sliders"),
    a: tr("Select the field. Set its type, initial value, placeholder and whether it's required under Form field on the Settings tab, and colors such as the checkbox or slider color under Input on the Style tab."),
    keys: [tr("Input", "input_variant_2"), tr("Form"), tr("Checkbox", "checkbox_variant_1"), tr("Radio button"), tr("slider"), "input", "accent-color", tr("Default value"), tr("placeholder")],
    body: [
      { p: tr("The initial value, placeholder, label and options can contain {variables}, such as fetched data or the value of another field ({ID}).") },
      { p: tr("Number, slider and date fields have a minimum, maximum and step; text fields have a maximum length. A Required field can't be submitted empty.") },
      { p: tr("For checkboxes and switches, {ID} is true when checked and false when not. When a script's If compares it, you can pick On or Off.") },
      { p: tr("Radio buttons with the same Group allow only one choice. {group name} is the chosen button's value (its label), and {ID} is true or false depending on whether that button is chosen.") },
      { note: tr("Under Show advanced in Find a variable you can also pick whether a field is disabled ({ID.disabled}), its length ({ID.length}) and the chosen number ({ID.index}). The script block “Set ［field］ to ［enabled / disabled］” switches it.") },
    ],
    see: ["act-vars", "data-search"],
  },
  {
    id: "look-custom-css",
    cat: "look",
    level: 4,
    q: tr("How do I write CSS that isn't in the panel?"),
    a: tr("Write it as `property: value;` in Custom CSS at the bottom of Style."),
    keys: ["CSS", tr("Custom CSS"), tr("Code"), "clip-path"],
    body: [
      { code: "clip-path: circle(50%);\nscroll-margin-top: 80px;" },
      { warn: tr("Custom CSS always applies, regardless of screen width or state. Use the panel for anything that should vary by screen width.") },
    ],
    guide: [
      { target: "style-css", text: tr("Write CSS here."), needs: "any", prepare: { right: "style", section: "style-css" } },
    ],
  },

  /* ================= 画像と動画 ================= */
  {
    id: "img-add",
    cat: "image",
    level: 1,
    q: tr("How do I add an image?"),
    a: tr("Upload images in the Assets tab, then click one or drag it onto the canvas. You can also drop image files from your computer straight onto the canvas."),
    keys: [tr("Image"), tr("photo"), tr("upload"), tr("Assets"), tr("drop"), tr("Paste")],
    ctx: ["none", "image"],
    body: [
      { p: tr("Click an asset while an image is selected to replace it. Images and SVGs copied from tools like Figma can be pasted with ⌘V.") },
      { rule: tr("Resize photos to under 2000px wide and 500KB each before uploading. Oversized images are the biggest cause of slow pages."), title: tr("Shrink images first") },
      { note: tr("You can store up to 25MB per file. Total storage is limited to 1GB on Cloudflare's free plan. Remove unused files all at once with \"Delete unused\".") },
    ],
    guide: [
      { target: "left-tab-assets", text: tr("Open the Assets tab."), done: (s) => s.leftTab === "assets" },
      { target: "asset-upload", text: tr("Click here or drop image files to upload."), prepare: { left: "assets" } },
      { target: "assets-panel", text: tr("Click an uploaded image to insert it at the selected spot, or drag it onto the canvas."), prepare: { left: "assets" } },
    ],
    see: ["img-fit", "img-alt", "d-images"],
  },
  {
    id: "img-fit",
    cat: "image",
    level: 2,
    q: tr("How do I make images the same size and shape (cropping)?"),
    a: tr("Select the image, choose an aspect ratio under Image in Style, and **set Fit to \"Fill frame\"**. Photos with different ratios end up the same shape."),
    keys: [tr("crop"), tr("trim"), tr("Aspect ratio"), tr("ratio"), "object-fit", tr("square"), tr("Thumbnail")],
    ctx: ["image"],
    body: [
      { fig: "object-fit", caption: tr("The same square photo in a wide frame") },
      { p: tr("Use \"Fill frame\" for photos and \"Show all\" for logos. Focal point chooses what to keep when cropping (toward the top for people).") },
      { rule: tr("Images in a row look tidy just by sharing an aspect ratio. Photos often use 4:3 or 16:9; products and icons, 1:1."), title: tr("Match ratios for images in a row") },
    ],
    guide: [
      { target: "style-image", text: tr("Choose the aspect ratio under Image and set Fit."), needs: "image", prepare: { right: "style", section: "style-image" } },
    ],
    see: ["img-add", "layout-grid"],
  },
  {
    id: "img-alt",
    cat: "image",
    level: 1,
    q: tr("What should I write in alt text?"),
    a: tr("**Describe in one sentence what the image conveys**, for people who can't see it. Enter it in Alt text under Settings in the right panel."),
    keys: ["alt", tr("Alt text"), tr("accessibility"), tr("screen reader")],
    ctx: ["image"],
    body: [
      { fig: "alt-text" },
      {
        table: {
          head: [tr("Image"), tr("Example alt text")],
          rows: [
            [tr("A photo of the shop"), tr("A bright interior with rows of wooden tables")],
            [tr("Logo"), tr("Sunny Café (just the site name)")],
            [tr("An image with text"), tr("The text in the image, as is")],
            [tr("Decorative lines or patterns"), tr("Can be left empty (it conveys nothing)")],
          ],
        },
      },
      { rule: tr("Avoid just writing \"image\" or \"photo\". Say what's in it and what it's meant to convey."), title: tr("Writing alt text") },
    ],
    guide: [
      { target: "settings-image", text: tr("Enter a description of the image in Alt text."), needs: "image", prepare: { right: "settings" } },
    ],
    see: ["d-accessibility", "img-add"],
  },
  {
    id: "img-media",
    cat: "image",
    level: 2,
    q: tr("How do I embed video, YouTube or maps?"),
    a: tr("Add Video, Audio, YouTube or Map from \"Media & embeds\" in the Add tab, then enter the URL or place under Settings in the right panel."),
    keys: [tr("Video"), "YouTube", tr("map"), tr("Map"), tr("embed"), tr("Audio"), "iframe"],
    ctx: ["media"],
    body: [
      { p: tr("For YouTube, just enter the video URL; for maps, an address or place name. Video and audio files can be chosen from Assets.") },
      { rule: tr("Autoplaying videos only play muted. If sound matters, let visitors press play themselves.") },
    ],
    guide: [{ target: "add-panel", text: tr("Choose what to add from \"Media & embeds\"."), prepare: { left: "add" } }],
  },
  {
    id: "img-icon",
    cat: "image",
    level: 1,
    q: tr("How do I use icons?"),
    a: tr("Add an Icon from the Add tab, then search and pick one under Settings in the right panel. Change its color with the text color and its size with Size."),
    keys: [tr("Icon"), tr("mark"), tr("symbol"), "icon"],
    body: [
      { p: tr("Set the color with Color under Text and the size with Size under Layout. For your own icons, upload an SVG to Assets and place it as an image.") },
      { rule: tr("Icons alone can be unclear. Add a short label to important actions.") },
    ],
    see: ["img-add"],
  },

  /* ================= スマホ対応 ================= */
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
      { note: tr("Use the button next to the width field to check small (360px) and large (430px) phones too. It's worth making sure text and spacing don't feel cramped on narrow devices.") },
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
      { p: tr("Clearing a number field on phone (or similar) overrides it with \"no value\". To fall back to the larger screen's setting, right-click instead.") },
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
      { rule: tr("Choose breakpoints by where the design starts to break, not by device model. Too many gets hard to manage; 3–4 levels (desktop, tablet, phone) is typical.") },
    ],
    guide: [
      { target: "site-breakpoints", text: tr("Rename, resize, add or remove them here."), prepare: { left: "site", section: "site-breakpoints" } },
    ],
    see: ["resp-basics"],
  },

  /* ================= リンクと動き ================= */
  {
    id: "act-link",
    cat: "action",
    level: 1,
    q: tr("How do I make a button go to another page (link)?"),
    a: tr("Select the button, open \"Edit page scripts\" under Settings, and attach \"Open ［page / URL］\" under \"When clicked\"."),
    keys: [trc("help_search", "link"), tr("navigate"), tr("go to page"), tr("jump"), tr("click"), "URL", tr("Button")],
    ctx: ["box", "text", "image"],
    body: [
      { fig: "script-blocks" },
      { p: tr("A plain \"When clicked → Open\" combination becomes a regular link on your live site. For external sites, switch ［page］ to URL and enter the address.") },
      { rule: tr("Link text should say where it goes, like \"Go to the sign-up form\", not \"Click here\". Screen readers sometimes read links on their own."), title: tr("Link text") },
    ],
    guide: [
      { target: "canvas", text: tr("Select the button (element) to link."), needs: "any" },
      { target: "right-tab-settings", text: tr("Open Settings in the right panel."), done: (s) => s.rightTab === "settings" },
      { target: "settings-link", text: tr("Click \"Edit page scripts\"."), prepare: { right: "settings" }, done: (s) => !!s.scriptEditor },
      {
        target: "se-block-click",
        text: tr("Drag \"When clicked\" from the block list on the left into the large area on the right."),
        hint: tr("If the block list is closed, open it with the button at the top left."),
        done: (s) => !!node(s)?.link || !!node(s)?.scripts?.some((sc) => sc.trigger === "click"),
      },
      {
        target: "se-block-open-page",
        text: tr("Drag \"Open ［page / URL］\" right under the \"When clicked\" block to attach it."),
        done: (s) => hasScript(s, ["open-page", "open-url"]),
      },
      {
        target: "se-workspace",
        text: tr("Choose the page to open in the attached block. For external sites, switch to URL and enter the address."),
        done: (s) => {
          const l = node(s)?.link;
          return !!(l && (l.pageId || l.url));
        },
      },
      { target: "preview", text: tr("Close the script editor and test it by clicking in Preview."), prepare: { closeScripts: true } },
    ],
    see: ["act-anchor", "act-external", "act-script"],
  },
  {
    id: "act-anchor",
    cat: "action",
    level: 2,
    q: tr("How do I scroll to a specific spot on the page?"),
    a: tr("Give the target element an ID attribute (e.g. access), then use \"Scroll to ［element］\" in the button's script."),
    keys: [tr("in-page link"), tr("anchor"), tr("Scroll"), "ID", tr("table of contents"), "#"],
    ctx: ["box", "text"],
    body: [
      { p: tr("IDs must be unique on the page and use letters and numbers. To link to a spot on another page, use \"/page-url#ID\".") },
      { rule: tr("A sticky header can cover the target heading. Add the header's height to the target's Custom CSS, like `scroll-margin-top: 80px;`.") },
    ],
    guide: [
      { target: "settings-id", text: tr("Select the target element and give it an ID attribute."), needs: "any", prepare: { right: "settings" } },
      { target: "settings-link", text: tr("Then select the button, open its scripts, and attach \"Scroll to ［element］\" under \"When clicked\"."), prepare: { right: "settings" } },
    ],
    see: ["act-link", "act-script"],
  },
  {
    id: "act-external",
    cat: "action",
    level: 2,
    q: tr("How do I open an external site in a new tab?"),
    a: tr("Enter the URL in \"Open ［page / URL］\" and check \"New tab\"."),
    keys: [tr("New tab"), tr("separate tab"), tr("external link"), "target", "blank"],
    body: [
      { rule: tr("Open only external sites, PDFs and the like in a new tab, where you want people to come back. Opening your own pages in new tabs piles up tabs and confuses navigation."), title: tr("When to use a new tab") },
    ],
    see: ["act-link"],
  },
  {
    id: "act-menu",
    cat: "action",
    level: 3,
    q: tr("How do I make a menu open and close (toggle visibility)?"),
    a: tr("Give the menu an ID attribute, hide it initially, and use \"［Toggle］［element］\" in the button's script."),
    keys: [tr("hamburger"), tr("Menu"), tr("open close"), tr("toggle"), tr("show hide"), tr("drawer"), tr("accordion")],
    ctx: ["box"],
    body: [
      { fig: "toggle-menu" },
      {
        list: [
          tr("Give the menu an ID attribute (e.g. menu)"),
          tr("Under \"Show on devices\", turn off the screen widths where it starts hidden"),
          tr("In the open button's script, attach \"［Toggle］［element］\" under \"When clicked\" and choose the menu"),
        ],
        ordered: true,
      },
      { note: tr("FAQ accordions work the same way. Check the behavior in [[act-preview|Preview]].") },
    ],
    guide: [
      { target: "settings-id", text: tr("Select the element to show and hide, and give it an ID attribute."), needs: "any", prepare: { right: "settings" } },
      { target: "style-visibility", text: tr("Under \"Show on devices\", turn off the screen widths where it starts hidden."), prepare: { right: "style" } },
      { target: "settings-link", text: tr("Select the open button, open its scripts and attach \"［Toggle］［element］\"."), prepare: { right: "settings" } },
    ],
    see: ["resp-hide", "act-script"],
  },
  {
    id: "act-preview",
    cat: "action",
    level: 1,
    q: tr("How do I try out links and interactions (Preview)?"),
    a: tr("Click Preview in the top bar. Selection outlines disappear and buttons and links work as they will when published."),
    keys: [tr("Preview"), tr("Confirm"), tr("try"), tr("test", "test_variant_1")],
    body: [
      { p: tr("Scripts and animations don't run in the Design view. Check them in Preview, then click Design to go back.") },
    ],
    guide: [{ target: "preview", text: tr("Click Preview. Click Design to go back."), done: (s) => s.mode === "preview" }],
    see: ["pub-publish"],
  },
  {
    id: "act-script",
    cat: "action",
    level: 3,
    q: tr("How do scripts work? (Triggers and actions)"),
    a: tr("A script is a chain of blocks: when (the trigger) and what to do (actions), run from top to bottom. All scripts on a page are edited together on one screen."),
    keys: [tr("Scripts"), tr("block"), tr("Triggers"), tr("Triggers"), tr("programming"), tr("condition"), tr("if")],
    body: [
      { fig: "script-blocks" },
      {
        table: {
          head: [tr("Triggers"), tr("When it plays")],
          rows: [
            [tr("When clicked"), tr("When the element is clicked")],
            [tr("When hover starts / ends"), tr("When the mouse enters or leaves")],
            [tr("When the value changes"), tr("When a field's or select's value changes")],
            [tr("When the page opens"), tr("When the page is shown (for \"This page\", also fetches data)")],
            [tr("When scrolled into view"), tr("When scrolled into view", "when_scrolled_into_view_variant_1")],
          ],
        },
      },
      { p: tr("Drag actions under a trigger to attach them; drag them back to the list to delete. Use \"If ［condition］\" to branch and \"Repeat\" to loop.") },
      { rule: tr("Instead of cramming actions into one script, split them by purpose. It's easier to fix later.") },
    ],
    guide: [
      { target: "page-scripts", text: tr("You can also open the page's script editor from Page settings with nothing selected."), prepare: { deselect: true, section: "page-scripts" } },
    ],
    see: ["act-link", "act-vars", "data-fetch"],
  },
  {
    id: "act-vars",
    cat: "action",
    level: 4,
    q: tr("How do I show entered text or data somewhere else (variables)?"),
    a: tr("Write {name} in text and it's replaced by that value. For fields, the ID attribute is the name; for data, use {dataName.field}."),
    keys: [tr("Variables"), "{", tr("insert"), tr("replace"), "ID", tr("template")],
    ctx: ["text", "field"],
    body: [
      {
        table: {
          head: [tr("Syntax"), tr("Replaced with")],
          rows: [
            ["{name}", tr("The value (or text) of the field with ID \"name\"")],
            ["{slug}", tr("On a [slug] page, that part of the URL")],
            [tr("{product.title}"), tr("The title of fetched data \"product\"")],
            ["{tab}", tr("The value of \"?tab=…\" in the page URL")],
          ],
        },
      },
      { p: tr("Typing \"{\" shows suggestions (⌘/ for the full list). The Design view shows {name} as is; Preview shows the actual value. To show a literal \"{\", write \"\\{\".") },
    ],
    see: ["data-fetch", "act-script"],
  },

  /* ================= データとリスト ================= */
  {
    id: "data-fetch",
    cat: "data",
    level: 4,
    q: tr("How do I fetch external data (JSON) and show it?"),
    a: tr("Add \"Fetch data from ［URL］ as ［name］\" to the page's script, then write {name.field} in text or images."),
    keys: ["JSON", "API", trc("help_search", "fetch data"), tr("external data"), "fetch", tr("data source")],
    ctx: ["none"],
    body: [
      { fig: "fetch-data" },
      { p: tr("If you name the fetched data \"news\", write `{news.title}` in text and `{news.image}` in an image URL.") },
      { p: tr("On the published site, data is fetched on the server before the page is served, so pages load fast and search engines see the content. Set how often it's fetched again under \"Hosting & data refresh\" in the Site tab.") },
      { note: tr("\"View data\" on the block shows the contents as a table. To refresh the editor's sample data, re-enter the URL.") },
    ],
    guide: [
      { target: "page-scripts", text: tr("With nothing selected, open \"Edit scripts\" under Scripts in Page settings."), prepare: { deselect: true, section: "page-scripts" }, done: (s) => !!s.scriptEditor },
      { target: "se-block-fetch", text: tr("Drag \"Fetch data from ［URL］ as ［name］\" into the large area on the right, and enter the URL and name.") },
    ],
    see: ["data-list", "act-vars", "data-detail"],
  },
  {
    id: "data-list",
    cat: "data",
    level: 4,
    q: tr("How do I display repeated items from a list?"),
    a: tr("Store the list from the fetched data in a variable with the script block \"Set variable ［］ to ［value］\", then choose it as the \"List to display\" in the List display element. The first card is the template."),
    keys: [tr("List", "list_variant_1"), tr("List"), tr("repeat"), tr("card"), tr("news list")],
    ctx: ["list", "box"],
    body: [
      { fig: "list-repeat" },
      {
        list: [
          tr("Fetch data in the page's script ([[data-fetch|fetching data]])"),
          tr("Name the list inside the data with \"Set variable ［］ to ［value / {data.path}］\" (e.g. store {news.items} as \"articles\")", "name_the_list_inside_the_data__variant_1"),
          tr("Make a template card (box) and turn it into a list with \"Turn into list display\" in the right-click menu"),
          tr("Choose \"articles\" under \"List to display\" in the List display settings"),
          tr("Write field names like {title} in the card's text"),
        ],
        ordered: true,
      },
      { note: tr("Limit the count with \"Items to show\". Sort and filter with the script's sort and filter blocks.") },
    ],
    guide: [
      { target: "settings-make", text: tr("Select the template box and click \"Turn into list display\"."), needs: "container", prepare: { right: "settings" } },
    ],
    see: ["data-fetch", "data-detail", "data-search", "img-fit"],
  },
  {
    id: "data-detail",
    cat: "data",
    level: 4,
    q: tr("How do I make a detail page for each item ([slug])?", "how_do_i_make_a_detail_page_fo_variant_1"),
    a: tr("Create one page with [slug] in its URL (e.g. news/[slug]) and a page is generated for each data item. Inside the page, {slug} gives you that part of the URL."),
    keys: [tr("detail page"), "slug", tr("dynamic page"), tr("item page"), "[slug]"],
    body: [
      { fig: "slug-pages" },
      {
        list: [
          tr("Create a page with the URL `news/[slug]`"),
          tr("In the page script, fetch data from a URL containing {slug}, or iterate the list, compare {ループ.値.id} with {slug}, store the matching value in a variable, and use \"Break loop\" to stop iterating."),
          tr("Set each card's link in the list display to something like `/news/{id}`"),
        ],
        ordered: true,
      },
      { note: tr("Choose which item to view in the editor with \"Showing data\" above the canvas. URLs with no matching data return 404.") },
    ],
    see: ["data-list", "page-404"],
  },
  {
    id: "data-search",
    cat: "data",
    level: 4,
    q: tr("How do I add search, filtering and sorting?"),
    a: tr("Set a box's meaning to \"Search form\" and add a field and a submit button. The entered value is added to the URL and can be used as {ID} in data URLs. On-screen filtering and sorting is built with script blocks."),
    keys: [tr("Search"), tr("filter"), tr("reorder"), tr("filter", "filter_variant_1"), tr("sort"), tr("Form")],
    body: [
      { p: tr("If the field's ID is \"q\", write `?q={q}` in the data URL. Submitting updates just the results without reloading the page.") },
      { p: tr("To filter an already-fetched list, attach \"Filter list ［］\" to \"When clicked\" or \"When the value changes\", and configure its conditions.") },
      { note: tr("New sites include a \"Products (demo)\" page with examples of search, lists and detail pages.") },
    ],
    see: ["data-list", "act-vars"],
  },
  {
    id: "data-storage",
    cat: "data",
    level: 4,
    q: tr("How do I save per-visitor info like favorites in the browser?"),
    a: tr("Save with \"Save ［value］ to storage key ［key］\" and read with \"Load storage key ［key］ into variable ［］\"."),
    keys: [tr("Storage"), tr("save"), "localStorage", tr("cookie"), tr("favorites")],
    body: [
      { p: tr("Saved values stay only in the visitor's browser and aren't visible to others. They aren't sent to the server; don't use this for personal information.") },
      { p: tr("Combine it with \"［Toggle］［value］ in variable ［］ (separated by ［.］)\" to add and remove favorites.") },
    ],
    see: ["act-vars", "act-script"],
  },

  /* ================= 部品の使い回し ================= */
  {
    id: "reuse-component",
    cat: "reuse",
    level: 2,
    q: tr("How do I reuse a header or footer on every page (components)?"),
    a: tr("Right-click the header box and choose \"Create component\". You can place it on other pages from the component list in the Add tab. **Edit it once and every page updates**."),
    keys: [tr("Components"), tr("shared"), tr("reuse"), tr("Header"), tr("Footer"), tr("element"), tr("instance")],
    ctx: ["box", "instance", "component"],
    body: [
      { fig: "component-sync" },
      { p: tr("Double-click a placed copy (instance) to edit the original (main component). Click Done at the top when finished.") },
      { rule: tr("Once you've built the same thing twice, consider a component. Copies mean hunting down every one when you need a change."), title: tr("Make it a component the second time") },
      { warn: tr("Deleting a component removes every copy placed on pages.") },
    ],
    guide: [
      { target: "settings-make", text: tr("Select the box to reuse and click \"Create component\"."), needs: "container", prepare: { right: "settings" } },
      { target: "add-components", text: tr("Your components are at the bottom of the Add tab. Click one to place it at the insert target."), prepare: { left: "add" } },
    ],
    see: ["reuse-detach", "d-consistency"],
  },
  {
    id: "reuse-detach",
    cat: "reuse",
    level: 3,
    q: tr("How do I make one copy of a component different?"),
    a: tr("Select that instance and click \"Detach instance\" in the right panel. It becomes a regular element you can edit independently."),
    keys: [tr("detach instance"), tr("unlink"), tr("detach"), tr("just one")],
    ctx: ["instance"],
    body: [
      { p: tr("Detached elements no longer change when the main component is edited.") },
      { note: tr("Small differences (like highlighting the current page's menu item) can sometimes be done with scripts or visibility instead of detaching.") },
    ],
    guide: [{ target: "settings-component", text: tr("Click \"Detach instance\".") }],
    see: ["reuse-component"],
  },

  /* ================= 公開と管理 ================= */
  {
    id: "pub-publish",
    cat: "publish",
    level: 1,
    q: tr("How do I publish my site?"),
    a: tr("Click Publish at the top right, review the pre-publish check, then click **Publish to test** or **Publish to live**."),
    keys: [tr("Publish"), tr("update"), tr("live"), tr("test"), tr("deploy"), tr("upload")],
    body: [
      { fig: "publish-flow" },
      { p: tr("Publishing to test commits to **a separate branch** of the same repository (preview by default), and the hosting service publishes it at a preview URL. See [[pub-preview|how test publishing works]].") },
      { p: tr("Your site updates within a few minutes. \"Unpublished changes\" at the bottom right tells you whether anything hasn't gone live yet. Draft pages aren't published.") },
      { rule: tr("For big changes, **publish to the test site and check it on a phone** before going live. If something goes wrong, you can return to an earlier version from [[pub-history|the publish history]]."), title: tr("Test before going live") },
    ],
    guide: [
      { target: "publish", text: tr("Click Publish.") },
      { target: "publish-status", text: tr("If you make changes after publishing, this shows \"Unpublished changes\".") },
    ],
    see: ["pub-checks", "pub-history", "pub-preview", "page-draft"],
  },
  {
    id: "pub-history",
    cat: "publish",
    level: 2,
    q: tr("I want to return the live site to an earlier version (rollback)"),
    a: tr("Open **Publish history & rollback** in the Publish dialog (or History in the \"…\" menu) and click **Restore site** on the version you want."),
    keys: [tr("rollback"), tr("restore", "restore_variant_1"), tr("publish history"), tr("earlier version"), tr("Undo")],
    body: [
      { fig: "rollback" },
      {
        table: {
          head: [tr("Button"), tr("What it restores")],
          rows: [
            [tr("Restore site"), tr("The published site. The chosen version is published again as a new version")],
            [tr("Restore edits"), tr("The editor's content, as it was when that version was published (⌘Z undoes it)")],
          ],
        },
      },
      { warn: tr("\"Restore site\" alone leaves the editor's content as it is, and the next publish overwrites the site with it. **To bring back the edits too, also use \"Restore edits\"**.") },
      { note: tr("It takes as long as a normal publish to go live (once the hosting service finishes building).") },
    ],
    guide: [
      { target: "publish", text: tr("Click Publish, then open \"Publish history & rollback\" at the bottom.") },
    ],
    see: ["pub-publish", "pub-restore"],
  },
  {
    id: "pub-checks",
    cat: "publish",
    level: 2,
    q: tr("How do I fix pre-publish check warnings?"),
    a: tr("**Red items (errors) must be fixed before you can publish**. Yellow items (warnings) don't block publishing, but fixing them helps visitors and search engines. \"Learn more\" on each item explains why and how."),
    keys: [tr("pre-publish check"), tr("error"), tr("warning"), tr("Checkbox")],
    body: [
      {
        table: {
          head: [tr("Common items"), tr("How to fix")],
          rows: [
            [tr("Duplicate URL"), tr("Change one page's URL ([[page-url|URL]])")],
            [tr("No alt text"), tr("Add a description in the image's Settings ([[img-alt|alt]])")],
            [tr("No Heading 1 (h1)"), tr("Make the page title a Heading 1 ([[text-heading|headings]])")],
            [tr("Fixed width wider than a phone screen"), tr("Use a % width or add a max width ([[d-units|units]])")],
            [tr("Text under 12px"), tr("Make it readable on phones ([[d-type-scale|type size]])")],
          ],
        },
      },
    ],
    see: ["pub-publish"],
  },
  {
    id: "pub-site",
    cat: "publish",
    level: 2,
    q: tr("How do I set the site name, favicon and share image?"),
    a: tr("Under Site settings in the Site tab of the left panel, set the site name, site URL, favicon (tab icon), home screen icon and default share image."),
    keys: [tr("Site name"), tr("The favicon"), "favicon", tr("Icon"), "OGP", tr("Site URL")],
    ctx: ["site"],
    body: [
      {
        table: {
          head: [tr("Item"), tr("Guideline")],
          rows: [
            [tr("The favicon"), tr("A square PNG or SVG (about 512×512px is safe)")],
            [tr("Home screen icon"), tr("A 180×180px PNG")],
            [tr("Share image"), "1200×630px"],
          ],
        },
      },
      { p: tr("The site URL is used to build things like share image addresses correctly. Enter your published domain (https://…).") },
    ],
    guide: [
      { target: "site-basics", text: tr("Fill in each item under Site settings."), prepare: { left: "site", section: "site-basics" } },
    ],
    see: ["page-seo", "pub-pwa"],
  },
  {
    id: "pub-backup",
    cat: "publish",
    level: 2,
    q: tr("How do I back up or restore an earlier state?"),
    a: tr("The server keeps **seven days of automatic backups**, which you can restore from History in the \"…\" menu. To keep a file, use Export under Backup in the Site tab."),
    keys: [tr("Backup"), tr("restore"), tr("export"), tr("import"), "JSON"],
    ctx: ["site"],
    body: [
      { p: tr("You can also load the `_tsumu/doc.json` saved to the repository when publishing.") },
      { warn: tr("Loading replaces everything you're editing now (⌘Z right afterwards brings it back). To be safe, Export the current state first.") },
      { rule: tr("Get in the habit of exporting a backup before big rebuilds and before publishing.") },
    ],
    guide: [
      { target: "site-backup", text: tr("Export saves to a file; Load restores it."), prepare: { left: "site", section: "site-backup" } },
    ],
    see: ["pub-restore", "start-save"],
  },
  {
    id: "pub-restore",
    cat: "publish",
    level: 2,
    q: tr("I deleted or broke something and want yesterday's version back"),
    a: tr("Open **History** in the \"…\" menu, go to \"Automatic backups of edits\" and click \"Restore this\" on the day you want. **⌘Z brings back the current content** afterwards."),
    keys: [tr("restore"), tr("Backup"), tr("previous day"), tr("lost"), tr("History")],
    body: [
      {
        table: {
          head: [tr("Where to restore from"), tr("What it holds")],
          rows: [
            [tr("Automatic backups of edits"), tr("The final content of each day you edited, kept automatically by the server (seven days, one per weekday)")],
            [tr("\"Restore edits\" in the publish history"), tr("The edits as of that publish")],
            [tr("Backup in the Site tab"), tr("A file you exported yourself")],
          ],
        },
      },
      { p: tr("For a recent mistake, try **⌘Z (undo)** first. It goes back up to 100 steps.") },
      { note: tr("The restored content is saved to the server and shows up for everyone editing at the same time.") },
    ],
    guide: [
      { target: "menu", text: tr("Open History from the \"…\" menu at the top right.") },
    ],
    see: ["start-undo", "pub-backup", "pub-history"],
  },
  {
    id: "pub-accounts",
    cat: "publish",
    level: 2,
    q: tr("How do I let other people sign in to the editor?"),
    a: tr("Add the email address of their Google account under **Settings** in the \"…\" menu at the top right."),
    keys: [tr("account"), tr("sign in"), tr("add user"), tr("permission"), tr("member")],
    body: [
      { p: tr("Added people can use it from their next sign-in. After you remove access, someone already signed in may still have access for a while.") },
      { note: tr("Accounts marked \"Fixed\" are set in the server configuration and can't be removed here.") },
    ],
    guide: [{ target: "menu", text: tr("Open Settings from the \"…\" menu at the top right and add the email address.") }],
    see: ["start-collab"],
  },
  {
    id: "pub-zip",
    cat: "publish",
    level: 4,
    q: tr("How do I export the site and run it myself (zip)?"),
    a: tr("Use **Export as zip** in the \"…\" menu at the top right to export a Next.js project. Unzip it and run `npm install && npm run dev`."),
    keys: ["zip", tr("export", "export_variant_1"), tr("export"), "Next.js", tr("Download")],
    body: [
      { p: tr("Sites made with this editor are regular Next.js projects. You can edit and publish the exported files without the editor.") },
    ],
    guide: [{ target: "menu", text: tr("Export with \"Export as zip\" in the \"…\" menu at the top right.") }],
  },
  {
    id: "pub-preview",
    cat: "publish",
    level: 4,
    q: tr("How does test publishing work?"),
    a: tr("Test publishing commits to **a separate branch of the same repository** (preview by default). Vercel, Cloudflare and others automatically publish non-production branches at a **preview URL**."),
    keys: [tr("test"), tr("Preview"), tr("branch"), tr("staging"), "noindex"],
    body: [
      { fig: "branch-publish" },
      { p: tr("The test site is exported with robots.txt, noindex and crawler blocking layered together so search engines skip it. It lives on a different branch, so test content never reaches the live site.") },
      {
        table: {
          head: [tr("hosting"), tr("Preview setup")],
          rows: [
            ["Vercel", tr("Nothing to set up (every branch gets a preview URL)")],
            ["Cloudflare Workers Builds", tr("Set \"Non-production branch deploy command\" to `npx opennextjs-cloudflare upload`")],
            ["Netlify", tr("Enable \"Branch deploys\"")],
          ],
        },
      },
      { note: tr("The branch name and preview URL are set per site in Site settings on the home screen.") },
    ],
    see: ["pub-publish", "pub-hosting"],
  },
  {
    id: "pub-hosting",
    cat: "publish",
    level: 4,
    q: tr("Can I host somewhere other than Cloudflare? (data refresh interval)"),
    a: tr("The export is **a regular Next.js project**, so it runs on Vercel, Netlify, Node.js or Cloudflare Workers. When hosting on Cloudflare, set the hosting to **Cloudflare Workers** under \"Hosting & data refresh\" in the Site tab."),
    keys: [tr("hosting"), "Vercel", "Cloudflare", "Netlify", "ISR", tr("refresh interval"), tr("server")],
    body: [
      {
        table: {
          head: [tr("Hosting"), tr("Pages that use external JSON")],
          rows: [
            [tr("Standard (Vercel etc.)"), tr("Pages are prebuilt and rebuilt in the background at the refresh interval (ISR). Fast to load")],
            ["Cloudflare Workers", tr("Pages are rendered on every request, and fetched JSON is cached at Cloudflare for the refresh interval")],
          ],
        },
      },
      { warn: tr("If you publish to Cloudflare Workers with \"Standard\", prebuilt pages are **never rebuilt** (the cache that ISR needs isn't set up there).") },
      { note: tr("With a refresh interval of 0, every host fetches the latest data on every request.") },
    ],
    guide: [
      { target: "site-hosting", text: tr("Choose it under \"Hosting\" in \"Hosting & data refresh\"."), prepare: { left: "site", section: "site-hosting" } },
    ],
    see: ["data-fetch", "pub-preview", "pub-zip"],
  },
  {
    id: "pub-pwa",
    cat: "publish",
    level: 3,
    q: tr("How do I add a loading screen or make the site installable on phones?"),
    a: tr("Turn on \"Show a loading screen\" or \"Publish as a PWA\" under Site settings in the Site tab."),
    keys: [tr("loading"), tr("splash screen"), "PWA", tr("home screen"), tr("app")],
    ctx: ["site"],
    body: [
      { p: tr("You build the loading screen on the canvas like a page. Turn on \"Show only once per tab\" so it doesn't appear on every page change. For the PWA icon, a 512×512px square PNG is recommended.") },
      { rule: tr("Keep loading screens short (0.5–1 second). The longer people wait, the more of them leave.") },
    ],
    guide: [
      { target: "site-loading", text: tr("Turn on \"Show a loading screen\" and build it with \"Edit loading screen\"."), prepare: { left: "site", section: "site-basics" } },
      { target: "site-pwa", text: tr("Turn on \"Publish as a PWA\" and set the app name and icon."), prepare: { left: "site", section: "site-basics" } },
    ],
    see: ["pub-site"],
  },

  /* ================= Webデザインの基本 ================= */
  {
    id: "d-units",
    cat: "design",
    level: 2,
    q: tr("When should I use px, %, rem or vw?"),
    a: tr("Use % for widths that should flex with the parent, px or rem for text size, vw/vh for sizes tied to the screen, and px for fixed things (icons, border widths)."),
    keys: [tr("unit"), "px", "%", tr("percent"), "rem", "em", "vw", "vh", tr("Fixed"), tr("fluid")],
    ctx: ["box", "image", "mobile"],
    body: [
      { fig: "units-compare", caption: tr("A fixed px width overflows phones (about 375px wide). Match the parent with % and cap it with a max width.") },
      {
        table: {
          head: [tr("unit"), tr("Relative to"), tr("Good for")],
          rows: [
            ["px", tr("A fixed size"), tr("Icons, border widths, corner radius, spacing, max width")],
            ["%", tr("The parent's size"), tr("Widths that should flex (100% fills the parent)")],
            ["rem", tr("The site's base text (16px)"), tr("Text size (1rem = 16px)")],
            ["em", tr("The element's own text size"), tr("Letter spacing (0.05em), spacing that scales with text")],
            ["vw / vh", tr("The screen width / height"), tr("Full-screen hero sections (100vh)")],
            [tr("No unit"), tr("The element's own text size"), tr("Line height (1.8)")],
          ],
        },
      },
      { rule: tr("A % height has no effect unless the parent's height is set. Usually leave height empty (fits content) and use Min height if needed."), title: tr("% heights often don't work") },
      { note: tr("Click the unit to switch units; the number is converted so the size stays the same.") },
    ],
    see: ["layout-width", "layout-max-width", "layout-height", "d-no-fixed-height"],
  },
  {
    id: "d-spacing",
    cat: "design",
    level: 2,
    q: tr("How do I choose spacing sizes?"),
    a: tr("Pick from **a fixed scale** like 4, 8, 16, 24, 32, 48, 64px (multiples of 8). Keep related things close and separate groups more widely."),
    keys: [tr("Spacing"), "8px", tr("Grid"), tr("spacing", "spacing_variant_1"), tr("Gap"), tr("align")],
    ctx: ["box"],
    body: [
      { fig: "spacing-scale" },
      { rule: tr("Choose spacing from a fixed scale (multiples of 8). Keep closely related things (a heading and its text) near each other and push separate groups apart. Spacing alone shows what belongs together."), title: tr("Use a scale; keep related things close") },
      {
        table: {
          head: [tr("Where"), tr("Guideline")],
          rows: [
            [tr("Inside buttons"), tr("12px top/bottom, 24px left/right")],
            [tr("Inside cards"), "16〜24px"],
            [tr("Between heading and text"), "8〜16px"],
            [tr("Between sections"), tr("80–120px on desktop / 48–64px on phones")],
            [tr("Screen edge to content"), tr("At least 16–20px, even on phones")],
          ],
        },
      },
    ],
    see: ["layout-gap", "layout-spacing", "d-hierarchy"],
  },
  {
    id: "d-type-scale",
    cat: "design",
    level: 2,
    q: tr("What text sizes should I use?"),
    a: tr("**Base body text on 16px** (phones too), and make each heading level 1.25–1.5× larger. Keep even small text at 12px or more."),
    keys: [tr("font size"), tr("text size"), "16px", tr("heading size"), tr("size contrast")],
    ctx: ["text", "mobile"],
    body: [
      { fig: "type-scale", caption: tr("Example sizes on desktop. On phones, shrink only the headings.") },
      {
        table: {
          head: [tr("Type"), tr("Desktop"), tr("Phone")],
          rows: [
            [tr("Heading 1 (page title)"), "40〜56px", "28〜36px"],
            [tr("Heading 2 (section)"), "28〜36px", "22〜26px"],
            [tr("Heading 3"), "20〜24px", "18〜20px"],
            [tr("Body"), "16px", "16px"],
            [tr("Notes"), "12〜14px", "12〜14px"],
          ],
        },
      },
      { rule: tr("A big size difference between headings and body feels bold; a small one feels calm. Event and promotional pages suit a bigger difference; guides and terms, a smaller one."), title: tr("Size contrast sets the mood") },
      { note: tr("If text in form fields is under 16px on phones, iPhones zoom in every time you type.") },
    ],
    see: ["text-size", "resp-font", "text-heading"],
  },
  {
    id: "d-line-length",
    cat: "design",
    level: 2,
    q: tr("How do I make long text easy to read?"),
    a: tr("Keep lines to a comfortable length (about 640–760px wide, roughly 60–75 characters in English) with a line height of 1.5–1.9. Leave about a line's worth of space between paragraphs."),
    keys: [tr("readability"), tr("line length"), tr("characters"), tr("Line height"), tr("paragraph"), trc("help_search", "text")],
    ctx: ["text"],
    body: [
      { fig: "line-length" },
      { rule: tr("With text spanning the whole screen, it's hard for the eye to get from the end of one line to the start of the next, and people skip lines. Give text boxes a max width."), title: tr("Keep lines short") },
      { rule: tr("Break long text into paragraphs every 3–4 lines and add headings. On phones it runs many screens long, so put the key points first."), title: tr("Key points first, short paragraphs") },
    ],
    see: ["layout-max-width", "text-spacing"],
  },
  {
    id: "d-color",
    cat: "design",
    level: 2,
    q: tr("How do I choose and combine colors?"),
    a: tr("**Build around three colors** in roughly a 70% base, 25% main, 5% accent ratio. Keep strong contrast between text and background."),
    keys: [tr("color scheme"), tr("color combination"), tr("Contrast"), tr("color"), "70:25:5"],
    ctx: ["box", "text"],
    body: [
      { fig: "color-ratio" },
      { rule: tr("Low contrast between text and background is unreadable on a phone in sunlight or for people who see color differently. Dark gray to black text on a light background is the safest choice for body text."), title: tr("Ensure contrast") },
      { rule: tr("Don't convey meaning with color alone (e.g. don't mark a deadline just with red text; write \"Deadline\")."), title: tr("Don't rely on color alone") },
      { note: tr("Stick with the colors you choose. Picking from \"Recent colors\" prevents slightly different shades creeping in.") },
    ],
    see: ["look-color", "d-accessibility"],
  },
  {
    id: "d-fonts",
    cat: "design",
    level: 2,
    q: tr("How do I choose fonts?"),
    a: tr("**Use two at most**. The usual approach is a readable sans-serif for body text and a heading font that sets the mood. Varying weight adds contrast without more fonts."),
    keys: [tr("Font"), tr("typeface"), tr("sans-serif"), tr("serif"), tr("Weight")],
    ctx: ["text", "body"],
    body: [
      {
        table: {
          head: [tr("Type"), tr("Feel"), tr("Good for", "good_for_variant_1")],
          rows: [
            [tr("Sans-serif"), tr("Readable, friendly"), tr("Body text, guides, buttons")],
            [tr("Serif"), tr("Elegant, calm"), tr("Headings, formal notices")],
            [tr("Handwritten / display"), tr("Lively, distinctive"), tr("Large headings only (not body text)")],
          ],
        },
      },
      { rule: tr("Stick mainly to Regular 400 and Bold 700. Thin weights (300 or less) look faint and are hard to read at small sizes or on phones.") },
    ],
    see: ["text-font", "d-performance"],
  },
  {
    id: "d-hierarchy",
    cat: "design",
    level: 1,
    q: tr("How do I make important things stand out? (Visual hierarchy)"),
    a: tr("**Pick the one thing that matters most** and make it big, put it high and give it room. If everything stands out, nothing does."),
    keys: [tr("stand out"), tr("emphasis"), tr("priority"), tr("Layout"), tr("communicate")],
    ctx: ["none", "box"],
    body: [
      { fig: "hierarchy" },
      { rule: tr("Eyes move from top left to bottom right, or top to bottom on phones. Put the key facts (date, place, how to sign up, etc.) first and details after."), title: tr("Key facts first") },
      { rule: tr("To separate groups, wider spacing or a different background reads more cleanly than drawing lines."), title: tr("Separate with space") },
    ],
    see: ["d-spacing", "d-type-scale", "d-color"],
  },
  {
    id: "d-mobile",
    cat: "design",
    level: 2,
    q: tr("How do I make it easy to use on phones?"),
    a: tr("Make tap targets finger-sized (**at least 44px tall**), stack rows vertically, and leave at least 16px between the screen edge and content."),
    keys: [tr("Phone"), tr("tap"), tr("easy to tap"), "44px", tr("mobile first"), tr("thumb")],
    ctx: ["mobile"],
    body: [
      { fig: "tap-target", caption: tr("The dotted circle is a fingertip (about 44px). Small buttons lead to mis-taps.") },
      { rule: tr("Stack what sits side by side on desktop, and keep text at 16px. Leave at least 16px between the screen edge and content."), title: tr("Stack vertically") },
      { rule: tr("Phones have no hover. Make clickable things look clickable at all times (button shape, color, underline)."), title: tr("Don't rely on hover") },
    ],
    see: ["resp-basics", "resp-stack", "layout-spacing"],
  },
  {
    id: "d-no-fixed-height",
    cat: "design",
    level: 3,
    q: tr("Why does text overflow or overlap?"),
    a: tr("Usually it's because the box holding the text **has a fixed height or width**. Leave height empty (fits content) and use Min height if needed."),
    keys: [tr("overflow"), tr("overlap", "overlap_variant_1"), tr("broken layout"), tr("fixed height"), tr("layout issues")],
    ctx: ["box", "text", "mobile"],
    body: [
      { fig: "fixed-height", caption: tr("On phones, text wraps onto more lines. It spills out of fixed-height boxes and overlaps the elements below.") },
      {
        list: [
          tr("If Height has a number, clear it (move it to Min height)"),
          tr("If the width is fixed in px, use % or \"Fill remaining space\""),
          tr("If Position is Custom, see whether it can go back to Auto"),
          tr("In the phone view, reduce oversized text and spacing"),
        ],
        ordered: true,
      },
    ],
    see: ["d-units", "layout-height", "d-flow-not-absolute"],
  },
  {
    id: "d-flow-not-absolute",
    cat: "design",
    level: 3,
    q: tr("What's the most robust way to position things?"),
    a: tr("Arrange elements by order and container (box), and **position them with the parent's Flow, Alignment and Gap**. Use Custom (X/Y positioning) only for overlaps."),
    keys: [tr("Alignment"), tr("robust"), tr("Layout"), "absolute", tr("free position"), tr("misaligned")],
    ctx: ["box"],
    body: [
      { fig: "flow-vs-absolute", caption: tr("Screen width and text length vary by viewer. Things placed by coordinates overlap as soon as conditions change.") },
      {
        list: [
          tr("Put each group in a box (header, content, cards…)"),
          tr("Use the parent's Flow to choose vertical or horizontal"),
          tr("Use the parent's Alignment for placement and Gap for spacing"),
          tr("Widths in % or \"Fill remaining space\", capped with Max width"),
        ],
        ordered: true,
      },
    ],
    see: ["layout-row", "layout-position", "d-no-fixed-height"],
  },
  {
    id: "d-accessibility",
    cat: "design",
    level: 3,
    q: tr("How do I make pages usable for everyone? (Accessibility)"),
    a: tr("Alt text on images, headings in order, contrast between text and background, descriptive link text and easy-to-tap sizes. These five make a big difference."),
    keys: [tr("accessibility"), tr("barrier-free"), tr("screen reader"), "alt", tr("Contrast"), tr("color vision")],
    body: [
      {
        list: [
          tr("**Images** … write [[img-alt|alt text]] for images that convey something"),
          tr("**Headings** … start at Heading 1 and don't skip levels ([[text-heading|headings]])"),
          tr("**Color** … keep text/background contrast and don't rely on color alone ([[d-color|color]])"),
          tr("**Links** … say where it goes instead of \"click here\" ([[act-link|links]])"),
          tr("**Interaction** … don't hide information behind hover, and make tap targets large ([[d-mobile|phones]])"),
        ],
      },
      { rule: tr("Difficulty seeing or hearing isn't only about disability. A phone in sunlight, using one hand or a noisy place can affect anyone.") },
    ],
    see: ["img-alt", "d-color", "text-heading"],
  },
  {
    id: "d-images",
    cat: "design",
    level: 3,
    q: tr("How do I choose image formats and sizes?"),
    a: tr("JPEG or WebP for photos, SVG or PNG for logos and illustrations. Aim for about twice the displayed width (2000px max) and **under 500KB per image**."),
    keys: [tr("image format"), "JPEG", "PNG", "SVG", "WebP", tr("file size"), tr("heavy"), tr("compress"), tr("blurry")],
    ctx: ["image"],
    body: [
      {
        table: {
          head: [tr("Format"), tr("Good for"), tr("Watch out")],
          rows: [
            ["JPEG / WebP", tr("photo"), tr("No transparency (WebP supports it)")],
            ["PNG", tr("Images with transparency, screenshots"), tr("Gets heavy for photos")],
            ["SVG", tr("Logos, icons, diagrams"), tr("Stays sharp at any size")],
          ],
        },
      },
      { rule: tr("Images about twice the displayed size stay sharp on high-resolution screens. Going bigger doesn't look better; it just adds weight."), title: tr("Up to 2× the displayed size") },
      { p: tr("For large images visible right when the page opens, turn on \"Load first\" in the image's Settings to show them sooner.") },
    ],
    see: ["img-add", "d-performance"],
  },
  {
    id: "d-performance",
    cat: "design",
    level: 4,
    q: tr("How do I make pages load faster?"),
    a: tr("Lighter images, fewer fonts and less motion and blur make the biggest difference."),
    keys: [tr("speed"), tr("lightweight"), tr("heavy"), tr("load time"), tr("performance"), tr("import")],
    body: [
      {
        list: [
          tr("**Images** … use the right format and size before uploading ([[d-images|choosing images]])"),
          tr("**Fonts** … at most two Google Fonts; fonts with large character sets (like Japanese) are especially heavy"),
          tr("**Effects** … go easy on shadows, blur and animation"),
          tr("**Embeds** … keep YouTube, maps and other embeds to a few per page"),
          tr("**Data** … don't make the data refresh interval too short (0 fetches on every visit)"),
        ],
      },
      { rule: tr("More than half of visitors are said to leave if a page takes over 3 seconds to load. Check on a mobile connection especially.") },
    ],
    see: ["d-images", "d-fonts"],
  },
  {
    id: "d-seo",
    cat: "design",
    level: 3,
    q: tr("What are the basics of being found in search?"),
    a: tr("Give each page a descriptive title and description, use headings properly, write alt text and keep pages fast. **These basics matter more than any trick**."),
    keys: ["SEO", tr("Search"), "Google", tr("ranking"), tr("search engine")],
    body: [
      {
        list: [
          tr("Write a title and description for each page ([[page-seo|Search & sharing]])"),
          tr("One Heading 1 per page, describing the content ([[text-heading|headings]])"),
          tr("Short English-word URLs that never change once set ([[page-url|URL]])"),
          tr("Write alt text, and use real text instead of text in images"),
          tr("Make pages easy to read on phones and fast to load"),
        ],
      },
      { rule: tr("Search engines look at whether a page helps visitors. Clearly stating what people are looking for (when, where, what) is the best strategy.") },
    ],
    see: ["page-seo", "d-performance"],
  },
  {
    id: "d-consistency",
    cat: "design",
    level: 2,
    q: tr("How do I make the whole site feel consistent?"),
    a: tr("Settle on a few choices for colors, fonts, text sizes, spacing, corner radius and shadows, and reuse them across the site."),
    keys: [tr("consistency"), tr("unify"), tr("design rules"), tr("cohesion"), tr("consistent")],
    body: [
      { rule: tr("Following rules like \"buttons have 8px corners, 44px height and the accent color\" on every page gives a professional, cohesive look."), title: tr("Set rules and stick to them") },
      { p: tr("Make repeated parts [[reuse-component|components]] and set base text (font, color, size) on the page's \"body\". Then fixes happen in one place.") },
    ],
    see: ["reuse-component", "d-spacing", "d-color"],
  },
];
