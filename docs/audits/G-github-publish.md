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

## State transitions

```mermaid
flowchart TD
  A[Read destination configuration] --> B{Auth and pinned target valid?}
  B -- No --> X[Reject]
  B -- Yes --> C[Read Git branch head and complete tree]
  C --> D{Valid previous manifests?}
  D -- No --> X
  D -- Yes --> E[Confirm edited and colliding paths in UI]
  E --> F[Upload detached blobs]
  F --> G[Commit request with expected head]
  G --> H{Head unchanged?}
  H -- No --> Y[409 conflict, re-open review]
  H -- Yes --> I[Server independently derives manual retention]
  I --> J[Create replacement Git tree and new commit]
  J --> K[Fast-forward ref without force]
  K --> L{Update confirmed or verified on readback?}
  L -- No --> Y
  L -- Yes --> M[Record activity best-effort]
  M --> N[Return committed SHA and URL]
```

```mermaid
flowchart TD
  A[Select history entry] --> B[Resolve current target and branch head]
  B --> C{Requested SHA belongs to branch ancestry?}
  C -- No --> X[Reject unrelated commit]
  C -- Yes --> D{Restore editable doc or roll back deployed tree?}
  D -- Doc --> E[Read bounded JSON from GitHub]
  E --> F[Validate SiteDoc graph and asset metadata]
  F --> G[Confirm and restore with Undo]
  D -- Rollback --> H[Copy chosen tree]
  H --> I[Reapply current .github tree]
  I --> J[Create child of current branch head]
  J --> K[Fast-forward only, reconcile network ambiguity]
```

## Findings and fixes

| ID | Severity | Baseline issue | Resolution and coverage |
| --- | --- | --- | --- |
| AUD-G-001 | High | The server accepted an incomplete `keptPaths` list during whole-tree replacement, allowing manually added Git files to disappear. | Recalculate retention from the pinned Git tree and prior validated generated-file manifest. Tests cover omitted paths, file modes, submodules and intentional deletion of obsolete generated files. |
| AUD-G-002 | Medium | A guessed/known commit SHA from an unrelated branch could be used to read its editable document or replace the active site's published tree. | Require the SHA to be an ancestor of the selected branch's current head; reject unrelated commits. Mocked API checks cover both read and rollback and preserve ancestor behavior. |
| AUD-G-003 | Medium | A connection drop after a successful ref update could be reported as failure, prompting a duplicate retry. | Read back the ref after uncertain outcomes; accept success only when it equals the newly created commit. Keep `force: false` and conflict rejection. |
| AUD-G-004 | Medium | Local publish-activity recording could throw after GitHub commit success and cause a misleading failure response. | Separate post-commit bookkeeping from the committed result; emit a sanitized warning, return the successful commit. |
| AUD-G-005 | Medium | History restoration accepted shallowly plausible JSON without validating internal references, objects or prototype keys. | Apply the same full `SiteDoc` validator as document imports and cap the streamed JSON body before parsing. |
| AUD-G-006 | Low | Text and binary-SHA outputs could claim the same path, yielding ambiguous Git tree entries. | Reject conflicting destination paths before any remote writes. |
| AUD-G-007 | Low | GitHub API failures logged up to 300 characters of untrusted response text, potentially including sensitive request-related details. | Record only repository, step and status, without the raw response body. |

## Reproduction and regression coverage

- **Manual retention:** invoke a commit on a branch with `script.sh`, a symlink, a gitlink and an existing workflow, omitting `keptPaths`. Before the fix the replacement tree omitted unlisted files. After the fix the server explicitly re-adds all manual files from the authoritative tree.
- **Generated-file deletion:** when a previous generated manifest owns `app/obsolete.ts`, publish a new output without that path and preserve an unrelated `README.md`. Only the generated file should be deleted.
- **Cross-branch restoration:** supply a real-looking SHA whose GitHub compare merge base is not itself. Both historical `doc.json` reads and rollback must reject it without remote writes.
- **Ambiguous write:** simulate GitHub accepting a branch ref update before the connection fails. A readback resolving to the exact new SHA must return the commit as successful.
- **Bookkeeping outage:** make local `recordPublish` throw after the ref update. GitHub success remains success, not an invitation to retry.
- **Untrusted restored document:** test over-limit streamed input, malformed UTF-8 and JSON, prototype keys and broken document references.

## Remaining boundaries and integration checks

- **Token permissions:** the application uses a server-side `GITHUB_TOKEN` shared across configured sites. Minimum practical permission is a fine-grained token limited to intended repositories, with repository Contents read/write and Metadata read. The token's actual permissions cannot be established from source code and require deployment-owner verification.
- **Uncontrolled repositories:** this audit does not write to real publication targets. Tests use an isolated GitHub API mock to avoid destructive changes.
- **Delivery:** a Git commit means the source was pushed, not that an external host finished building or deploying it. Host-side production verification is a separate step.
- **Cross-project integration:** `lib/site-import.ts` is shared with the import team; the published-history restore reuses its exported validator without modifying that file.
- **Final acceptance:** review the final CI checks, CodeQL, main integration, external publish/restore smoke, and independent audit before merging. Do not mark the entire project free of vulnerabilities solely on the basis of G's tests.
