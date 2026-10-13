import type { Topic } from "../manual";
import { tr, trc } from "../i18n";

export const dataTopics: Topic[] = [  /* ================= データとリスト ================= */
  {
    id: "data-fetch",
    cat: "data",
    level: 4,
    q: tr("How do I fetch external data (JSON) and show it?"),
    a: tr("Add \"Fetch data from ［URL］ as ［name］\" to any script, then write {name.field} in text or images."),
    keys: ["JSON", "API", trc("help_search", "fetch data"), tr("external data"), "fetch", tr("data source")],
    ctx: ["none"],
    body: [
      { fig: "fetch-data" },
      { p: tr("If you name the fetched data \"news\", write `{news.title}` in text and `{news.image}` in an image URL.") },
      { p: tr("A fetch directly under \"When the page opens\" runs on the server before displaying the page. A fetch inside a click, condition, repeat, or other trigger runs when the script reaches it, and later actions wait for the response.") },
      { note: tr("For browser-triggered requests, the remote API must allow CORS. Use public endpoints: the browser does not send credentials, and fetch failures produce null.") },
      { note: tr("\"View data\" on the block shows the contents as a table. To refresh the editor's sample data, re-enter the URL.") },
    ],
    guide: [
      { target: "page-scripts", text: tr("With nothing selected, open \"Edit scripts\" under Scripts in Page settings."), prepare: { deselect: true, section: "page-scripts" }, done: (s) => !!s.scriptEditor },
      { target: "se-workspace", text: tr("Open \"When the page opens\" (create it with \"New script\" if it is missing), press \"Add an action\", choose \"Fetch data from the internet\", and enter the address and a name.") },
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
          tr("In the page script, fetch data from a URL that contains {slug}, or loop over the list, compare {ループ.値.id} with {slug}, store the matching value in a variable, and use \"Break loop\" to stop the loop."),
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
    a: tr("Set a box's meaning to \"Search form\" and add a field and a submit button. The entered value is added to the URL and can be used as {ID} in data URLs. Filtering and sorting on the screen are built with script blocks."),
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
      { p: tr("Saved values stay only in the visitor's browser and aren't visible to others. They aren't sent to the server. Don't use this for personal information.") },
      { p: tr("Combine it with \"［Toggle］［value］ in variable ［］ (separated by ［.］)\" to add and remove favorites.") },
    ],
    see: ["act-vars", "act-script"],
  },


];
