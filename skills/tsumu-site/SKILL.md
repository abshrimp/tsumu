---
name: tsumu-site
description: Generate an editable Tsumu website as a downloadable doc.json or ZIP file with its assets.
---

# Create a site for Tsumu

Use this skill when a user asks for a site they can open and visually edit in Tsumu. Produce a real downloadable `doc.json` or ZIP file for importing on the Tsumu homepage.

## Read first

1. Read [the SiteDoc data format](references/site-doc.md) for required and optional fields, ID references, styling, scripts, components, and assets.
2. Read [a valid editable site example](references/minimal-site.json) and use its structure as the starting point for a new site.
3. For exact types (especially scripts, form controls, and component references), read [the complete TypeScript model snapshot](references/types.ts). If the current Tsumu repository is accessible, cross-check `lib/types.ts`, `lib/presets.ts`, and `lib/site-import.ts`: the current code is authoritative and the bundled snapshot must be updated when types change.

## Select the output

- **No packaged binary assets:** generate `doc.json` containing one valid `SiteDoc`; use `assets: {}` when no assets exist. Inline CSS and native Tsumu elements do not require ZIP packaging.
- **With packaged assets:** generate a ZIP with `_tsumu/doc.json`, `_tsumu/assets.json`, and the required files (normally in `public/assets/`). The map associates original asset IDs with paths inside the ZIP.
- For modest self-contained assets, a `dataUrl` in `doc.json` is also supported when the resulting document is within import limits.

Do not substitute raw HTML, a generated Next.js project, or an image-only mockup for the editable `SiteDoc`.

## Create and verify

1. Generate stable, unique page, node, script, component and asset IDs; ensure every reference resolves. Use proper `pages`, `pageOrder`, `nodes`, and `assets`.
2. Build layout with editable nodes and `styles.base.default`; use real `DocNode` types and properly shaped scripts. Read the reference for correct field names and nested structures.
3. If packaging assets, keep their original IDs and write an `_tsumu/assets.json` map of archive paths. Do not use remote Tsumu storage keys as local asset paths.
4. Validate the file and archive using the checks and size limits in [the format reference](references/site-doc.md). If possible, load it in Tsumu and verify that the editor can select and edit its elements.
5. Deliver the downloadable file. The user can drop it onto the Tsumu homepage or select **Import**.

Do not silently omit images or other required assets. If an essential asset cannot be created, explain the limitation.
