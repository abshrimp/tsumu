---
name: tsumu-site
description: Create a NEW editable website, landing page, or multi-page site in Tsumu. Use for requests such as "Tsumuでサイトを作って", "Tsumuでホームページを作成して", or "build a site in Tsumu", and when Tsumu is the selected site builder. Prefer an MCP import link using stage_site_doc; otherwise deliver an importable doc.json or asset ZIP. Do not use for editing an existing paired site or unrelated website requests.
license: MIT
compatibility: Requires the authorized Tsumu MCP server (https://mcp.tsumu.ebii.net/mcp) for import-link staging; offline document and ZIP generation do not require MCP.
metadata:
  author: abshrimp
---

# Create a site for Tsumu

Use this skill when the user wants a **new** website they can visually edit in Tsumu. Prefer a private MCP import link when staging is available and authorized; otherwise provide a real downloadable `doc.json` or ZIP import file. Do not confuse creating a separate site with adding a page to an existing paired site: use the paired-editor MCP tools for the latter.

## Read first

1. **For MCP staging:** call `get_site_doc_spec` before authoring any SiteDoc, and inspect both the returned `guide` and `example`. This is available with the new-site-only OAuth grant; do not guess schema shapes or attempt `stage_site_doc` before reading the spec.
2. **For file generation (or when the spec tool is unavailable):** read [the SiteDoc data format](references/site-doc.md), [a valid editable example](references/minimal-site.json), and [the complete TypeScript model snapshot](references/types.ts). Use the exact field shapes for scripts, form controls, components, and assets.
3. If the current Tsumu repository is accessible, cross-check `lib/types.ts`, `lib/presets.ts`, and `lib/site-import-format.ts`; the current source is authoritative, and the bundled snapshot must be updated when types change.

## Select the output

- **Authorized Tsumu MCP staging (preferred):** generate a complete SiteDoc object and call `stage_site_doc({ doc: <SiteDoc> })` to stage a **separate new** editable site. Use the exact `importUrl` returned by the tool; see [MCP handoff](#mcp-handoff). No existing-site pairing code is required if the user granted new-site creation.
- **No staging tool or no authorization:** create an importable file as described below. Never invent an import link. If staging was explicitly requested but failed, report the error clearly; a downloadable file may be offered as an alternative, not presented as a successful upload.
- **No packaged binary assets:** generate `doc.json` containing one valid `SiteDoc`; use `assets: {}` when no assets exist. Inline CSS and native Tsumu elements do not require ZIP packaging. Plain or minified UTF-8 JSON matching `SiteDoc` (`schemaVersion: 1`) is accepted directly.
- **With packaged assets:** generate a DEFLATE-compressed ZIP with `_tsumu/doc.json` (plain minified JSON, not double-compressed), `_tsumu/assets.json`, and the required files (normally in `public/assets/`). The map associates original asset IDs with paths inside the ZIP.
- For modest self-contained assets, a `dataUrl` in `doc.json` is also supported when the resulting document is within import limits.

Do not substitute raw HTML, a generated Next.js project, or an image-only mockup for the editable `SiteDoc`.

## MCP handoff

1. Construct the full native Tsumu `SiteDoc` using the schema returned by `get_site_doc_spec`. Pass an **object** in the `doc` argument to `stage_site_doc`, not a JSON string, HTML, a ZIP, or a wrapper. The serialized SiteDoc must fit within the **12 MiB** staging limit.
2. For images, use verified external URLs or supported small embedded `dataUrl` assets within the size limit. `stage_site_doc` does not upload a separate binary asset archive or resolve imaginary storage keys. If the user needs large packaged assets, deliver a ZIP through the file workflow instead.
3. After a successful tool response, give the requesting user the **exact returned `importUrl`** as a clickable private link and briefly describe what opening it does. The link expires after **one hour** and is consumed after Tsumu confirms a successful import. Treat the complete URL as a bearer secret; do not copy it to unrelated services or logs.
4. A staged link opens Tsumu to **import** the new site. It is not evidence the site has been imported, published, deployed, or added to an existing paired editor. Never claim any of those events without separate confirmation.
5. If `get_site_doc_spec`, `stage_site_doc`, or authorization is unavailable, use the file workflow. If staging fails, report the real failure and do not reconstruct a link from guessed identifiers. `create_site` only makes an empty browser-local site; it is not a replacement for `stage_site_doc`.

## Create and verify

1. Generate stable, unique page, node, script, component and asset IDs; ensure every reference resolves. Use proper `pages`, `pageOrder`, `nodes`, and `assets`.
2. Build layout with editable nodes and `styles.base.default`; use real `DocNode` types and properly shaped scripts. Read the reference for correct field names and nested structures.
3. If packaging assets, keep their original IDs and write an `_tsumu/assets.json` map of archive paths. Do not use remote Tsumu storage keys as local asset paths.
4. Validate the file and archive using the checks and size limits in [the format reference](references/site-doc.md). If possible, load it in Tsumu and verify that the editor can select and edit its elements.
5. Deliver the successful MCP import link **or**, when staging is unavailable, the downloadable file. The user can drop a file onto the Tsumu homepage or select **Import**. State clearly which output was actually created.

Do not silently omit images or other required assets. If an essential asset cannot be created, explain the limitation.
