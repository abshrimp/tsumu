# Stylesheets in HTML ZIP imports

When you import a site as an HTML ZIP, Tsumu keeps the original uploaded files exactly as they were. It also records which other files each CSS file depends on — paths relative to the archive — in optional, versioned asset metadata.

> [!NOTE]
> This only applies to new imports. Assets from older imports have no reliable archive paths, so Tsumu doesn't guess or migrate them. To get this behavior for an older ZIP, import it again.

## How references are resolved

These paths are resolved relative to the directory of the stylesheet that contains them:

- relative `url()` resources,
- images in `image-set()`, and
- `@import` paths, whether quoted or written as `url()`.

## Preview

- **Each stylesheet stays separate.** Import order, repeated imports, media/supports/layer conditions and namespace scope are all preserved.
- **Import cycles.** In the preview, only an import that points back to one of its own ancestors is replaced with an empty sheet. Exports keep the native import cycle.
- **Expiring links.** A preview loaded from remote storage offers a refresh before its signed URLs expire. It never reloads an active iframe on a timer, because refreshing explicitly resets form and script state. Local-only and legacy previews don't show an expiry notice.
- **How dependencies are served.**
  - From remote storage, the preview signs every reachable dependency, fonts included, and uses absolute URLs.
  - In the local fallback, dependencies are embedded as data URLs.
- **Query strings and fragments.** Query parameters on CSS dependencies stay on exported URLs. During import and preview, cache-busting queries are dropped from embedded data URLs, because appending them would corrupt the data. Fragments are kept.

## Export

- Each CSS asset is written as its own UTF-8 file, and its references point to the generated asset filenames. The original uploaded CSS files are never changed.
- Integrity hashes are removed only from links to imported local CSS, because the bytes Tsumu outputs for those files are different. Links to remote stylesheets keep their integrity hash and all other attributes.

## Copying and cleanup

- Copying a page also copies everything its stylesheets depend on, directly or indirectly.
- Cleaning up unused assets keeps the dependencies of any stylesheet that is still referenced.
- A copied stylesheet gets its own identity and dependency IDs, separate from those of the source.

## Limits

To keep previews bounded, the following limits are enforced:

| Limit | Value |
|---|---|
| Files per ZIP | 200 |
| CSS encoding | UTF-8 only |
| CSS source per import, and per preview dependency graph | 2 MiB |
| Encoded preview output | 8 MiB |
| Total encoded variant work | 64 MiB |
| Variants | 4,096 |
| Nested sheets | 200 |

A preview that would exceed these limits shows an error instead of growing without bound. Embedded assets are still subject to the existing per-file local-storage limit. Stored CSS metadata counts toward the document size, and the normal save status reports it if storage rejects a save.

## What isn't rewritten

- Dependencies of JavaScript modules and dynamic imports are not rewritten.
- References to missing files are left unchanged.
- Absolute external URLs keep their original text.
- Root-relative and protocol-relative URLs that point outside the archive are made absolute against the editor's origin — in the preview only, because embedded CSS has no relative base. Exports keep the original external references.

These rules apply only to CSS metadata from new imports. Exporting legacy assets works exactly as before.
