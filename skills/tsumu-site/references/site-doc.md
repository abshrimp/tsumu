# Tsumu editable `doc.json` format

This file documents the JSON that Tsumu's editor actually loads. It is not an HTML snapshot, a Next.js export, or an arbitrary page-design JSON. The authoritative types are `lib/types.ts`, with construction examples in `lib/presets.ts`. The provided [minimal-site.json](minimal-site.json) is a self-contained, visually editable working example.

## Canonical `doc.json`

All editable documents use the single canonical `SiteDoc` JSON format (`schemaVersion: 1`). Imports accept plain or minified UTF-8 `SiteDoc` JSON directly and reject documents that do not match this schema. Do not wrap `doc.json` in a custom envelope, shorten property names, discard values, or generate numeric node keys: the importer expects the canonical `SiteDoc` structure. ZIP exports store plain minified `_tsumu/doc.json` and apply ZIP-level DEFLATE.

## Minimum document

A complete minimal site needs these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Document schema version; any other value is rejected |
| `siteName` | nonempty string | Site name |
| `pages` | object keyed by page ID | Page definitions |
| `pageOrder` | nonempty array of page IDs | Order of the pages shown in the editor |
| `nodes` | object keyed by node ID | Editable elements shared by pages/components |
| `assets` | object keyed by asset ID | Binary asset metadata, or `{}` |

Example structure:

```json
{
  "schemaVersion": 1,
  "siteName": "My Site",
  "lang": "ja",
  "pages": {
    "page_home": {
      "id": "page_home",
      "name": "Home",
      "slug": "",
      "title": "Home",
      "description": "",
      "children": ["node_heading"]
    }
  },
  "pageOrder": ["page_home"],
  "nodes": {
    "node_heading": {
      "id": "node_heading",
      "type": "box",
      "name": "Heading",
      "semantic": "auto",
      "text": { "content": "Hello", "heading": 1 },
      "link": null,
      "children": [],
      "styles": { "base": { "default": { "fontSize": "48px" } } }
    }
  },
  "assets": {}
}
```

The example above and `minimal-site.json` use the same structures accepted by Tsumu's current importer. Use stable, unique IDs; their exact spelling is unimportant as long as references are consistent. Do not use `__proto__`, `constructor`, or `prototype` as object keys. The reserved element ID `__body__` is for Tsumu's body selection, not an ordinary node.

## Pages (`SiteDoc.pages`)

Every page object requires `id`, `name`, `slug`, `title`, `description`, and `children`. The key in `pages` must equal `page.id`, and all `pageOrder` entries must resolve to a page.

- `slug: ""` means the home page; `"about"` means `/about`, `"blog/post"` means `/blog/post`.
- `children` is an ordered array of **node IDs**, not embedded node objects.
- Optional metadata: `query` (query string without `?`), `lang`, `bodyStyles`, `bodyDarkStyles` (`prefers-color-scheme: dark` overrides for `body`), `htmlBackground`, `darkHtmlBackground`, `noindex`, `unpublished`, `folderId`, `ogImage`, `customTopHtml`, `customEndHtml`.
- `pageScripts` holds scripts targeting the page (such as `trigger: "load"` and variable-watching `trigger: "change"` scripts). Detached scripts exist only in editor memory and are never saved in `SiteDoc`.
- Do not use `rawHtml` for a visual page: setting `rawHtml` turns it into a raw HTML page, not an element-based editable page.
- `redirectTo` and `rewriteTo` produce redirect/proxy pages, not visual content.

## Nodes (`SiteDoc.nodes`)

Every node object requires:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Must match its key in `nodes` |
| `type` | enum | `box`, `image`, `divider`, `code`, `instance`, `icon`, `field`, `media`, `embed`, `list` |
| `name` | string | Label in the editor |
| `semantic` | enum | `auto`, `form`, `button`, `div`, `section`, `header`, `footer`, `nav`, `main`, `article`, `span`, `custom` |
| `text` | object or null | `{ "content": "...", "heading": 0 }` or `null` |
| `link` | object or null | Navigation target or `null` |
| `children` | array of node IDs | Ordered nested elements |
| `styles` | object | Responsive, state-specific inline styles |

