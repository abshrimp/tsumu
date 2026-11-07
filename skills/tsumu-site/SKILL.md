---
name: tsumu-site
description: Create an editable Tsumu site as a downloadable doc.json or ZIP archive, without publishing files or creating an import URL.
---

# Create a site for Tsumu

Use this skill when the user asks you to generate a site they can open and visually edit in Tsumu.

## Deliverable

Create a real downloadable file, not a code snippet or a remote URL.

- **No binary assets**: deliver `doc.json` containing one valid Tsumu `SiteDoc`. If visual assets are embedded as SVG elements or authored CSS, no ZIP is needed. Self-contained `dataUrl` assets are also allowed when practical.
- **With images, fonts, video or other assets**: deliver a ZIP with `_tsumu/doc.json` and `_tsumu/assets.json`, plus all referenced asset files. ZIP may contain a single root folder, but the metadata must be at its root.
- Do not upload the result to external storage. Do not produce `?zip=` or `?doc=` links. The user downloads the file and drops it on the Tsumu homepage or uses **Import**.

## Source of truth

- The editor's data format is `SiteDoc` in `lib/types.ts`.
- Use `lib/presets.ts` / `createInitialDoc()` to derive valid defaults when writing generation code. Include valid `pages`, `pageOrder`, `nodes` and `assets`. Every ID reference must resolve.
- Site markup or a generated framework project is **not** a replacement for a `SiteDoc`: make the pages and nodes editable.
- Use only currently supported node types, styles, links, scripts, and component shapes. Avoid guessing properties. Read the current repository definitions before generating.

## ZIP example

```text
my-site.zip
├── _tsumu/
│   ├── doc.json
│   └── assets.json
└── public/
    └── assets/
        └── logo.svg
```

`_tsumu/assets.json` must map the original asset IDs to exact archive paths:

```json
{
  "version": 1,
  "assets": {
    "logo-id": "public/assets/logo.svg"
  }
}
```

The `doc.json` must contain the matching `doc.assets["logo-id"]` entry and every node referring to the image must use the same asset ID. Preserve all IDs.

## Validate before delivery

1. Parse the JSON as UTF-8 and check the `SiteDoc` structure, especially `pages`, `pageOrder`, `nodes`, and `assets`.
2. Check all page, element, component, script target and asset references. Do not put references to assets that are not included, unless they are truly embedded in `dataUrl`.
3. For ZIPs, ensure no absolute paths, `..` entries, duplicate paths, or duplicate `_tsumu/doc.json` files. Use `_tsumu/doc.json`, not `docs.json` or legacy metadata paths.
4. Keep within Tsumu's import limits (see `lib/site-import.ts`) and test a local import when practical.
5. Return the downloadable file and instruct the user to drop it onto the Tsumu homepage.

If the user asks for a site requiring assets you cannot generate or package, state that limitation rather than silently omitting assets.
