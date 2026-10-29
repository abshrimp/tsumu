import type { Topic } from "../manual";
import { tr } from "../i18n";

export const publishTopics: Topic[] = [  /* ================= 公開と管理 ================= */
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
    keys: [tr("rollback"), tr("restore (help search)"), tr("publish history"), tr("earlier version"), tr("Undo")],
    body: [
      { fig: "rollback" },
      {
        table: {
          head: [tr("Button"), tr("What it restores")],
          rows: [
            [tr("Restore site"), tr("The published site. The chosen version is published again as a new version.")],
            [tr("Restore edits"), tr("The editor's content, as it was when that version was published (⌘Z undoes it).")],
          ],
        },
      },
      { warn: tr("\"Restore site\" alone leaves the editor's content as it is, and the next publish overwrites the site with it. **To bring back the edits too, also use \"Restore edits\"**.") },
      { note: tr("It takes as long as a normal publish to go live (when the hosting service finishes the build).") },
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
    a: tr("Open **History & rollback** from the \"…\" menu to export a complete ZIP backup including assets, or load a backup file. The server also keeps seven daily snapshots of the editing data."),
    keys: [tr("Backup"), tr("restore"), tr("export"), tr("import"), "ZIP", "JSON"],
    ctx: ["site"],
    body: [
      { p: tr("A backup ZIP includes all site assets, even unused ones. You can also load a standalone `doc.json` or one from a published version, though a JSON file does not bundle server-stored asset files.") },
      { warn: tr("Loading replaces everything you're editing now (⌘Z right afterwards brings it back). To be safe, Export the current state first.") },
      { rule: tr("Get in the habit of exporting a backup before big rebuilds and before publishing.") },
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
      { p: tr("People you add can use the editor from their next sign-in. After you remove access, someone who is already signed in may keep access for a while.") },
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
    a: tr("Use **Export as zip** in the \"…\" menu at the top right to export a Next.js project. Extract it and run `npm install && npm run dev`."),
    keys: ["zip", tr("export (help search)"), tr("export"), "Next.js", tr("Download")],
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
            [tr("Standard (Vercel etc.)"), tr("Pages are prebuilt and rebuilt in the background at the refresh interval (ISR). Fast to load.")],
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
      { p: tr("You build the loading screen on the canvas, like a page. Turn on \"Show only once per tab\" so that it doesn't appear on every page change. For the PWA icon, a 512×512px square PNG is recommended.") },
      { rule: tr("Keep loading screens short (0.5–1 second). The longer people wait, the more of them leave.") },
    ],
    guide: [
      { target: "site-loading", text: tr("Turn on \"Show a loading screen\" and build it with \"Edit loading screen\"."), prepare: { left: "site", section: "site-basics" } },
      { target: "site-pwa", text: tr("Turn on \"Publish as a PWA\" and set the app name and icon."), prepare: { left: "site", section: "site-basics" } },
    ],
    see: ["pub-site"],
  },


];