**Text is not a separate node type.** A text paragraph or heading is a `type: "box"` node with `text: { content, heading }`; `heading: 0` means normal text and 1–6 means h1–h6. A container uses `text: null`.

Other type-specific fields:

- `image`: `{ "src": "", "alt": "...", "width": 800, "height": 500, "assetId": "asset_id" }` for `type: "image"`. Omit `assetId` if using an external `src` URL.
- `code`: `{ "html": "<p>...</p>" }` for a raw HTML element; use regular nodes where visual editability is desired.
- `field`: `{ "kind": "input", "inputType": "text", "placeholder": "..." }` for form controls. Supported `kind`: `input`, `textarea`, `select`, `checkbox`, `radio`, `file`, `submit`; see `FieldContent` in `lib/types.ts`.
- `media`: `{ "kind": "video", "src": "", "assetId": "..." }` (or `audio`).
- `embed`: `{ "kind": "youtube", "src": "..." }` (also `map`, `url`).
- `list`: `{ "from": "items", "limit": 10 }`, with template nodes in `children`.
- `instance`: `componentId` referencing `doc.components`.
- `icon`: `{ "name": "house", "svg": "<svg ...>...</svg>" }`; use valid current icon data.

Optional node fields include `darkStyles` (`prefers-color-scheme: dark` overrides using the same `NodeStyles` map shape as `styles`), `customTag` (only for `semantic: "custom"`), `attrId`, `scripts`, `customCss`, `motions`, `hiddenOn`, and `locked`.

### Styles and responsive breakpoints

`styles` (and optional `darkStyles`) is a map of breakpoint ID → state → CSS declarations:

```json
{
  "base": {
    "default": { "display": "flex", "gap": "20px", "padding": "32px" },
    "hover": { "backgroundColor": "#e2e8f0" }
  },
  "sm": {
    "default": { "flexDirection": "column", "padding": "16px" }
  }
}
```

Use **camelCase** CSS property names and **string** values (e.g. `"fontSize": "16px"`, not `"font-size": "16px"`). Available state keys are `default`, `hover`, `active`, `focus`, and named states written as `custom:<name>` (up to 40 letters, digits, `_`, `-` or spaces; a `set-state` script step switches an element into one). `base` applies to all widths; built-in responsive breakpoint IDs include `lg`, `md`, and `sm`. Custom breakpoints may be specified with `SiteDoc.breakpoints: [{ id, label, maxWidth }]`.

## Links and components

A link is stored as part of the source node:

```json
{ "kind": "url", "url": "https://example.com", "newTab": false }
```

For a site-internal link use `{ "kind": "page", "pageId": "page_about" }`. The page ID must exist.

Reusable component definitions reside in `doc.components`:

```json
{ "comp_card": { "id": "comp_card", "name": "Card", "rootId": "node_card_root" } }
```

Their node trees reside in `doc.nodes`. To place one, use an `instance` node with `componentId: "comp_card"`. Do not put the component's `rootId` directly into an ordinary page's `children` unless intentionally treating it as a regular tree; preserve distinct ID references.

## Scripts

`Script` has `id`, `trigger`, `steps`, and (for variable-watching page scripts with `trigger: "change"`) `changeVariable`. Element-triggered scripts live in the element's `scripts`; "when the page opens" and variable-change scripts live in the page's `pageScripts`. Trigger values: `click`, `hover-start`, `hover-end`, `change`, `load`, `in-view`.

A simple page-load script:

```json
{
  "id": "script_load",
  "trigger": "load",
  "steps": [
    { "id": "step_set", "kind": "set-var", "into": "greeting", "value": "Welcome" }
  ]
}
```

