# Audit M: pinned scope, trust boundaries and integration evidence

**Status:** initial coordination baseline, not a claim that the audit is complete.

## Reproducible baseline

| Item | Observation |
| --- | --- |
| Plan SHA | `1ba32974d4b5ecf441e36428e765d0542207c421` |
| Inventory SHA (main at capture) | `4cd04c23137e11afce7d7c43f0e06a52815de38e` |
| Repository | `abshrimp/tsumu` |
| Inventory source | GitHub Git tree API, recursive; `truncated: false` |
| Full path inventory | [initial-inventory.tsv](initial-inventory.tsv) |
| Classified production files without an owner | 0 (routing assignment, **not** audit completion) |

The recorded inventory contains **687 files**:

| Path category | Files | Path category | Files |
| --- | ---: | --- | ---: |
| API handlers | 18 | Other application files | 11 |
| UI components | 74 | General libraries | 128 |
| Generated-code libraries | 27 | Unit/integration test files | 259 |
| Browser test files | 101 | Tooling scripts | 11 |
| Workflow and .github files | 7 | Documentation files | 20 |
| Integration skill files | 5 | Other root files | 26 |

Provisional file routing counts from the snapshot: A 16, B 72, C 62, D 123, E 78, F 56, G 19, H 26, I 33, J 168, and 34 documentation/root paths requiring cross-area review. These are **file classifications**, not verified/tested coverage. Do not infer that one test file covers one unique behavior.

The plan's pinned SHA and the inventory SHA differ because main advanced. The inventory does not silently change when main moves; regenerate or record the delta for each integration.

## Trust boundaries to verify

The following is a **code-path map**, not a declaration of safety.

| Source | Boundary / handling | Target or high-risk effect | Primary / independent reviewer |
| --- | --- | --- | --- |
| Browser, authentication state, cookies | `auth.ts`, `middleware.ts`, `lib/server.ts`, `lib/csrf.ts`, `app/api/` | Authenticated API actions | A / J |
| Browser-generated SiteDoc and patches | `app/api/doc/route.ts`, `lib/doc-storage.ts`, `lib/doc-patch.ts` | D1/SQLite, revision conflicts, backup and sync | B / J |
| Browser asset data | `app/api/assets/`, `lib/assets.ts`, `lib/kv.ts` | KV or local binary storage and signed URLs | E with A/B / J |
| Imported JSON, HTML, ZIP | `lib/import-site-file.ts`, `lib/html-zip.ts`, `lib/html-to-site.ts` | Editable SiteDoc, later preview and generated output | E with B/F / J |
| Script blocks, external data and events | `lib/script.ts`, `lib/script-runtime.ts` | DOM mutations, fetch, dynamic data, generated runtime | C with F/H / J |
| External URL controlled by site data | `app/api/fetch-json/route.ts`, `lib/safe-fetch.ts` | External network; server-side request | H with A/F / J |
| AI prompts and provider response | `app/api/ai/route.ts`, `lib/ai/request.ts`, `lib/aiOps.ts` | SiteDoc operations via model output | H with B / J |
| Editor SiteDoc | `lib/generator.ts`, `lib/generator/`, `lib/exportZip.ts` | Executable exported code and browser content | F with C/E / J |
| Preview/generated files, GitHub credentials | `app/api/publish/route.ts`, `lib/github.ts`, `lib/publish-files.ts` | GitHub repository/tree updates | G with A/F / J |
| CI workflow and deployment secrets | `.github/workflows/ci.yml`, `wrangler.jsonc`, `Dockerfile` | Builds, deploys and supply-chain dependencies | I / J |

### Cross-boundary verification

1. **E → B → D → F:** malicious import (including unusual CSS/URL/ZIP metadata) remains harmless when edited, stored, previewed and exported.
2. **H → B → C/F:** hostile network or AI-supplied data does not gain execution authority through display, scripts or output.
3. **C → F:** the same SiteDoc script has equivalent typed, async, cancellation and error behavior in preview and exported projects.
4. **B → G:** concurrent save/restore/publish never accidentally rewinds document or remote repository state.
5. **A → B/H/G:** each route's authentication, authorization, rate/size limits and error handling remain enforced after integration.
6. **I → all:** Node and Cloudflare behavior, dependency versions, CI permissions and generated-site build gates match deployed assumptions.
7. **J:** replays attack paths independently on a commit that includes the fixes; prior green runs are not sufficient.

## Recording and decisions

- **Every finding** needs an `AUD-X-NNN` ID, affected SHA, severity, expected/actual behavior, minimal reproduction, cause, affected paths, regression test, PR and independent verifier. Security-sensitive reproduction stays private until fixed.
- **Each integration step** records the incoming PR head SHA, exact changed paths, overlapping paths, reviewer, test evidence, merge commit and follow-up ownership.
- **Before merge:** verify the final PR head, branch-protection required checks, CodeQL and other alerts, no unresolved severe findings, approval by someone other than the author, and conflict-free diff.
- **After merge:** write the *new main SHA*, run relevant tests, confirm relevant findings actually resolve, and review changed trust boundaries.
- **Final decision:** independent J review, all path/behavior coverage documented, no unexplained Critical/High, all targeted workflows executed on final HEAD, generated-site verification, residual-risk log and signed-off evidence. Until then **status = unverified/in progress**.

## Live read-only report

From a Node.js checkout, run:

```sh
node scripts/audit/coordination.mjs
node scripts/audit/coordination.mjs --json > audit-snapshot.json
node scripts/audit/coordination.mjs --strict-overlap
```

Set `GITHUB_TOKEN` in the environment for authenticated API limits if needed. This tool only reads GitHub. It deliberately checks **currently open PRs**, not already-merged historical PRs; it notices moves in main and PR heads during collection. An absent check, unknown mergeability, incomplete comparison or unreviewed alert must **not** be marked passed. The CLI does not create comments, push commits or merge PRs.

## Initial verification status

| Gate | Status |
| --- | --- |
| Initial source inventory and provisional ownership | **Recorded**, for inventory SHA only |
| Full A–I review coverage | Not verified |
| Initial open PR overlap | To be continuously checked on current open PRs |
| Current main CI, CodeQL and dependency findings | Not verified here |
| A–I individual regression verification | Not verified |
| J independent adversarial review | Not verified |
| Final integrated-head CI/E2E/generated build and SSR | Not verified |
| No unresolved Critical/High | Not verified |
| Final audit verdict | **Not ready** |

This status table must be updated with **evidence and exact SHAs**, not an assumption based on a task owner's self-report.
