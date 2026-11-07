# Architecture

English · [日本語](ARCHITECTURE.ja.md)

This is a map of the codebase for contributors. For setup and deployment, see the [README](README.md).

## The one idea

Everything the editor knows about a site is a single JSON value: `SiteDoc` (`lib/types.ts`).

- The editor UI reads and changes it.
- The collaboration layer syncs it.
- The AI proposes edits to it.
- The generator turns it into a Next.js project.

Once you understand `SiteDoc`, you can find your way around everything else.

```
           ┌────────── edit (zustand store, undo) ────────────┐
           │                                                  │
 Canvas / panels ──▶ SiteDoc ──▶ generator ──▶ files ──▶ GitHub (main / preview)
           ▲            │  ▲                                  │
           │            │  └─ AI ops (validated on a copy)    └─▶ any Next.js host
           │            ▼
           └── D1 + Durable Object (save, three-way merge, live updates)
```

## `SiteDoc`

| Field | What it holds |
|---|---|
| `pages`, `pageOrder`, `pageFolders` | Pages (slug, title, metadata, page scripts) and their order. Each page lists its top-level node IDs in `children`. |
| `nodes` | A flat map of `DocNode`s by ID. The tree comes from each node's `children` (a list of IDs), never from nesting. |
| `components` | Reusable node trees. An `instance` node points at one through `componentId`. |
| `assets` | Uploaded images, video, audio and fonts. The bytes live in KV (or the browser); the doc keeps only the metadata and the storage key. |
| `breakpoints`, site settings | Responsive widths, fonts, palette, favicon/OGP, PWA, hosting choice, data refresh interval and language. |

A `DocNode` has a `type` and a `semantic` (the HTML tag to emit). It can also have content (`text`, `image`, `field`, `media`, `list`, …), `styles`, `scripts` and `motions`.

- **Styles** are stored as `styles[breakpoint][state][cssProperty]`. The state is `default`, `hover`, `active` or `focus`, and every value is a plain CSS string.
- **Scripts** are data, not code: a trigger followed by steps (`Script`, `ScriptStep`). `lib/script.ts` defines the model. `lib/script-runtime.ts` is the runtime, shared by the canvas preview and exported sites; the generator keeps only the runtime features a site actually uses.
- **Lists** repeat a template child once for each item in an array. The array comes from a fetch step or from static data. A list can also generate a detail page per item (such as `/news/[slug]`).

> [!IMPORTANT]
> Node IDs are stable and unique within a doc. Merging, undo, comments and AI ops all key on them, so never reuse or renumber an ID. `lib/cloneIds.ts` is the only safe way to copy a subtree.

## Where things live

