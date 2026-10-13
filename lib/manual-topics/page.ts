import type { Topic } from "../manual";
import { tr } from "../i18n";
import { pageCount } from "./helpers";

export const pageTopics: Topic[] = [  /* ================= ページ ================= */
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
      { note: tr("The list order doesn't affect URLs on your live site. Arrange it in whatever order makes pages easiest to find.") },
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
          tr("Double-click to rename. Deleting a folder keeps its pages."),
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
            [tr("Title"), tr("Around 50–60 characters. Put words that describe the page first.")],
            [tr("Description"), tr("About 120–160 characters. The summary shown under the search result.")],
            [tr("Share image (OGP)"), tr("1200×630px. The large image shown when the page is shared on social media.")],
          ],
        },
      },
      { rule: tr("Give each page its own title. If every page has the same title, people can't tell them apart in search results."), title: tr("A different title for each page") },
      { note: tr("Tabs and search results show \"Title | Site name\". With \"Hide from search results\" on, the page asks search engines to omit it from results. Anyone can still open the published page.") },
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
      { warn: tr("301 redirects ignore letter case and also match a trailing /. Changing only the query (after ?) or # still leads back to the same redirect, so choose a different path. For sources that contain [slug], make sure the destination does not lead back to the same rule either.") },
      { p: tr("\"Show an external site\" displays another site's content while keeping your address (a reverse proxy).") },
      { p: tr("Under the home page (/), this site's pages and files take priority, and only paths with no match are forwarded to the external site.") },
      { p: tr("If the destination URL contains ? or #, only paths that match this page's URL are forwarded.") },
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
      { p: tr("You can load an HTML file, or a ZIP that bundles images, CSS and JavaScript. Files in the ZIP are added to Assets automatically, and the references in the HTML are updated.") },
      { warn: tr("HTML pages don't include the site-wide header, meta information or custom code, and can't be edited on the canvas.") },
      { p: tr("To add HTML to just part of a page, use the Code element from Add.") },
    ],
    guide: [
      { target: "page-code", text: tr("Choose \"HTML\" under \"Page type\", then paste code or load a file or ZIP."), prepare: { deselect: true, section: "page-code" } },
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


];
