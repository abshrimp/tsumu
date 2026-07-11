# Security

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting for abshrimp/tsumu](https://github.com/abshrimp/tsumu/security/advisories/new) when available. Include the affected version or commit, deployment environment, reproduction steps, impact and a minimal proof of concept. Do not include real credentials or other people's data.

If private reporting is unavailable, open an [issue](https://github.com/abshrimp/tsumu/issues/new) asking the maintainer for a private contact channel, without disclosing the vulnerability. Please keep exploit details private until a fix can be coordinated.

## Supported code

Security fixes target the current `main` branch. Update to the latest code and lockfile before checking whether an issue is still reproducible.

## Deployment model

- Configure Google sign-in and an email allowlist for an internet-accessible editor. Every allowed account is a trusted editor with access to all sites, publishing and account management; there are no per-site roles.
- `ALLOW_ANONYMOUS=true` gives everyone who can reach the editor those editing and publishing capabilities. Keep demos isolated from production data and GitHub publishing tokens.
- Custom HTML and SVG are active content on the published site. The editor canvas sanitizes custom code and icons before showing them, and previews raw HTML pages in a sandboxed frame, so a document's scripts do not run with the signed-in editor's permissions. Review imported documents and restored versions before publishing them, because their code runs on the published site.
- Anyone who can write to a site repository can change `_tsumu/doc.json`, which the editor reads when restoring a published version. Limit write access to people you would trust as editors.
- Keep the GitHub token limited to the intended site repositories with Contents read/write permission. AI provider keys remain server-side; enabling AI sends the editing context to the selected provider.
- Data directories, database exports, environment files and local Cloudflare configuration can contain private information. Keep them out of commits, container build contexts and release archives.
- Exported sites are independent applications. Review their custom code, dependencies and deployment configuration separately.