| Area | Files |
|---|---|
| Editor state, undo/redo | `lib/store.ts` (zustand). Every change goes through the store, so that undo and sync both see it. |
| Canvas and panels | `components/Canvas.tsx` and `canvas/` (CSS, node rendering, `NodeView`, `useCanvasData`, `useCanvasDrag`)<br>`LeftPanel.tsx` and `left-panel/` (one file per tab)<br>`StylePanel.tsx` and `style-panel/` (one file per section)<br>`ScriptEditor.tsx` and `script-editor/` (palette, blocks, step bodies, inputs, `useScriptDrag`, `useScriptEditorKeys`)<br>`SitePanel.tsx` |
| Style model → CSS | `lib/style.ts`, `lib/breakpoints.ts`, `lib/motion.ts`, `lib/keyframes.ts` |
| Generator | `lib/generator.ts`. `generateProject(doc, target)` returns `{ files, binaries, remoteAssets }`. Its parts live in `lib/generator/`: `names.ts`, `css.ts`, `render.ts` (with `render-helpers.ts`), `page.ts`, `head.ts`, `templates.ts`. |
| Publish | `components/PublishModal.tsx` (client) → `app/api/publish/route.ts` (GitHub Git Data API). See [Publishing](#publishing). |
| Pre-publish checks | `runChecks` in `lib/generator/checks.ts`: broken links, alt text, heading order, small text, overflow |
| Persistence | `lib/doc-storage.ts`: D1, one row per site, optimistic `rev`<br>`lib/local-storage.ts`: fallback when there's no D1<br>`lib/kv.ts`: assets<br>`lib/node-storage.ts`: SQLite and files when running outside Cloudflare |
| Collaboration | `custom-worker.ts`: one Durable Object per site, over WebSocket<br>`lib/collab-events.ts` and `app/api/collab/events`: Server-Sent Events on Node.js and Docker<br>`lib/collab.ts`: messages<br>`lib/merge.ts`: three-way merge by node ID, then by property; an array counts as one value |
| AI | `lib/ai/` (providers, prompt, streaming); `lib/aiOps.ts` (the op schema, and the apply function used on both server and client) |
| Comments, activity | `lib/comments.ts`, `lib/comment-store.ts`, `lib/activity.ts` |
| Auth | `auth.ts`, `middleware.ts`, `lib/allowlist.ts`. Without `AUTH_*`, the editor opens only under `npm run dev` or with `ALLOW_ANONYMOUS=true` (`lib/anonymous.ts`). |
| i18n | `lib/i18n.ts`. Source strings are Japanese, wrapped in `tr("…")`. Translations are in `lib/locales/`. |
| Help and tutorial | `lib/manualTopics.ts`, `components/HelpCenter.tsx`, `HelpFigures.tsx`, `Tutorial.tsx` |

### Deleting a local site

This section covers sites whose records are kept in the browser.

**Why deletion needs an explicit marker.** A missing record can't be taken as proof that a site was deleted. Browser comments don't require a browser-local site record: a server-backed site can legitimately fall back to browser comments after a 503. So a missing site record, a missing comment key or a network error never means "deleted".

**How deletion works.** When the user confirms deletion on the home screen:

1. The local metadata is validated.
2. A permanent marker, `tsumu-site-deleted-v1:<id>`, is written for that site. **This write is the deletion.** If it fails, the site list and the site's content stay exactly as they were.
3. After the marker is written, the site list is compacted and the content is cleaned up. Both steps are best-effort: the deletion still counts as successful even if writing the list fails.

**Why a deleted site can't come back.**

- `loadLocalSites` filters out marked IDs, so a stale write of the site list can't restore a deleted site.
- Markers are kept apart from `SITE_SCOPED_KEYS`, and the cleanup that runs after a failed create or duplicate never removes them.
- New and duplicated sites always get fresh random IDs. There is no way to restore a local site under the same ID, and site deletion can't be undone.
- Undoing an element or page edit doesn't touch site markers.

**How browser comments respect the marker.** Comment reads and queued comment writes check the marker. This includes the fallback after a POST returns 503, and checks made immediately before and after each write.

- If the site is known to be deleted, its comment rows and pins are hidden and the operation reports failure. Any open draft or detail view stays on screen so the user can still copy their text.
- If the marker can't be read, writes fail, but the site is not reported as deleted.
- Successful server operations remain authoritative.

**What this does and doesn't guarantee.** Deletion always wins for what the user can *see*. It does not promise that every stored byte is removed at once: a stale tab may stop between writing and its post-write check, or cleanup may fail. This design adds no cross-tab locking and doesn't change document autosave.

## Publishing

A publish takes four steps:

1. The client generates the project and adds `_tsumu/doc.json`, a copy of the doc used for restoring edits and rolling back.
2. It asks the server for the branch's current tree (`action: "tree"`). Assets whose blob SHA is already there aren't uploaded again; `_tsumu/assets.json` maps storage keys to SHAs.
3. Large files and assets are uploaded one request each (`action: "upload"`). This keeps each request under the Workers free-plan subrequest limit.
4. The client commits (`action: "commit"`). The server builds the tree in chunks and moves the branch.

### Generated files and hand-added files

The editor owns every file it generates. `_tsumu/generated.json` records each generated path and its blob SHA (see `lib/publish-files.ts`). On the next publish:

- **Files not in that list** were added by hand. They're carried over unchanged, so you can add API routes, components or config to the site repository.
- **Generated files whose SHA changed** were edited on GitHub. They're overwritten, and the publish dialog asks first.

On a first publish, every existing file is treated as hand-added: unrelated files are kept, and any file at a path the editor wants to write needs confirmation. An invalid manifest stops publishing. The `_tsumu/` directory is reserved for the editor.

### Rollback

Rollback (`app/api/publish/history/route.ts`) commits an older tree again on top of the branch, so history is never rewritten.

## HTML ZIP imports

`lib/html-zip.ts` imports a site packaged as a ZIP (up to 200 files). The original files are stored unchanged. For each CSS file, `lib/zip-css.ts` additionally records the archive paths of the files it depends on: relative `url()` resources, `image-set()` images and `@import`s, resolved against the stylesheet's own directory (`lib/zip-references.ts`). Only new imports carry this metadata; older imports aren't migrated, so re-import an old ZIP to get it.

- **Preview.** Each stylesheet stays a separate sheet, so import order, conditions and layers are kept. Dependencies are served as signed URLs from remote storage, or as data URLs in the local fallback. Only an `@import` that points back at one of its own ancestors is replaced with an empty sheet. A preview whose signed URLs are about to expire offers a refresh instead of reloading itself, because a reload resets forms and scripts.
- **Export.** Each CSS file is written as its own UTF-8 file, with references pointing at the generated asset filenames. Integrity hashes are dropped only from links to imported local CSS, whose bytes change.
- **Copying and cleanup.** Copying a page copies every stylesheet dependency with it, and unused-asset cleanup keeps the dependencies of referenced stylesheets.
- **Left as is.** JavaScript module imports, references to missing files and external URLs aren't rewritten. Root- and protocol-relative URLs outside the archive are made absolute in the preview only.
- **Limits** (`ZIP_CSS_LIMITS`): UTF-8 CSS only; 2 MiB of CSS per import and per preview graph, 8 MiB of preview output, 64 MiB of total variant work, 4,096 variants and 200 nested sheets. A preview over the limits shows an error.

## AI edits

The AI never writes the doc directly. Instead:

1. It returns a list of operations (`AiOp` in `lib/aiOps.ts`).
2. The server applies them to a copy of the page. If an op fails — for example, because it names a node that doesn't exist — the error goes back to the model to fix.
3. Only the ops that applied cleanly reach the browser. The browser applies them with the same function, as a single undo step.

If the user edited the same page while the AI was working, the AI's change is dropped.

## Conventions

- **Language.** Comments and UI strings are in Japanese. Every new `tr()` string needs an English translation (`npm run i18n:check`).
- **Readable output.** Generated code should look hand-written. Output a developer wouldn't write by hand is a bug.
- **Formats.** Browser state uses `tsumu-` keys, and clipboard data uses the `application/x-tsumu+json` type. The initial public format has no migration layer for predecessor applications.
- **Tests.** New behavior needs a test.
  - Unit tests live in `tests/`. They use Node's built-in test runner through `tsx` and import modules from `lib/` directly.
  - UI flows live in `e2e/` (Playwright). They start the built editor on Node.js with a throwaway `TSUMU_DATA_DIR` and `ALLOW_ANONYMOUS=true`.

```bash
npm run typecheck
npm test
npm run i18n:check
npm run build && npm run test:e2e
```
