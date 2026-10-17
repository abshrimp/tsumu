# Architecture

This is a map of the codebase for contributors. For setup and deployment, see the [README](README.md).

## The one idea

Everything the editor knows about a site is a single JSON value, `SiteDoc` (`lib/types.ts`). The editor UI reads and changes it, the collaboration layer syncs it, the AI proposes edits to it, and the generator turns it into a Next.js project. If you understand `SiteDoc`, you can find your way around everything else.

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
| `pages`, `pageOrder`, `pageFolders` | Pages (slug, title, metadata, page scripts) and their order. A page lists its top-level node IDs in `children`. |
| `nodes` | A flat map of `DocNode` by ID. The tree is expressed by each node's `children` (IDs), never by nesting. |
| `components` | Reusable node trees. An `instance` node points at one with `componentId`. |
| `assets` | Uploaded images, video, audio and fonts. The bytes live in KV (or the browser); the doc keeps metadata and the storage key. |
| `breakpoints`, site settings | Responsive widths, fonts, palette, favicon/OGP, PWA, hosting choice, data refresh interval, language. |

A `DocNode` has a `type`, a `semantic` (which HTML tag to emit), optional content (`text`, `image`, `field`, `media`, `list`, …), `styles`, `scripts` and `motions`.

- **Styles** are `styles[breakpoint][state][cssProperty]`. The state is `default`, `hover`, `active` or `focus`. Values are plain CSS strings.
- **Scripts** are "trigger → steps" data (`Script`, `ScriptStep`), not code. `lib/script.ts` holds the model, `lib/script-runtime.ts` is the runtime shared by the canvas preview and exported sites, and the generator keeps only the runtime features a site uses.
- **Lists** repeat a template child over an array, from a fetch step or static data. A list can generate a detail page per item (`/news/[slug]`).

IDs are stable and globally unique within a doc. Merge, undo, comments and AI ops all key on node IDs, so do not reuse or renumber them. `lib/cloneIds.ts` is the only safe way to copy a subtree.

## Where things live

| Area | Files |
|---|---|
| Editor state, undo/redo | `lib/store.ts` (zustand). Every mutation goes through the store so undo and sync see it. |
| Canvas and panels | `components/Canvas.tsx` (+ `canvas/`: CSS, node rendering, `NodeView`, `useCanvasData`, `useCanvasDrag`), `LeftPanel.tsx` (+ `left-panel/`: one file per tab), `StylePanel.tsx` (+ `style-panel/`: one file per section), `ScriptEditor.tsx` (+ `script-editor/`: palette, blocks, step bodies, inputs, `useScriptDrag`, `useScriptEditorKeys`), `SitePanel.tsx` |
| Style model → CSS | `lib/style.ts`, `lib/breakpoints.ts`, `lib/motion.ts`, `lib/keyframes.ts` |
| Generator | `lib/generator.ts`: `generateProject(doc, target)` returns `{ files, binaries, remoteAssets }`. The parts live in `lib/generator/`: `names.ts`, `css.ts`, `render.ts` (+ `render-helpers.ts`), `page.ts`, `head.ts`, `templates.ts` |
| Publish | `components/PublishModal.tsx` (client) → `app/api/publish/route.ts` (GitHub Git Data API). See below. |
| Pre-publish checks | `runChecks` in `lib/generator/checks.ts` (broken links, alt text, heading order, small text, overflow) |
| Persistence | `lib/doc-storage.ts` (D1, one row per site, optimistic `rev`), `lib/local-storage.ts` (no-D1 fallback), `lib/kv.ts` (assets), `lib/node-storage.ts` (SQLite and files when running outside Cloudflare) |
| Collaboration | `custom-worker.ts` (Durable Object per site, WebSocket), `lib/collab-events.ts` + `app/api/collab/events` (Server-Sent Events on Node.js and Docker), `lib/collab.ts` (messages), `lib/merge.ts` (three-way merge per ID, then per property; arrays are one value) |
| AI | `lib/ai/` (providers, prompt, streaming), `lib/aiOps.ts` (op schema and the apply function used on both server and client) |
| Comments, activity | `lib/comments.ts`, `lib/comment-store.ts`, `lib/activity.ts` |
| Auth | `auth.ts`, `middleware.ts`, `lib/allowlist.ts`. Without `AUTH_*` the editor opens only in `npm run dev` or with `ALLOW_ANONYMOUS=true` (`lib/anonymous.ts`). |
| i18n | `lib/i18n.ts`. Source strings are Japanese, wrapped in `tr("…")`. Translations are in `lib/locales/`. |
| Help and tutorial | `lib/manualTopics.ts`, `components/HelpCenter.tsx`, `HelpFigures.tsx`, `Tutorial.tsx` |

## Publishing

1. The client generates the project and adds `_tsumu/doc.json`, a copy of the doc used for restoring and rollback.
2. It asks the server for the current branch tree (`action: "tree"`). Assets whose blob SHA already exists are not uploaded again (`_tsumu/assets.json` maps storage keys to SHAs).
3. Large files and assets are uploaded one request each (`action: "upload"`). This stays under the Workers free-plan subrequest limit.
4. The client commits (`action: "commit"`). The server builds the tree in chunks and moves the branch.

The editor owns every file it generates. `_tsumu/generated.json` records each generated path and its blob SHA (`lib/publish-files.ts`). On the next publish:

- Files that are **not** in that list were added by hand. They are carried over unchanged, so you can add API routes, components or config to the site repository.
- Generated files whose SHA changed were edited on GitHub. They are overwritten, and the publish dialog asks first.

On a first publish, existing files are treated as hand-added files: unrelated files are kept and matching output paths require confirmation. An invalid manifest stops publishing. The `_tsumu/` directory is reserved for the editor.

Rollback (`app/api/publish/history/route.ts`) re-commits an older tree on top of the branch, so history is never rewritten.

## AI edits

The AI never writes the doc. It returns a list of ops (`AiOp` in `lib/aiOps.ts`). The server applies them to a copy of the page. If an op fails (for example, it names a node that does not exist), the error goes back to the model to fix. Only ops that applied cleanly reach the browser, which applies them with the same function as a single undo step. A change that arrives after the user has edited the same page is dropped.

## Conventions

- Comments and UI strings are in Japanese. Add an English translation for every new `tr()` string (`npm run i18n:check`).
- Keep generated code readable. Output that a developer would not write by hand is a bug.
- Browser state uses `tsumu-` keys and clipboard data uses `application/x-tsumu+json`. The initial public format has no migration layer for predecessor applications.
- New behavior needs a test. Unit tests live in `tests/` (Node's built-in test runner via `tsx`) and import modules from `lib/` directly. UI flows live in `e2e/` (Playwright): they start the built editor on Node.js with a throwaway `TSUMU_DATA_DIR` and `ALLOW_ANONYMOUS=true`.

```bash
npm run typecheck
npm test
npm run i18n:check
npm run build && npm run test:e2e
```
