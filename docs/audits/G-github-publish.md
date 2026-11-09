# G — GitHub publish and restore audit

- **Repository:** `abshrimp/tsumu`
- **Baseline:** `1ba32974d4b5ecf441e36428e765d0542207c421`
- **Branch:** `audit/G-publish`
- **Scope:** `app/api/publish/`, `lib/github.ts`, `lib/publish-files.ts`, `lib/publish-preconditions.ts`, `lib/publish-security.ts`, `components/PublishModal.tsx`, and associated tests.
- **Integration:** All G fixes belong to a single pull request. Independent review and final merge remain the responsibility of the integrator.

## Verified workflow (baseline)

1. The UI loads and confirms the selected destination before requesting a GitHub tree snapshot.
2. The server resolves the destination from authoritative site settings and requires the destination identity in subsequent requests.
3. The tree preflight reads the branch head, a recursive tree and publication manifests; clients calculate generated-file changes and files to retain.
4. Binary assets are uploaded as Git blobs before the commit request.
5. The commit endpoint checks the expected branch head, creates a replacement Git tree, creates a commit with the observed parent, and moves the branch ref with `force: false`.
6. History reads commits and editable document content from the destination; rollback constructs a new commit and also updates the ref without force.

## G audit checklist

| Area | Review targets |
| --- | --- |
| G-1 GitHub credentials | Token scope, redirect behavior, errors, logging |
| G-2 destination | Repository / branch validation, immutable target identity |
| G-3 paths | Traversal, symbolic links, submodules, protected paths |
| G-4 Git operations | Error responses, zero/partial results, tree chunks |
| G-5 concurrency | Concurrent publishers, stale snapshots, rejected ref writes |
| G-6 retention | Manual files, generated manifest, delete decisions, collisions |
| G-7 history and rollback | Reachability, preservation of protected files, trust boundary |
| G-8 retry and recovery | Ambiguous network results, post-commit bookkeeping failures |
| G-9 tests | Mock GitHub API abnormal conditions, publish / restore round trips |

## Coordination and pending verification

PR #19 modifies the import pipeline and PR #22 modifies account/style flows; neither changes the main G-owned files as of the audit baseline. This document is an incremental audit record, **not** a claim that the audit is complete. Findings, fixes, precise test results and any remaining risks will be documented here as they are established.
