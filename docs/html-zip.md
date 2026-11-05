# HTML ZIP stylesheets

New HTML ZIP imports keep the original uploaded files and record archive-relative CSS dependencies in optional, versioned asset metadata. Reimport an older ZIP to enable this behavior: old assets have no reliable archive paths, so they are not guessed or migrated.

- Relative `url()` resources, `image-set()` images and quoted or `url()` `@import` paths resolve from each stylesheet's archive directory.
- Preview stylesheets remain separate. Import order, repeated imports, media/supports/layer conditions and namespace scope are preserved. Only imports back to an ancestor are replaced with an empty sheet in preview. Export retains native import cycles.
- A remote ZIP preview offers a refresh before signed URLs expire. It never reloads an active iframe on a timer: the refresh button explicitly resets form/script state. Local-only and legacy previews receive no expiry notice.
- Preview signs every reachable remote dependency and uses absolute URLs, including fonts. Local fallback uses data URLs. CSS dependency query parameters remain on exported URLs. Import/preview drops cache queries from embedded data URLs because appending them would corrupt their contents; fragments are retained.
- Export writes each CSS asset as its own UTF-8 file with references to the generated asset filenames. Original CSS uploads are unchanged. Integrity hashes are removed only from imported local CSS links, whose rendered bytes change. Remote-link integrity and other link attributes are preserved.
- Copying pages carries transitive dependencies. Unused-asset cleanup keeps dependencies of referenced stylesheets. Copied CSS identities and dependency IDs remain separate from the source text.

Limits are explicit: 200 files per ZIP, UTF-8 CSS only, at most 2 MiB of CSS source per import and per preview dependency graph, 8 MiB of encoded preview output, 64 MiB of total encoded variant work, 4,096 variants and 200 nested sheets. Oversized previews show an error instead of expanding without a bound. Embedded assets retain the existing per-file local-storage limit. Stored CSS metadata contributes to document size; the normal save-status UI reports any storage rejection.

JavaScript module/dynamic-import dependencies are not rewritten. Missing files are left unchanged. Absolute external URLs keep their source text; archive-external root-relative and protocol-relative URLs are made absolute against the editor origin in preview only, because embedded CSS has no relative base. Exports preserve those original external references. These rules apply only to newly imported CSS metadata; legacy asset export remains unchanged.
