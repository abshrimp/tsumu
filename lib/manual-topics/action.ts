import type { Topic } from "../manual";
import { tr, trc } from "../i18n";
import { node, hasScript } from "./helpers";

export const actionTopics: Topic[] = [  /* ================= リンクと動き ================= */
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
      { rule: tr("Link text should say where the link goes, like \"Go to the sign-up form\", not \"Click here\". Screen readers sometimes read links on their own."), title: tr("Link text") },
    ],
    guide: [
      { target: "canvas", text: tr("Select the button (element) to link."), needs: "any" },
      { target: "right-tab-settings", text: tr("Open Settings in the right panel."), done: (s) => s.rightTab === "settings" },
      { target: "settings-link", text: tr("Click \"Edit page scripts\"."), prepare: { right: "settings" }, done: (s) => !!s.scriptEditor },
      {
        target: "se-workspace",
        text: tr("Choose \"When clicked\" as the trigger."),
        hint: tr("If another script is open, press \"New script\" at the top left first."),
        done: (s) => !!node(s)?.link || !!node(s)?.scripts?.some((sc) => sc.trigger === "click"),
      },
      {
        target: "se-add",
        text: tr("Press \"Add the first action\" and choose \"Open a page or link\"."),
        done: (s) => hasScript(s, ["open-page", "open-url"]),
      },
      {
        target: "se-workspace",
        text: tr("Choose the page to open in the action you added. For external sites, switch to URL and enter the address."),
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
      { rule: tr("Open only external sites, PDFs and the like in a new tab, so that people come back to your page. Opening your own pages in new tabs piles up tabs and makes it hard to find the way back."), title: tr("When to use a new tab") },
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
      { target: "settings-link", text: tr("Select the button that opens it, open its scripts and attach \"［Toggle］［element］\"."), prepare: { right: "settings" } },
    ],
    see: ["resp-hide", "act-script"],
  },
  {
    id: "act-preview",
    cat: "action",
    level: 1,
    q: tr("How do I try out links and interactions (Preview)?"),
    a: tr("Click Preview in the top bar. Selection outlines disappear, and buttons and links work as they will when published."),
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
    a: tr("A script is a list of actions that run from top to bottom: when (the trigger) and what to do (actions). All scripts on a page are edited together on one screen."),
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
      { rule: tr("Instead of cramming actions into one script, split them by purpose. That makes them easier to fix later.") },
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
    a: tr("Write {name} in text, and it is replaced with that value. For fields, the ID attribute is the name; for data, use {dataName.field}."),
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


];