Put it in `page.pageScripts`. A click script is attached to `node.scripts` instead. Steps are a tagged union; the valid kinds are `show`, `hide`, `toggle`, `set-state`, `open-page`, `open-url`, `scroll-to`, `dialog`, `set-value`, `set-enabled`, `list-display`, `store-save`, `store-load`, `set-var`, `set-list-item`, `remove-list-item`, `transform`, `copy`, `wait`, `repeat`, `for-each`, `break-loop`, `fetch`, and `if`. Value operations such as arithmetic, replacing text, and sorting are `transform` recipes ([`script-model/compose.ts`](script-model/compose.ts)), not step kinds. **For any nontrivial script, copy the precise fields and rules from the current `ScriptStep` union in `lib/types.ts`; do not infer step fields.** A fetch directly under a page's load trigger runs before rendering on the server. Fetch steps elsewhere execute in the browser at runtime, require CORS for remote APIs, and delay subsequent steps until complete.

## Assets and packaging

Without any assets, set `"assets": {}` and provide a single `doc.json`.

For binary assets, provide a ZIP:

```text
my-site.zip
├── _tsumu/
│   ├── doc.json
│   └── assets.json
└── public/
    └── assets/
        └── logo.svg
```

An asset definition must include `id`, `name`, `width`, `height`, and optionally `mimeType`, `bytes`, `dataUrl`, etc.:

```json
"assets": {
  "asset_logo": {
    "id": "asset_logo",
    "name": "logo.svg",
    "mimeType": "image/svg+xml",
    "width": 128,
    "height": 128
  }
}
```

An image node must use the exact same `assetId: "asset_logo"`. The ZIP asset map (`_tsumu/assets.json`) is required whenever `doc.assets` contains packaged files and explicitly maps every asset ID to a safe relative archive path:

```json
{ "version": 1, "assets": { "asset_logo": "public/assets/logo.svg" } }
```

Keep original asset IDs stable. Do not put filenames or filesystem paths in `assetId`. Do not invent a Tsumu server-side `path` for locally bundled assets.

For a standalone JSON, fully embedded data-URL assets can be represented via `dataUrl` with matching asset metadata, subject to the JSON size and browser storage limits.

## Other `SiteDoc` options

`lang` (BCP 47, default `ja`), `colorPalette`, `siteUrl`, `baseWidth`, `breakpoints`, `pageFolders`, `customFonts` (Google Fonts), `adobeFonts` (Adobe Fonts Web Projects), `uploadedFonts` (uploaded font families linked by `assetId` to a WOFF2/WOFF/TTF/OTF asset), `customHeadHtml`, `customBodyEndHtml`, `favicon`, `appleTouchIcon`, `ogImage`, `loadingScreen`, `pwa`, `hosting`, `dataRevalidate`. For exact shapes of these advanced settings, consult `lib/types.ts` instead of inventing fields.

## Validation rules and limits

Follow `validateImportedDoc()` in `lib/site-import-format.ts` plus a stricter self-check:

- Ensure the JSON is UTF-8 and parseable, `siteName` is not blank, and all required objects/arrays are present.
- Ensure every `pageOrder` ID matches a `pages` key; every page, node, component and asset ID matches its containing map key; every referenced node, component, page and asset exists.
- Tree children must not create cycles or accidentally assign the same ordinary node to multiple parents.
- Avoid unsupported node types, script step kinds, invalid breakpoint keys, invalid HTML/CSS values, and unsafe references.
- ZIP paths must be relative and safe, without `..`, leading slashes, repeated ambiguous entries or multiple editable documents.
- Current local import implementation: ZIP file ≤100 MiB; standalone JSON ≤12 MiB; expanded ZIP total ≤300 MiB; ≤1,500 ZIP entries, ≤1,000 asset entries/records, each asset ≤25 MiB; browser-only fallback for each stored asset is more restrictive (2 MiB).
- Tsumu's importer checks some structural properties but does not guarantee every script, design or asset renders correctly. Run a real import and preview if possible. Never treat a shallow shape check as full validation.

These rules follow `IMPORT_LIMITS` in `lib/site-import-format.ts` and the checks in `lib/site-import.ts`; recheck those files and `lib/types.ts` when they change.
